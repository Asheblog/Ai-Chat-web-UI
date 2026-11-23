import {
  extractReasoningFromResponsesResponse,
  extractTextFromResponsesResponse,
} from '../utils/openai-responses'
import { supportsToolImages } from '../utils/tool-image-evidence'
import type {
  ToolCall,
  ToolDefinition,
  ToolHandlerResult,
  ToolHandlerTermination,
} from './tool-handler-types'
import {
  classifyAnswerOutcome,
  type AnswerOutcome,
  type ProviderAnswerSignal,
} from './answer-outcome'
import {
  type LegacyFunctionCall,
  type ToolSchema,
  appendLegacyFunctionCallDelta,
  appendOpenAIToolCallDelta,
  appendResponsesToolCallEvent,
  buildAbortedToolResultMessages,
  buildTextToolResultMessage,
  buildUnsupportedToolResult,
  createToolCallBuffers,
  extractToolCallsFromMessage,
  extractToolCallsFromResponsesOutput,
  isUnsupportedFunctionParamError,
  isUnsupportedToolParamError,
  normalizeToolHandlerResult,
  parseToolCalls,
  resolveToolSchema,
} from './tool-protocol'

type MaybePromise<T> = T | Promise<T>

export type ToolTurnRequestParams = {
  schema: ToolSchema
  messages: any[]
  iteration: number
  stream: boolean
  /**
   * 本轮是否允许携带工具定义。
   * false 用于「停止工具 / 预算耗尽」的无工具收尾轮：请求体不得包含 tools/functions。
   */
  toolsEnabled: boolean
}

export type ToolTurnRequestResult =
  | Response
  | {
      response: Response
      onDone?: () => MaybePromise<void>
    }

type ParsedToolTurn = {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  usage: Record<string, any> | null
  thinkingBlocks?: Array<Record<string, any>>
  /** provider 在本轮给出的结构化结束信号：用于区分「答复已交付」与「只有一句非空提示」 */
  providerSignal: ProviderAnswerSignal
}

/**
 * 对外的收尾原因：只包含会进入 runResult / SSE 共享契约的两个值。
 * 前端按它们出终态文案，因此不得把内部原因混进来。
 */
export type ToolOrchestrationStopReason = 'stop_tools' | 'budget_exhausted'

/**
 * 内部收尾判别：只用于「已宣告但不会执行」的调用文案与配对消息
 * （例如来源提前用尽）。它不影响 runResult / SSE 的 stopReason。
 */
export type ToolCloseoutReason = 'tool_chain_exhausted'

/** skip / 收尾轮可接受的判别：对外原因 + 内部原因 */
export type ToolSkipReason = ToolOrchestrationStopReason | ToolCloseoutReason

/** 工具轮次预算耗尽时的行为 */
export type ToolBudgetExhaustedBehavior = 'error' | 'finish'

type ToolOrchestrationBaseResult = {
  usage: Record<string, any> | null
  messages: any[]
  reasoningChunks: string[]
  toolSchema: ToolSchema
  /** null 表示正常结束；否则为被收尾的原因 */
  stopReason: ToolOrchestrationStopReason | null
  /** 是否已产出最终回答；false 时调用方不得伪造回答 */
  finalAnswerGenerated: boolean
  /** 决定本次终态的那个 turn 的交付判定；无正文终态为 null */
  answerOutcome: AnswerOutcome | null
}

export type ToolOrchestrationResult =
  | (ToolOrchestrationBaseResult & {
      status: 'completed'
      content: string
    })
  | (ToolOrchestrationBaseResult & {
      /** 收尾轮没有任何正文：调用方保留已产出的内容，不伪造回答 */
      status: 'stopped_without_answer'
      content: string
    })
  | (ToolOrchestrationBaseResult & {
      /**
       * 有正文但不算交付：provider 结构化原因（内容过滤 / 拒答 / 失败）
       * 或命中已知固定话术。正文原样保留，由调用方按「未生成最终回答」收尾。
       */
      status: 'answer_not_delivered'
      content: string
      answerOutcome: AnswerOutcome
    })
  | (ToolOrchestrationBaseResult & {
      status: 'max_iterations'
    })
  | (ToolOrchestrationBaseResult & {
      status: 'terminated'
      termination: ToolHandlerTermination
    })

/** 一次 provider 请求的身份：轮次 + 本轮第几次真实请求（schema 回退/重试都会递增） */
export type ToolTurnUsageContext = {
  iteration: number
  attempt: number
  toolsEnabled: boolean
}

