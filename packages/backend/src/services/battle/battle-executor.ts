import type { Connection } from '@prisma/client'
import type { ChatRequestBuilder, PreparedChatRequest } from '../../modules/chat/services/chat-request-builder'
import { chatRequestBuilder as defaultChatRequestBuilder } from '../../modules/chat/services/chat-request-builder'
import type { ProviderRequester } from '../../modules/chat/services/provider-requester'
import { providerRequester as defaultProviderRequester } from '../../modules/chat/services/provider-requester'
import { buildChatProviderRequest } from '../../utils/chat-provider'
import {
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
  buildAgentWebSearchConfig,
} from '../../modules/chat/agent-tool-config'
import {
  buildToolRequest,
} from '../../modules/chat/tool-protocol'
import { runToolOrchestration } from '../../modules/chat/tool-orchestrator'
import type { TaskTraceRecorder } from '../../utils/task-trace'
import type { BattleUploadImage } from '@aichat/shared/battle-contract'
import type { BattleModelInput, BattleModelSkills } from './battle-types'
import { safeParseJson } from './battle-serialization'
import { createSkillRegistry } from '../../modules/skills/skill-registry'
import { BUILTIN_SKILL_SLUGS, normalizeRequestedSkills } from '../../modules/skills/types'

export interface BattleExecutionContext {
  checkRunCancelled: () => void
  checkAttemptCancelled: () => void
  buildAbortHandlers: () => { onControllerReady?: (controller: AbortController | null) => void; onControllerClear?: () => void }
  traceRecorder?: TaskTraceRecorder | null
  buildTraceContext: (extra?: Record<string, unknown>) => Record<string, unknown>
  battleRunId?: number | null
  actorUserId?: number | null
  actorIdentifier?: string
  sendStreamEvent?: (payload: Record<string, unknown>) => void
}

export interface BattleExecutorDeps {
  requestBuilder?: ChatRequestBuilder
  requester?: ProviderRequester
}

const extractJsonObject = (raw: string) => {
  const fenced = raw.match(/```(?:json)?([\s\S]*?)```/i)
  const source = (fenced?.[1] || raw || '').trim()
  const match = source.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Judge JSON not found')
  }
  return match[0]
}

const normalizeJudgeScore = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  let score = value
  if (score > 1 && score <= 100) {
    score = score / 100
  }
  return Math.min(1, Math.max(0, score))
}

const resolveMaxToolIterations = (sysMap: Record<string, string>) => {
  const raw = sysMap.agent_max_tool_iterations || process.env.AGENT_MAX_TOOL_ITERATIONS || '4'
  const parsed = Number.parseInt(String(raw), 10)
  if (Number.isFinite(parsed) && parsed >= 0) {
    if (parsed === 0) {
      return Number.POSITIVE_INFINITY
    }
    return Math.min(20, parsed)
  }
  return 4
}

const buildUsage = (json: any, context: { promptTokens: number; contextLimit: number; contextRemaining: number }) => {
  const u = json?.usage || {}
  const promptTokens =
    Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? context.promptTokens) ||
    context.promptTokens
  const completionTokens =
    Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
  const totalTokens =
    Number(u?.total_tokens ?? 0) || promptTokens + (Number(u?.completion_tokens ?? 0) || 0)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    context_limit: context.contextLimit,
    context_remaining: context.contextRemaining,
  }
}

export class BattleExecutor {
  private requestBuilder: ChatRequestBuilder
  private requester: ProviderRequester

  constructor(deps: BattleExecutorDeps = {}) {
    this.requestBuilder = deps.requestBuilder ?? defaultChatRequestBuilder
    this.requester = deps.requester ?? defaultProviderRequester
  }