export interface ToolOrchestratorParams {
  provider?: string
  requestData?: Record<string, unknown> | null
  initialMessages: any[]
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
  maxIterations: number
  stream: boolean
  requestTurn: (params: ToolTurnRequestParams) => Promise<ToolTurnRequestResult>
  handleToolCall: (
    toolName: string,
    toolCall: ToolCall,
    args: Record<string, unknown>,
    iteration?: number,
  ) => Promise<ToolHandlerResult | null>
  checkAbort?: () => void
  /**
   * 每轮工具执行完、派发下一轮之前轮询。
   * 返回 true 表示不再派发任何新工具：在途工具自然结束，随后最多一轮无工具收尾。
   */
  shouldStopTools?: () => boolean
  /**
   * 工具轮次预算耗尽时的行为。
   * 默认 'error'（保持既有语义）：返回 max_iterations，由调用方决定如何反馈。
   * 'finish'：走一轮无工具收尾，让模型基于已有工具结果作答。
   */
  onBudgetExhausted?: ToolBudgetExhaustedBehavior
  /**
   * 是否已经有可用工具证据（例如检索真的拿到了结果）。
   * 预算收尾只在有证据时值得再花一次无工具请求；没证据就直接按预算收尾。
   */
  hasRetainedEvidence?: () => boolean
  /**
   * 每轮工具结算后轮询：纯检索链是否已经明确用尽
   * （来源全部冷却 / 无可用引擎 / 连续全失败）。
   * 带本轮工具名：混合工具轮由调用方判定，不得因为一条检索结果掐断其它链路。
   * 返回非空原因时不再派发后续检索轮次：有证据最多一次无工具收尾，没证据直接收尾。
   */
  shouldEndToolChain?: (context: { toolNames: string[] }) => { cause: string } | null
  /** 收尾时不会执行的 tool_calls：调用方据此补 stage=result / status=aborted 记录 */
  onToolCallSkipped?: (params: {
    toolCall: ToolCall
    toolName: string
    reason: ToolSkipReason
  }) => MaybePromise<void>
  onSchemaFallback?: (schema: ToolSchema) => MaybePromise<void>
  onUnsupportedTool?: (toolName: string, toolCallId: string | undefined) => MaybePromise<void>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (
    usage: Record<string, any>,
    context: ToolTurnUsageContext,
  ) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  onTurnError?: (params: {
    error: unknown
    schema: ToolSchema
    iteration: number
    messages: any[]
  }) => MaybePromise<boolean>
  onOptionalImageRetry?: (details: { iteration: number; affectedToolResults: number }) => MaybePromise<void>
  includeReasoningInToolMessage?: boolean
  emptyContentErrorMessage?: string
}

const findToolTermination = (
  settled: PromiseSettledResult<ToolHandlerResult>[],
): ToolHandlerTermination | null => {
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value?.termination) {
      return result.value.termination
    }
  }
  return null
}

export async function runToolOrchestration(
  params: ToolOrchestratorParams,
): Promise<ToolOrchestrationResult> {
  const provider = params.provider || ''
  const includeReasoningInToolMessage = params.includeReasoningInToolMessage !== false
  const budgetBehavior: ToolBudgetExhaustedBehavior =
    params.onBudgetExhausted === 'finish' ? 'finish' : 'error'
  const workingMessages = params.initialMessages.map((msg) => ({ ...msg }))
  const canSendToolImages = supportsToolImages(provider)
  let optionalImageRetryUsed = false
  const maxToolRounds = normalizeMaxToolRounds(params.maxIterations)
  let toolSchema: ToolSchema = resolveToolSchema({
    provider,
    requestData: params.requestData ?? undefined,
  })
  let lastUsage: Record<string, any> | null = null
  const reasoningChunks: string[] = []
  let toolRoundsUsed = 0
  let stopReason: ToolOrchestrationStopReason | null = null

  /** 收尾轮 / 最终轮的交付判定：结构化原因优先，已知固定话术只归类 */
  const classifyTurnDelivery = (turn: ParsedToolTurn): AnswerOutcome =>
    classifyAnswerOutcome({
      content: turn.content || '',
      signal: turn.providerSignal,
    })

  const finishResult = (
    extra:
      | { status: 'completed'; content: string; outcome?: AnswerOutcome | null }
      | { status: 'stopped_without_answer'; content: string }
      | { status: 'answer_not_delivered'; content: string; outcome: AnswerOutcome }
      | { status: 'max_iterations' }
      | { status: 'terminated'; termination: ToolHandlerTermination },
  ): ToolOrchestrationResult => {
    const base: ToolOrchestrationBaseResult = {
      usage: lastUsage,
      messages: workingMessages,
      reasoningChunks,
      toolSchema,
      stopReason,
      finalAnswerGenerated: false,
      answerOutcome: null,
    }
    if (extra.status === 'completed') {
      return {
        ...base,
        status: 'completed',
        content: extra.content,
        finalAnswerGenerated: true,
        answerOutcome: extra.outcome ?? null,
      }
    }
    if (extra.status === 'stopped_without_answer') {
      return { ...base, status: 'stopped_without_answer', content: extra.content }
    }
    if (extra.status === 'answer_not_delivered') {
      return {
        ...base,
        status: 'answer_not_delivered',
        content: extra.content,
        answerOutcome: extra.outcome,
      }
    }
    if (extra.status === 'terminated') {
      return { ...base, status: 'terminated', termination: extra.termination }
    }
    return { ...base, status: 'max_iterations' }
  }

  /** 是否已被要求停止工具：一旦为 true，后续不再派发任何新工具 */
  const stopToolsRequested = (): boolean => {
    if (stopReason === 'stop_tools') return true
    if (!params.shouldStopTools) return false
    if (params.shouldStopTools() !== true) return false
    stopReason = 'stop_tools'
    return true
  }

  const requestTurnWithFallback = async (iteration: number, toolsEnabled: boolean) => {
    const turn = await executeTurnWithFallback({
      provider,
      schema: toolSchema,
      iteration,
      messages: workingMessages,
      stream: params.stream,
      toolsEnabled,
      toolDefinitions: params.toolDefinitions,
      allowedToolNames: params.allowedToolNames,
      requestTurn: params.requestTurn,
      onSchemaFallback: params.onSchemaFallback,
      onContentDelta: params.onContentDelta,
      onReasoningDelta: params.onReasoningDelta,
      onUsage: params.onUsage,
      onStreamChunk: params.onStreamChunk,
      onFirstResponseEvent: params.onFirstResponseEvent,
      onTurnError: async (turn) => {
        if (canSendToolImages && turn.schema === 'tools' && !optionalImageRetryUsed && isUpstreamImageRejection(turn.error)) {
          const affected = turn.messages.filter((msg) => msg.role === 'tool' && msg.imageEvidence?.kind === 'page')
          if (affected.length > 0) {
            params.checkAbort?.()
            optionalImageRetryUsed = true
            for (const message of affected) delete message.imageEvidence
            await params.onOptionalImageRetry?.({ iteration: turn.iteration, affectedToolResults: affected.length })
            return true
          }
        }
        return (await params.onTurnError?.(turn)) ?? false
      },
      checkAbort: params.checkAbort,
    })
    toolSchema = turn.schema
    if (turn.parsed.usage) {
      lastUsage = turn.parsed.usage
    }
    if (turn.parsed.reasoning.trim()) {
      reasoningChunks.push(turn.parsed.reasoning.trim())
    }
    return turn
  }

  const pushAssistantToolCallTurn = (
    content: string,
    toolCalls: ToolCall[],
    reasoningPayload: string,
    thinkingBlocks?: Array<Record<string, any>>,
  ) => {
    if (toolSchema === 'functions') {
      // 每个 function_call 单独成条（顺序敏感），只有首条携带正文
      let isFirstToolCall = true
      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name || ''
        const toolArguments = toolCall?.function?.arguments || '{}'
        workingMessages.push({
          role: 'assistant',
          content: isFirstToolCall ? content : '',
          function_call: {
            name: toolName || 'unknown',
            arguments: toolArguments,
          },
        })
        isFirstToolCall = false
      }
      return
    }

    if (toolSchema === 'text') {
      workingMessages.push({
        role: 'assistant',
        content,
      })
      return
    }

    const assistantToolCallContent =
      typeof content === 'string' && content.trim().length === 0 ? null : content
    workingMessages.push({
      role: 'assistant',
      content: assistantToolCallContent,
      ...(includeReasoningInToolMessage && reasoningPayload
        ? { reasoning_content: reasoningPayload }
        : {}),
      ...(thinkingBlocks && thinkingBlocks.length > 0 ? { thinking_blocks: thinkingBlocks } : {}),
      tool_calls: toolCalls,
    })
  }

  /** 执行本轮全部工具：在途工具不被中止，结果按原顺序补成配对消息 */
  const runToolRound = async (toolCalls: ToolCall[], iteration: number) => {
    params.checkAbort?.()
    const settled = await Promise.allSettled(
      toolCalls.map((toolCall) => {
        const toolName = toolCall?.function?.name || ''
        return executeToolCall({
          toolName,
          toolCall,
          handleToolCall: params.handleToolCall,
          allowedToolNames: params.allowedToolNames,
          onUnsupportedTool: params.onUnsupportedTool,
          iteration,
        })
      }),
    )

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      const toolName = toolCalls[i]?.function?.name || 'unknown'
      if (result.status === 'fulfilled') {
        if (toolSchema === 'functions') {
          workingMessages.push({
            role: 'function',
            name: result.value.toolName,
            content: result.value.message.content,
          })
        } else if (toolSchema === 'text') {
          workingMessages.push(
            buildTextToolResultMessage({
              toolName: result.value.toolName,
              content: result.value.message.content,
            }),
          )
        } else {
          const message = result.value.message
          if (!canSendToolImages || (optionalImageRetryUsed && message.imageEvidence?.kind === 'page')) {
            delete message.imageEvidence
          }
          workingMessages.push(message)
        }
        const { followupMessages } = result.value
        if (toolSchema === 'text') {
          appendTextSchemaFollowupMessages(workingMessages, followupMessages)
        } else {
          appendFollowupMessages(workingMessages, followupMessages)
        }
        continue
      }

      const errorMsg =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      const errorContent = JSON.stringify({ error: errorMsg })
      if (toolSchema === 'functions') {
        workingMessages.push({ role: 'function', name: toolName, content: errorContent })
      } else if (toolSchema === 'text') {
        workingMessages.push(buildTextToolResultMessage({ toolName, content: errorContent }))
      } else {
        workingMessages.push({
          role: 'tool',
          tool_call_id: toolCalls[i]?.id || `call_${i}`,
          content: errorContent,
        })
      }
    }

    return { termination: findToolTermination(settled) }
  }

  /** 未执行的 tool_calls：补配对占位结果，并通知调用方补 stage=result / status=aborted */
  const skipToolCalls = async (
    toolCalls: ToolCall[],
    reason: ToolSkipReason,
  ) => {
    const abortedMessages = buildAbortedToolResultMessages({
      schema: toolSchema,
      toolCalls,
      reason,
    })
    for (const message of abortedMessages) {
      workingMessages.push(message)
    }
    if (!params.onToolCallSkipped) return
    for (const toolCall of toolCalls) {
      await params.onToolCallSkipped({
        toolCall,
        toolName: toolCall?.function?.name || '',
        reason,
      })
    }
  }

  /**
   * 收尾轮：不带任何工具再请求一次，最多一轮。
   * 收尾轮若仍返回 tool_calls，只标未执行、补配对消息，不再请求。
   */
  const finishWithClosingTurn = async (
    reason: ToolSkipReason,
    iteration: number,
  ): Promise<ToolOrchestrationResult> => {
    // 只有对外原因才记录终态：内部原因（来源提前用尽）不算预算或停止
    if (reason !== 'tool_chain_exhausted') {
      stopReason = reason
    }
    // 真正取消优先：cancel 抛错立即退出，不进入收尾
    params.checkAbort?.()
    const turn = await requestTurnWithFallback(iteration, false)
    if (turn.parsed.toolCalls.length > 0) {
      pushAssistantToolCallTurn(
        turn.parsed.content || '',
        turn.parsed.toolCalls,
        turn.parsed.reasoning.trim(),
        turn.parsed.thinkingBlocks,
      )
      await skipToolCalls(turn.parsed.toolCalls, reason)
    }
    const outcome = classifyTurnDelivery(turn.parsed)
    if (!outcome.delivered) {
      // 没有正文：既有语义保持不变（收尾轮空响应不伪造回答）
      if (outcome.reason === 'empty_content') {
        return finishResult({ status: 'stopped_without_answer', content: '' })
      }
      // 有正文但未交付：原样保留，交调用方按未生成最终回答收尾
      return finishResult({
        status: 'answer_not_delivered',
        content: turn.parsed.content,
        outcome,
      })
    }
    return finishResult({ status: 'completed', content: turn.parsed.content, outcome })
  }

  for (let iteration = 0; ; iteration += 1) {
    params.checkAbort?.()

    if (stopToolsRequested()) {
      return await finishWithClosingTurn('stop_tools', iteration)
    }

    const turn = await requestTurnWithFallback(iteration, true)
    const parsed = turn.parsed

    if (parsed.toolCalls.length === 0) {
      const finalContent = parsed.content || ''
      const outcome = classifyTurnDelivery(parsed)
      if (outcome.delivered) {
        // 这一轮已经把最终回答交出来了：停止请求若在此间到达也不改判本次运行结果，
        // 否则"没被打断的作答"会被标成 stop_tools。
        return finishResult({ status: 'completed', content: finalContent, outcome })
      }
      if (outcome.reason === 'empty_content') {
        throw new Error(
          params.emptyContentErrorMessage || 'Model finished without producing a final answer',
        )
      }
      // 非空但未交付：不重试、不换模型、不改写提示，只把原始正文交给调用方
      return finishResult({
        status: 'answer_not_delivered',
        content: finalContent,
        outcome,
      })
    }

    // 真取消优先于「停止工具」：取消后不再派发任何新工具，也不再请求模型
    params.checkAbort?.()

    if (stopToolsRequested()) {
      // 停止请求在本轮生成期间到达：这一轮工具不再派发，只标未执行后收尾
      pushAssistantToolCallTurn(
        parsed.content,
        parsed.toolCalls,
        parsed.reasoning.trim(),
        parsed.thinkingBlocks,
      )
      await skipToolCalls(parsed.toolCalls, 'stop_tools')
      return await finishWithClosingTurn('stop_tools', iteration)
    }

    if (Number.isFinite(maxToolRounds) && toolRoundsUsed >= maxToolRounds) {
      if (budgetBehavior === 'finish') {
        // 预算耗尽后这一轮工具不再派发：与停止分支同样补配对占位并通知台账
        pushAssistantToolCallTurn(
          parsed.content,
          parsed.toolCalls,
          parsed.reasoning.trim(),
          parsed.thinkingBlocks,
        )
        await skipToolCalls(parsed.toolCalls, 'budget_exhausted')
        // 没有留存证据时，收尾轮只会重新编一遍：直接按预算收尾，最多一轮留给有证据的情况
        if (params.hasRetainedEvidence && params.hasRetainedEvidence() !== true) {
          stopReason = 'budget_exhausted'
          return finishResult({ status: 'stopped_without_answer', content: '' })
        }
        return await finishWithClosingTurn('budget_exhausted', iteration)
      }
      stopReason = 'budget_exhausted'
      return finishResult({ status: 'max_iterations' })
    }

    pushAssistantToolCallTurn(
      parsed.content,
      parsed.toolCalls,
      parsed.reasoning.trim(),
      parsed.thinkingBlocks,
    )

    const { termination } = await runToolRound(parsed.toolCalls, iteration)
    if (termination) {
      return finishResult({ status: 'terminated', termination })
    }
    toolRoundsUsed += 1

    // 真取消优先：链耗尽判定之后同样不允许再发请求
    params.checkAbort?.()

    const roundToolNames = parsed.toolCalls.map((toolCall) => toolCall?.function?.name || '')
    const chainEnd = params.shouldEndToolChain?.({ toolNames: roundToolNames }) ?? null
    if (chainEnd) {
      // 来源提前用尽：不写共享 stopReason（前端把它当"工具预算耗尽"），原因走独立追踪
      if (params.hasRetainedEvidence && params.hasRetainedEvidence() !== true) {
        return finishResult({ status: 'stopped_without_answer', content: '' })
      }
      return await finishWithClosingTurn('tool_chain_exhausted', iteration)
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createTextProtocolStreamFilter(allowedToolNames: Set<string>) {
  let pending = ''

  const names = Array.from(allowedToolNames)
  if (names.length === 0) {
    return {
      feed(chunk: string): string {
        const result = pending + chunk
        pending = ''
        return result
      },
      flush(): string {
        const result = pending
        pending = ''
        return result
      },
    }
  }

  const escapedNames = names.map(escapeRegex)
  const toolBlockRe = new RegExp(
    `<(${escapedNames.join('|')})>[\\s\\S]*?<\\/\\1>`,
    'g',
  )

  const safeEndAfter = (text: string): number => {
    const lastLt = text.lastIndexOf('<')
    if (lastLt === -1) return text.length

    const after = text.slice(lastLt)

    // '<' or '</' alone - could start any tag
    if (after === '<' || after === '</') return lastLt

    // Extract candidate tag name from '<name' or '</name' (with or without '>')
    const tagMatch = after.match(/^<\/?([a-zA-Z0-9_-]+)/)
    if (!tagMatch || !tagMatch[1]) {
      // '<' followed by non-alpha char (e.g. '< ', '<.') - not a tool tag
      return text.length
    }

    const candidate = tagMatch[1]
    if (allowedToolNames.has(candidate)) return lastLt

    // Check if candidate is a prefix of any allowed tool name
    for (const name of names) {
      if (name.startsWith(candidate)) return lastLt
    }

    return text.length
  }

  return {
    feed(chunk: string): string {
      pending += chunk

      const cleaned = pending.replace(toolBlockRe, '')
      const end = safeEndAfter(cleaned)
      const safe = cleaned.slice(0, end)
      pending = cleaned.slice(end)

      return safe
    },

    flush(): string {
      const cleaned = pending.replace(toolBlockRe, '')
      const end = safeEndAfter(cleaned)
      pending = ''
      return cleaned.slice(0, end)
    },
  }
}

function normalizeMaxToolRounds(raw: number): number {
  if (raw === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw)
  }
  return 1
}

function appendFollowupMessages(target: any[], messages?: any[]): void {
  if (!Array.isArray(messages) || messages.length === 0) return
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    target.push(message)
  }
}