  async executeModel(params: {
    prompt: string
    promptImages?: BattleUploadImage[]
    modelConfig: BattleModelInput
    resolved: { connection: Connection; rawModelId: string }
    systemSettings: Record<string, string>
    context: BattleExecutionContext
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void
  }) {
    const { prompt, promptImages, modelConfig, resolved, systemSettings, context, emitDelta } = params
    context.checkRunCancelled()
    context.checkAttemptCancelled()

    const session = this.buildVirtualSession(resolved.connection, resolved.rawModelId)
    const requestedSkills = normalizeRequestedSkills(modelConfig.skills)
    const requestedSkillSet = new Set(requestedSkills.enabled)
    const webSearchConfig = buildAgentWebSearchConfig(systemSettings)
    const pythonConfig = buildAgentPythonToolConfig(systemSettings)
    const urlReaderConfig = buildAgentUrlReaderConfig(systemSettings)

    const webSearchOverride = requestedSkills.overrides?.[BUILTIN_SKILL_SLUGS.WEB_SEARCH] || {}
    if (typeof webSearchOverride.scope === 'string') {
      webSearchConfig.scope = webSearchOverride.scope
    }
    if (typeof webSearchOverride.includeSummary === 'boolean') {
      webSearchConfig.includeSummary = webSearchOverride.includeSummary
    } else if (typeof webSearchOverride.include_summary === 'boolean') {
      webSearchConfig.includeSummary = webSearchOverride.include_summary
    }
    if (typeof webSearchOverride.includeRawContent === 'boolean') {
      webSearchConfig.includeRawContent = webSearchOverride.includeRawContent
    } else if (typeof webSearchOverride.include_raw === 'boolean') {
      webSearchConfig.includeRawContent = webSearchOverride.include_raw
    }
    const resultLimitOverrideRaw =
      typeof webSearchOverride.resultLimit === 'number'
        ? webSearchOverride.resultLimit
        : typeof webSearchOverride.result_limit === 'number'
          ? webSearchOverride.result_limit
          : typeof webSearchOverride.size === 'number'
            ? webSearchOverride.size
            : null
    if (typeof resultLimitOverrideRaw === 'number' && Number.isFinite(resultLimitOverrideRaw)) {
      webSearchConfig.resultLimit = Math.max(1, Math.min(10, resultLimitOverrideRaw))
    }

    const webSearchRequested = requestedSkillSet.has(BUILTIN_SKILL_SLUGS.WEB_SEARCH)
    const pythonRequested = requestedSkillSet.has(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER)
    const urlReaderRequested =
      requestedSkillSet.has(BUILTIN_SKILL_SLUGS.URL_READER) || webSearchRequested
    const webSearchActive =
      webSearchRequested &&
      webSearchConfig.enabled &&
      Boolean(webSearchConfig.apiKey)
    const pythonActive =
      pythonRequested &&
      pythonConfig.enabled
    const urlReaderActive = urlReaderRequested
    const builtinSkillSet = new Set<string>([
      BUILTIN_SKILL_SLUGS.WEB_SEARCH,
      BUILTIN_SKILL_SLUGS.PYTHON_RUNNER,
      BUILTIN_SKILL_SLUGS.URL_READER,
    ])
    const effectiveEnabled = requestedSkills.enabled.filter((slug) => !builtinSkillSet.has(slug))
    if (webSearchActive) effectiveEnabled.push(BUILTIN_SKILL_SLUGS.WEB_SEARCH)
    if (pythonActive) effectiveEnabled.push(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER)
    if (urlReaderActive) effectiveEnabled.push(BUILTIN_SKILL_SLUGS.URL_READER)
    const effectiveSkills: BattleModelSkills = {
      enabled: Array.from(new Set(effectiveEnabled)),
      ...(requestedSkills.overrides ? { overrides: requestedSkills.overrides } : {}),
    }

    const payload: any = {
      sessionId: 0,
      content: prompt,
      reasoningEnabled: modelConfig.reasoningEnabled,
      reasoningEffort: modelConfig.reasoningEffort,
      ollamaThink: modelConfig.ollamaThink,
      contextEnabled: false,
      skills: effectiveSkills,
      custom_body: modelConfig.custom_body,
      custom_headers: modelConfig.custom_headers,
    }

    const extraPrompt = typeof modelConfig.extraPrompt === 'string' ? modelConfig.extraPrompt.trim() : ''

    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content: prompt,
      images: promptImages || [],
      mode: emitDelta ? 'stream' : 'completion',
      personalPrompt: null,
      extraSystemPrompts: extraPrompt ? [extraPrompt] : [],
    })

    if (effectiveSkills.enabled.length > 0) {
      return this.executeWithTools(
        prepared,
        {
          skills: effectiveSkills,
          webSearchActive,
          pythonActive,
          urlReaderActive,
          webSearchConfig,
          pythonConfig,
          urlReaderConfig,
        },
        context,
        emitDelta,
      )
    }

    if (emitDelta) {
      return this.executeStreaming(prepared, context, emitDelta)
    }
    return this.executeSimple(prepared, context)
  }

  async judgeAnswer(params: {
    prompt: string
    promptImages?: BattleUploadImage[]
    expectedAnswer: string
    expectedAnswerImages?: BattleUploadImage[]
    answer: string
    threshold: number
    judgeModel: { connection: Connection; rawModelId: string }
    context: BattleExecutionContext
  }) {
    const {
      prompt,
      promptImages,
      expectedAnswer,
      expectedAnswerImages,
      answer,
      threshold,
      judgeModel,
      context,
    } = params
    context.checkRunCancelled()
    context.checkAttemptCancelled()

    const questionImageCount = Array.isArray(promptImages) ? promptImages.length : 0
    const expectedImageCount = Array.isArray(expectedAnswerImages) ? expectedAnswerImages.length : 0
    const judgePrompt = this.buildJudgePrompt(prompt, expectedAnswer, answer, questionImageCount, expectedImageCount)
    const session = this.buildVirtualSession(judgeModel.connection, judgeModel.rawModelId)
    const payload: any = {
      sessionId: 0,
      content: judgePrompt,
      contextEnabled: false,
      custom_body: { temperature: 0 },
    }

    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content: judgePrompt,
      images: [...(promptImages || []), ...(expectedAnswerImages || [])],
      mode: 'completion',
      personalPrompt: null,
    })

    const response = await this.requester.requestWithBackoff({
      request: {
        url: prepared.providerRequest.url,
        headers: prepared.providerRequest.headers,
        body: prepared.providerRequest.body,
      },
      context: {
        sessionId: 0,
        provider: prepared.providerRequest.providerLabel,
        route: '/api/battle/judge',
        timeoutMs: prepared.providerRequest.timeoutMs,
      },
      traceRecorder: context.traceRecorder,
      traceContext: context.buildTraceContext({
        phase: 'judge',
        mode: 'completion',
      }),
      ...context.buildAbortHandlers(),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Judge API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const json = (await response.json()) as any
    const text = json?.choices?.[0]?.message?.content || ''
    if (!text.trim()) {
      throw new Error('裁判模型未返回有效内容')
    }

    const parsedRaw = extractJsonObject(text)
    const parsed = safeParseJson<Record<string, any>>(parsedRaw, {})
    const passField = typeof parsed.pass === 'boolean' ? parsed.pass : null
    const score = normalizeJudgeScore(parsed.score)
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null

    const fallbackUsed = passField === null
    const pass = passField !== null ? passField : (score != null ? score >= threshold : false)

    return {
      pass,
      score,
      reason,
      fallbackUsed,
      raw: parsed,
    }
  }

  private async executeSimple(
    prepared: PreparedChatRequest,
    context: BattleExecutionContext,
  ) {
    context.checkRunCancelled()
    context.checkAttemptCancelled()
    const response = await this.requester.requestWithBackoff({
      request: {
        url: prepared.providerRequest.url,
        headers: prepared.providerRequest.headers,
        body: prepared.providerRequest.body,
      },
      context: {
        sessionId: 0,
        provider: prepared.providerRequest.providerLabel,
        route: '/api/battle/execute',
        timeoutMs: prepared.providerRequest.timeoutMs,
      },
      traceRecorder: context.traceRecorder,
      traceContext: context.buildTraceContext({
        phase: 'execute',
        mode: 'completion',
      }),
      ...context.buildAbortHandlers(),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const json = (await response.json()) as any
    const text = json?.choices?.[0]?.message?.content || ''
    if (!text.trim()) {
      throw new Error('模型未返回有效文本')
    }

    const usage = buildUsage(json, {
      promptTokens: prepared.promptTokens,
      contextLimit: prepared.contextLimit,
      contextRemaining: prepared.contextRemaining,
    })

    return { content: text, usage }
  }

  private async executeStreaming(
    prepared: PreparedChatRequest,
    context: BattleExecutionContext,
    emitDelta: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    context.checkRunCancelled()
    context.checkAttemptCancelled()
    const response = await this.requester.requestWithBackoff({
      request: {
        url: prepared.providerRequest.url,
        headers: prepared.providerRequest.headers,
        body: prepared.providerRequest.body,
      },
      context: {
        sessionId: 0,
        provider: prepared.providerRequest.providerLabel,
        route: '/api/battle/execute',
        timeoutMs: prepared.providerRequest.timeoutMs,
      },
      traceRecorder: context.traceRecorder,
      traceContext: context.buildTraceContext({
        phase: 'execute',
        mode: 'stream',
      }),
      ...context.buildAbortHandlers(),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let doneSeen = false
    let sawSse = false
    let sawJson = false
    let usage: Record<string, any> = {}

    const pushContent = (delta: string) => {
      if (!delta) return
      content += delta
      emitDelta({ content: delta })
    }

    const pushReasoning = (delta: string) => {
      if (!delta) return
      emitDelta({ reasoning: delta })
    }

    const recordUsage = (payload: any) => {
      if (!payload) return
      usage = buildUsage(
        { usage: payload.usage ?? payload },
        {
          promptTokens: prepared.promptTokens,
          contextLimit: prepared.contextLimit,
          contextRemaining: prepared.contextRemaining,
        },
      )
    }

    const extractDeltaPayload = (payload: any) => {
      const contentDelta =
        payload?.choices?.[0]?.delta?.content ??
        payload?.choices?.[0]?.delta?.text ??
        payload?.delta?.content ??
        payload?.delta?.text ??
        payload?.message?.content ??
        payload?.response ??
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

    const handleJsonPayload = (payload: any) => {
      if (!payload) return
      const { contentDelta, reasoningDelta } = extractDeltaPayload(payload)
      if (typeof contentDelta === 'string' && contentDelta) {
        pushContent(contentDelta)
      }
      if (typeof reasoningDelta === 'string' && reasoningDelta) {
        pushReasoning(reasoningDelta)
      }
      if (payload?.done === true) {
        doneSeen = true
      }
      if (payload?.usage || payload?.prompt_eval_count != null || payload?.eval_count != null) {
        recordUsage(payload)
      }
    }

    const handleLine = (line: string) => {
      const trimmed = line.replace(/\r$/, '')
      if (!trimmed) return
      if (trimmed.startsWith('data:')) {
        sawSse = true
        const data = trimmed.slice(5).trimStart()
        if (!data) return
        if (data === '[DONE]') {
          doneSeen = true
          return
        }
        try {
          const parsed = JSON.parse(data)
          handleJsonPayload(parsed)
        } catch {
          return
        }
        return
      }

      if (sawSse) return

      try {
        const parsed = JSON.parse(trimmed)
        sawJson = true
        handleJsonPayload(parsed)
      } catch {
        return
      }
    }

    try {
      while (true) {
        context.checkRunCancelled()
        context.checkAttemptCancelled()
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            handleLine(line)
            if (doneSeen) break
          }
        }
        if (doneSeen || done) break
      }

      if (!doneSeen && buffer.trim()) {
        handleLine(buffer.trim())
      }
    } finally {
      reader.releaseLock()
    }

    if (!content.trim() && !sawJson && buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim())
        handleJsonPayload(parsed)
      } catch {
        // ignore
      }
    }

    if (!content.trim()) {
      throw new Error('模型未返回有效文本')
    }

    return { content, usage }
  }

  private async executeWithTools(
    prepared: PreparedChatRequest,
    toolFlags: {
      skills: BattleModelSkills
      webSearchActive: boolean
      pythonActive: boolean
      urlReaderActive: boolean
      webSearchConfig: ReturnType<typeof buildAgentWebSearchConfig>
      pythonConfig: ReturnType<typeof buildAgentPythonToolConfig>
      urlReaderConfig: ReturnType<typeof buildAgentUrlReaderConfig>
    },
    context: BattleExecutionContext,
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    const provider = prepared.providerRequest.providerLabel
    const streamEnabled = provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai'
    const shouldStream = Boolean(emitDelta) && streamEnabled

    const sysMap = prepared.systemSettings
    const toolRegistry = await createSkillRegistry({
      requestedSkills: toolFlags.skills,
      sessionId: 0,
      actorUserId: context.actorUserId ?? null,
      battleRunId: context.battleRunId ?? null,
      builtins: {
        webSearch: toolFlags.webSearchActive ? toolFlags.webSearchConfig : null,
        python: toolFlags.pythonActive ? toolFlags.pythonConfig : null,
        urlReader: toolFlags.urlReaderActive
          ? {
              enabled: true,
              timeout: toolFlags.urlReaderConfig.timeout,
              maxContentLength: toolFlags.urlReaderConfig.maxContentLength,
            }
          : null,
      },
    })
    const toolDefinitions = toolRegistry.getToolDefinitions()
    const allowedToolNames = toolRegistry.getAllowedToolNames()
    if (toolDefinitions.length === 0) {
      throw new Error('当前 Battle 配置请求了 Skills，但未找到可执行工具')
    }
    const maxIterations = resolveMaxToolIterations(sysMap)
    let latestUsage: Record<string, any> | null = null

    const orchestration = await runToolOrchestration({
      provider,
      requestData: prepared.baseRequestBody,
      initialMessages: prepared.messagesPayload,
      toolDefinitions,
      allowedToolNames,
      maxIterations,
      stream: shouldStream,
      includeReasoningInToolMessage: true,
      emptyContentErrorMessage: '模型未返回有效文本',
      checkAbort: () => {
        context.checkRunCancelled()
        context.checkAttemptCancelled()
      },
      onContentDelta: shouldStream && emitDelta
        ? async (delta) => {
          emitDelta({ content: delta })
        }
        : undefined,
      onReasoningDelta: shouldStream && emitDelta
        ? async (delta) => {
          emitDelta({ reasoning: delta })
        }
        : undefined,
      onUsage: async (usage) => {
        latestUsage = usage
      },
      requestTurn: async ({ schema, messages, iteration, stream }) => {
        const { body: chatBody, messages: preparedMessages, textPromptAdded } = buildToolRequest({
          requestData: prepared.baseRequestBody,
          messages,
          toolDefinitions,
          schema,
          provider,
          stream,
        })
        if (textPromptAdded) {
          messages.splice(0, messages.length, ...preparedMessages)
        }
        const { url, body } = buildChatProviderRequest({
          provider,
          baseUrl: prepared.providerRequest.baseUrl,
          rawModelId: prepared.providerRequest.rawModelId,
          body: chatBody,
          azureApiVersion: prepared.providerRequest.azureApiVersion,
          stream,
        })
        return this.requester.requestWithBackoff({
          request: {
            url,
            headers: prepared.providerRequest.headers,
            body,
          },
          context: {
            sessionId: 0,
            provider,
            route: '/api/battle/execute',
            timeoutMs: prepared.providerRequest.timeoutMs,
          },
          traceRecorder: context.traceRecorder,
          traceContext: context.buildTraceContext({
            phase: 'tool',
            mode: stream ? 'stream' : 'completion',
            iteration,
          }),
          ...context.buildAbortHandlers(),
        })
      },
      handleToolCall: async (toolName, toolCall, args) => {
        if (!toolName || !allowedToolNames.has(toolName)) return null
        return toolRegistry.handleToolCall(toolName, toolCall, args, {
          sessionId: 0,
          actorIdentifier: context.actorIdentifier || 'battle',
          actorUserId: context.actorUserId ?? null,
          emitReasoning: () => {},
          sendToolEvent: () => {},
          sendStreamEvent: context.sendStreamEvent,
          battleRunId: context.battleRunId ?? null,
        })
      },
    })

    const usageSource = orchestration.usage ?? latestUsage
    if (orchestration.status !== 'completed') {
      const iterationLabel = Number.isFinite(maxIterations)
        ? String(maxIterations)
        : '无限制'
      throw new Error(`工具调用次数已达上限（${iterationLabel}），未生成最终答案`)
    }

    const usage = usageSource
      ? buildUsage(
        { usage: usageSource },
        {
          promptTokens: prepared.promptTokens,
          contextLimit: prepared.contextLimit,
          contextRemaining: prepared.contextRemaining,
        },
      )
      : {}
    if (emitDelta && !shouldStream) {
      emitDelta({ content: orchestration.content })
    }
    return {
      content: orchestration.content,
      usage,
    }
  }

  private buildJudgePrompt(
    question: string,
    expectedAnswer: string,
    answer: string,
    questionImageCount: number,
    expectedImageCount: number,
  ) {
    const imageHint = (() => {
      if (questionImageCount <= 0 && expectedImageCount <= 0) return '无图片输入。'
      const lines: string[] = []
      if (questionImageCount > 0) {
        lines.push(`前 ${questionImageCount} 张图为“问题图片”，编号 Q1..Q${questionImageCount}。`)
      }
      if (expectedImageCount > 0) {
        lines.push(
          `接下来的 ${expectedImageCount} 张图为“期望答案图片”，编号 E1..E${expectedImageCount}。`,
        )
      }
      return lines.join(' ')
    })()

    return [
      '你是严格的答案裁判，只输出 JSON，不要包含多余解释。',
      '请根据“问题”和“期望答案”判断“模型答案”是否准确。',
      '输出格式：{"pass": true/false, "score": 0~1, "reason": "简短原因"}',
      `图片说明：${imageHint}`,
      '',
      `问题：${question}`,
      `期望答案：${expectedAnswer}`,
      `模型答案：${answer}`,
    ].join('\n')
  }

  private buildVirtualSession(connection: Connection, rawModelId: string) {
    return {
      id: -1,
      userId: null,
      anonymousKey: null,
      expiresAt: null,
      connectionId: connection.id,
      modelRawId: rawModelId,
      title: 'Battle',
      createdAt: new Date(),
      pinnedAt: null,
      reasoningEnabled: null,
      reasoningEffort: null,
      ollamaThink: null,
      systemPrompt: null,
      connection,
    } as any
  }
}