function appendTextSchemaFollowupMessages(target: any[], messages?: any[]): void {
  if (!Array.isArray(messages) || messages.length === 0) return
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const role = typeof message.role === 'string' && message.role ? message.role : 'user'
    const content = flattenFollowupMessageContent(message.content)
    if (!content) continue
    target.push({ role, content })
  }
}

function flattenFollowupMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: any) => {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'text') return typeof part.text === 'string' ? part.text : ''
      if (part.type === 'image_url') {
        const url = part?.image_url?.url
        return typeof url === 'string' && url ? `[image:${url}]` : '[image]'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function executeTurnWithFallback(params: {
  provider: string
  schema: ToolSchema
  iteration: number
  messages: any[]
  stream: boolean
  toolsEnabled: boolean
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
  requestTurn: (params: ToolTurnRequestParams) => Promise<ToolTurnRequestResult>
  onSchemaFallback?: (schema: ToolSchema) => MaybePromise<void>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (
    usage: Record<string, any>,
    context: ToolTurnUsageContext,
  ) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  onTurnError?: (params: {
    error: unknown
    schema: ToolSchema
    iteration: number
    messages: any[]
  }) => MaybePromise<boolean>
  checkAbort?: () => void
}): Promise<{ schema: ToolSchema; parsed: ParsedToolTurn }> {
  let activeSchema = params.schema
  // 每轮内的真实请求序号：schema 回退与错误重试都会 +1
  let attempt = 0
  while (true) {
    try {
      attempt += 1
      const turnResult = await params.requestTurn({
        schema: activeSchema,
        messages: params.messages,
        iteration: params.iteration,
        stream: params.stream,
        toolsEnabled: params.toolsEnabled,
      })
      const normalized = normalizeTurnRequestResult(turnResult)
      try {
        const parsed = await parseToolTurnResponse({
          response: normalized.response,
          schema: activeSchema,
          stream: params.stream,
          toolDefinitions: params.toolDefinitions,
          allowedToolNames: params.allowedToolNames,
          onContentDelta: params.onContentDelta,
          onReasoningDelta: params.onReasoningDelta,
          onUsage: params.onUsage
            ? (usage: Record<string, any>) =>
                params.onUsage?.(usage, {
                  iteration: params.iteration,
                  attempt,
                  toolsEnabled: params.toolsEnabled,
                })
            : undefined,
          onStreamChunk: params.onStreamChunk,
          onFirstResponseEvent: params.onFirstResponseEvent,
          checkAbort: params.checkAbort,
        })
        return { schema: activeSchema, parsed }
      } finally {
        if (normalized.onDone) {
          await normalized.onDone()
        }
      }
    } catch (error) {
      const fallbackSchema = resolveFallbackSchema({
        provider: params.provider,
        schema: activeSchema,
        error,
      })
      if (!fallbackSchema) {
        if (params.onTurnError) {
          const shouldRetry = await params.onTurnError({
            error,
            schema: activeSchema,
            iteration: params.iteration,
            messages: params.messages,
          })
          if (shouldRetry) {
            continue
          }
        }
        throw error
      }
      activeSchema = fallbackSchema
      if (params.onSchemaFallback) {
        await params.onSchemaFallback(activeSchema)
      }
    }
  }
}

async function parseToolTurnResponse(params: {
  response: Response
  schema: ToolSchema
  stream: boolean
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (usage: Record<string, any>) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  checkAbort?: () => void
}): Promise<ParsedToolTurn> {
  const response = ensureResponseLike(params.response)
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw buildProviderRequestError(response, errorText)
  }
  if (!params.stream) {
    return parseNonStreamingTurn({
      response,
      schema: params.schema,
      toolDefinitions: params.toolDefinitions,
      allowedToolNames: params.allowedToolNames,
    })
  }
  return parseStreamingTurn({ ...params, response })
}

async function parseStreamingTurn(params: {
  response: Response
  schema: ToolSchema
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (usage: Record<string, any>) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  checkAbort?: () => void
}): Promise<ParsedToolTurn> {
  const reader = params.response.body?.getReader()
  if (!reader) {
    throw new Error('AI provider returned no response body')
  }

  const decoder = new TextDecoder()
  const textProtocolFilter =
    params.schema === 'text'
      ? createTextProtocolStreamFilter(params.allowedToolNames)
      : null
  const toolCallBuffers = createToolCallBuffers()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let usageSnapshot: Record<string, any> | null = null
  let sawSse = false
  let doneSeen = false
  let contentAlreadySent = false
  let firstResponseEventSeen = false
  let messageToolCalls: ToolCall[] = []
  let thinkingBlocks: Array<Record<string, any>> = []
  let legacyFunctionCall: LegacyFunctionCall | null = null
  let finishReason: string | null = null
  let responseStatus: string | null = null
  let incompleteReason: string | null = null
  let refusalText = ''

  const emitContentDelta = async (delta: string) => {
    if (!delta || !params.onContentDelta) return
    await params.onContentDelta(delta)
  }

  const emitReasoningDelta = async (delta: string) => {
    if (!delta || !params.onReasoningDelta) return
    await params.onReasoningDelta(delta)
  }

  const emitUsage = async (usage: Record<string, any> | null | undefined) => {
    if (!usage) return
    usageSnapshot = usage
    if (params.onUsage) {
      await params.onUsage(usage)
    }
  }

  const markFirstResponseEvent = async () => {
    if (firstResponseEventSeen) return
    firstResponseEventSeen = true
    if (params.onFirstResponseEvent) {
      await params.onFirstResponseEvent()
    }
  }

  const parseNonSsePayload = async (raw: string) => {
    if (!raw) return
    let parsed: any = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    await markFirstResponseEvent()
    if (Array.isArray(parsed?.output)) {
      content = extractTextFromResponsesResponse(parsed) || ''
      const reasoningText = extractReasoningFromResponsesResponse(parsed) || ''
      if (reasoningText) {
        reasoning += reasoningText
        await emitReasoningDelta(reasoningText)
      }
      const outputToolCalls = extractToolCallsFromResponsesOutput(parsed.output)
      if (outputToolCalls.length > 0) {
        messageToolCalls = outputToolCalls
      }
      const responsesSignal = readResponsesStatusSignal(parsed)
      responseStatus = responsesSignal.responseStatus
      incompleteReason = responsesSignal.incompleteReason
      const responsesRefusal = readResponsesRefusalText(parsed)
      if (responsesRefusal) {
        refusalText = responsesRefusal
      }
      await emitUsage(parsed?.usage)
      return
    }
    const message = parsed?.choices?.[0]?.message ?? {}
    const contentText = typeof message.content === 'string' ? message.content : ''
    if (contentText) {
      content = contentText
    }
    const reasoningText = extractMessageReasoning(message, parsed)
    if (reasoningText) {
      reasoning += reasoningText
      await emitReasoningDelta(reasoningText)
    }
    const nextToolCalls = extractToolCallsFromMessage(message)
    if (nextToolCalls.length > 0) {
      messageToolCalls = nextToolCalls
    }
    const nonSseFinishReason = readChatFinishReason(parsed)
    if (nonSseFinishReason) {
      finishReason = nonSseFinishReason
    }
    const nonSseRefusal = readChatRefusalText(parsed)
    if (nonSseRefusal) {
      refusalText = nonSseRefusal
    }
    await emitUsage(parsed?.usage)
  }

  try {
    while (true) {
      params.checkAbort?.()
      const { done, value } = await reader.read()
      if (value) {
        if (params.onStreamChunk) {
          await params.onStreamChunk()
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const normalized = line.replace(/\r$/, '')
          if (!normalized.startsWith('data:')) continue
          sawSse = true
          const data = normalized.slice(5).trimStart()
          if (!data) continue
          if (data === '[DONE]') {
            doneSeen = true
            break
          }
          let parsed: any = null
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          await markFirstResponseEvent()
          if (Array.isArray(parsed?.anthropic_thinking_blocks)) {
            thinkingBlocks = parsed.anthropic_thinking_blocks
          }
          if (typeof parsed?.type === 'string' && parsed.type.startsWith('response.')) {
            if (
              parsed.type === 'response.output_text.delta' &&
              typeof parsed.delta === 'string' &&
              parsed.delta
            ) {
              content += parsed.delta
              if (textProtocolFilter) {
                const safe = textProtocolFilter.feed(parsed.delta)
                if (safe) {
                  await emitContentDelta(safe)
                }
              } else {
                await emitContentDelta(parsed.delta)
                contentAlreadySent = true
              }
            } else if (
              (parsed.type === 'response.reasoning_text.delta' ||
                parsed.type === 'response.reasoning_summary_text.delta') &&
              typeof parsed.delta === 'string' &&
              parsed.delta
            ) {
              reasoning += parsed.delta
              await emitReasoningDelta(parsed.delta)
            } else if (
              parsed.type === 'response.refusal.delta' &&
              typeof parsed.delta === 'string' &&
              parsed.delta
            ) {
              // 拒答文本不进正文：只用于交付判定
              refusalText += parsed.delta
            } else if (
              parsed.type === 'response.completed' ||
              parsed.type === 'response.failed' ||
              parsed.type === 'response.incomplete'
            ) {
              doneSeen = true
              const completionSignal = readResponsesStatusSignal(parsed.response)
              responseStatus =
                completionSignal.responseStatus ??
                parsed.type.replace('response.', '')
              incompleteReason = completionSignal.incompleteReason
              const completionRefusal = readResponsesRefusalText(parsed.response)
              if (completionRefusal) {
                refusalText = completionRefusal
              }
              await emitUsage(parsed.response?.usage)
            }
            appendResponsesToolCallEvent(toolCallBuffers.responses, parsed)
            continue
          }

          const { contentDelta, reasoningDelta } = extractDeltaPayload(parsed)
          if (typeof contentDelta === 'string' && contentDelta) {
            content += contentDelta
            if (textProtocolFilter) {
              const safe = textProtocolFilter.feed(contentDelta)
              if (safe) {
                await emitContentDelta(safe)
              }
            } else {
              await emitContentDelta(contentDelta)
              contentAlreadySent = true
            }
          }
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            reasoning += reasoningDelta
            await emitReasoningDelta(reasoningDelta)
          }
          const choice = parsed?.choices?.[0]
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason
          }
          if (typeof choice?.message?.refusal === 'string' && choice.message.refusal.trim()) {
            refusalText = choice.message.refusal
          }
          const delta = choice?.delta || {}
          if (Array.isArray(delta.tool_calls)) {
            for (const toolDelta of delta.tool_calls) {
              appendOpenAIToolCallDelta(toolCallBuffers.openai, toolDelta)
            }
          }
          const legacyDelta = delta.function_call
          if (legacyDelta && typeof legacyDelta === 'object') {
            legacyFunctionCall = appendLegacyFunctionCallDelta(legacyFunctionCall, legacyDelta)
          }
          if (choice?.message && messageToolCalls.length === 0) {
            const nextToolCalls = extractToolCallsFromMessage(choice.message)
            if (nextToolCalls.length > 0) {
              messageToolCalls = nextToolCalls
            }
          }
          await emitUsage(parsed?.usage)
        }
      }
      if (doneSeen || done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (!sawSse) {
    await parseNonSsePayload(buffer.trim())
  }

  const { toolCalls, textContent } = parseToolCalls({
    openaiToolCallBuffers: toolCallBuffers.openai,
    responsesToolCallBuffers: toolCallBuffers.responses,
    messageToolCalls,
    legacyFunctionCall,
    textContent: content,
    textProtocolEnabled: params.schema === 'text',
    toolDefinitions: params.toolDefinitions,
    allowedToolNames: params.allowedToolNames,
  })
  const cleanedContent = typeof textContent === 'string' ? textContent : content

  if (textProtocolFilter) {
    const remaining = textProtocolFilter.flush()
    if (remaining) {
      await emitContentDelta(remaining)
    }
  } else if (!contentAlreadySent && cleanedContent) {
    await emitContentDelta(cleanedContent)
    contentAlreadySent = true
  }

  const messageContent =
    params.schema === 'text' && toolCalls.length > 0 ? content : cleanedContent

  return {
    content: messageContent,
    reasoning,
    toolCalls,
    usage: usageSnapshot,
    ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
    providerSignal: {
      finishReason,
      responseStatus,
      incompleteReason,
      refusalText: refusalText.trim() ? refusalText : null,
    },
  }
}

async function parseNonStreamingTurn(params: {
  response: Response
  schema: ToolSchema
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
}): Promise<ParsedToolTurn> {
  const raw = await params.response.text().catch(() => '')
  let parsed: any = null
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  let rawContent = ''
  let rawReasoning = ''
  let messageToolCalls: ToolCall[] = []
  let thinkingBlocks: Array<Record<string, any>> = []
  if (Array.isArray(parsed?.output)) {
    rawContent = extractTextFromResponsesResponse(parsed) || ''
    rawReasoning = extractReasoningFromResponsesResponse(parsed) || ''
    messageToolCalls = extractToolCallsFromResponsesOutput(parsed.output)
  } else {
    const message = parsed?.choices?.[0]?.message || {}
    rawContent = typeof message.content === 'string' ? message.content : ''
    rawReasoning = extractMessageReasoning(message, parsed)
    messageToolCalls = extractToolCallsFromMessage(message)
    if (Array.isArray(message.thinking_blocks)) {
      thinkingBlocks = message.thinking_blocks
    }
  }

  const { toolCalls, textContent } = parseToolCalls({
    openaiToolCallBuffers: new Map(),
    responsesToolCallBuffers: new Map(),
    messageToolCalls,
    legacyFunctionCall: null,
    textContent: rawContent,
    textProtocolEnabled: params.schema === 'text',
    toolDefinitions: params.toolDefinitions,
    allowedToolNames: params.allowedToolNames,
  })
  const cleanedContent = typeof textContent === 'string' ? textContent : rawContent
  const messageContent =
    params.schema === 'text' && toolCalls.length > 0 ? rawContent : cleanedContent

  const providerSignal: ProviderAnswerSignal = Array.isArray(parsed?.output)
    ? {
        ...readResponsesStatusSignal(parsed),
        refusalText: readResponsesRefusalText(parsed),
      }
    : {
        finishReason: readChatFinishReason(parsed),
        refusalText: readChatRefusalText(parsed),
      }

  return {
    content: messageContent,
    reasoning: rawReasoning,
    toolCalls,
    usage: parsed?.usage ?? null,
    ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
    providerSignal,
  }
}

async function executeToolCall(params: {
  toolName: string
  toolCall: ToolCall
  handleToolCall: (
    toolName: string,
    toolCall: ToolCall,
    args: Record<string, unknown>,
    iteration?: number,
  ) => Promise<ToolHandlerResult | null>
  allowedToolNames: Set<string>
  onUnsupportedTool?: (toolName: string, toolCallId: string | undefined) => MaybePromise<void>
  iteration?: number
}): Promise<ToolHandlerResult> {
  const args = safeParseToolArgs(params.toolCall)
  let result: ToolHandlerResult | null = null
  if (params.toolName && params.allowedToolNames.has(params.toolName)) {
    result = await params.handleToolCall(params.toolName, params.toolCall, args, params.iteration)
  }
  if (!result) {
    if (params.onUnsupportedTool) {
      await params.onUnsupportedTool(params.toolName || 'unknown', params.toolCall.id)
    }
    result = buildUnsupportedToolResult(params.toolCall.id, params.toolName || 'unknown')
  }
  return normalizeToolHandlerResult(result, params.toolCall.id)
}

function safeParseToolArgs(toolCall: ToolCall): Record<string, unknown> {
  try {
    const raw = toolCall?.function?.arguments
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function normalizeTurnRequestResult(result: ToolTurnRequestResult): {
  response: Response
  onDone?: () => MaybePromise<void>
} {
  if (isResponseLike(result)) {
    return { response: result as Response }
  }
  const responseCandidate = (result as any)?.response
  if (isResponseLike(responseCandidate)) {
    return {
      response: responseCandidate as Response,
      onDone: typeof (result as any)?.onDone === 'function' ? (result as any).onDone : undefined,
    }
  }
  throw new Error(
    `Tool orchestrator requestTurn must return Response or { response: Response }, got ${describeTurnResult(
      result,
    )}`,
  )
}

function ensureResponseLike(response: unknown): Response {
  if (isResponseLike(response)) {
    return response as Response
  }
  throw new Error(
    `Tool orchestrator received invalid provider response: ${describeTurnResult(response)}`,
  )
}

function isResponseLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.ok === 'boolean' &&
    typeof candidate.status === 'number' &&
    typeof candidate.text === 'function'
  )
}

function describeTurnResult(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value !== 'object') return typeof value
  if (Array.isArray(value)) return `array(length=${value.length})`
  const keys = Object.keys(value as Record<string, unknown>)
  const ctor =
    typeof (value as { constructor?: { name?: string } })?.constructor?.name === 'string'
      ? (value as { constructor?: { name?: string } }).constructor!.name
      : 'Object'
  return `${ctor}(${keys.join(',') || 'no-keys'})`
}

function resolveFallbackSchema(params: {
  provider: string
  schema: ToolSchema
  error: unknown
}): ToolSchema | null {
  if (
    params.schema === 'tools' &&
    params.provider !== 'openai_responses' &&
    isUnsupportedToolParamError(params.error)
  ) {
    return 'functions'
  }
  if (
    params.schema === 'functions' &&
    isUnsupportedFunctionParamError(params.error)
  ) {
    return 'text'
  }
  return null
}

function isUpstreamImageRejection(error: unknown): boolean {
  if (!(error instanceof Error) || !('status' in error)) return false
  const { message, status } = error
  if (status !== 400 && status !== 422) return false
  return /\bcould not process an image\b/i.test(message) ||
    (/\bfunction_call_output\b|\binput\[\d+\]\.output\b/i.test(message) &&
      /\b(?:must be|expected|valid) (?:a )?string\b/i.test(message))
}

function buildProviderRequestError(response: Response, rawText: string): Error {
  let payload: any = null
  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }
  const requestError: any = new Error(
    `AI provider request failed (${response.status}): ${rawText}`,
  )
  requestError.status = response.status
  if (payload) {
    requestError.payload = payload
  }
  return requestError
}

/** Chat Completions：choices[0].finish_reason */
function readChatFinishReason(payload: any): string | null {
  const finishReason = payload?.choices?.[0]?.finish_reason
  return typeof finishReason === 'string' && finishReason.trim() ? finishReason : null
}

/** Chat Completions：choices[0].message.refusal（provider 明确拒答） */
function readChatRefusalText(payload: any): string | null {
  const refusal = payload?.choices?.[0]?.message?.refusal
  return typeof refusal === 'string' && refusal.trim() ? refusal : null
}

/** Responses API：output[] 里的 refusal 内容块 */
function readResponsesRefusalText(payload: any): string | null {
  const output = Array.isArray(payload?.output) ? payload.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object' || item.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (part?.type === 'refusal' && typeof part.refusal === 'string' && part.refusal.trim()) {
        parts.push(part.refusal.trim())
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

/** Responses API：response.status / response.incomplete_details.reason */
function readResponsesStatusSignal(payload: any): {
  responseStatus: string | null
  incompleteReason: string | null
} {
  const status = payload?.status
  const incompleteReason = payload?.incomplete_details?.reason
  return {
    responseStatus: typeof status === 'string' && status.trim() ? status : null,
    incompleteReason:
      typeof incompleteReason === 'string' && incompleteReason.trim() ? incompleteReason : null,
  }
}

function extractMessageReasoning(message: any, payload?: any): string {
  return (
    (typeof message?.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message?.reasoning === 'string' && message.reasoning) ||
    (typeof message?.analysis === 'string' && message.analysis) ||
    (typeof payload?.reasoning === 'string' && payload.reasoning) ||
    (typeof payload?.analysis === 'string' && payload.analysis) ||
    ''
  )
}

function extractDeltaPayload(payload: any): {
  contentDelta: string
  reasoningDelta: string
} {
  const contentDelta =
    payload?.choices?.[0]?.delta?.content ??
    payload?.choices?.[0]?.delta?.text ??
    payload?.delta?.content ??
    payload?.delta?.text ??
    payload?.choices?.[0]?.message?.content ??
    payload?.text ??
    ''

  const reasoningDelta =
    payload?.choices?.[0]?.delta?.reasoning_content ??
    payload?.choices?.[0]?.delta?.reasoning ??
    payload?.choices?.[0]?.delta?.thinking ??
    payload?.choices?.[0]?.delta?.analysis ??
    payload?.delta?.reasoning_content ??
    payload?.delta?.reasoning ??
    payload?.message?.reasoning_content ??
    payload?.message?.reasoning ??
    payload?.reasoning ??
    payload?.analysis ??
    ''

  return { contentDelta, reasoningDelta }
}