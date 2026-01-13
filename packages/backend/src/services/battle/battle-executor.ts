import crypto from 'node:crypto'
import type { Connection } from '@prisma/client'
import type { ChatRequestBuilder, PreparedChatRequest } from '../../modules/chat/services/chat-request-builder'
import { chatRequestBuilder as defaultChatRequestBuilder } from '../../modules/chat/services/chat-request-builder'
import type { ProviderRequester } from '../../modules/chat/services/provider-requester'
import { providerRequester as defaultProviderRequester } from '../../modules/chat/services/provider-requester'
import { convertOpenAIReasoningPayload } from '../../utils/providers'
import { convertChatCompletionsRequestToResponses, extractReasoningFromResponsesResponse, extractTextFromResponsesResponse } from '../../utils/openai-responses'
import { buildAgentPythonToolConfig, buildAgentWebSearchConfig } from '../../modules/chat/agent-tool-config'
import {
  createToolHandlerRegistry,
  type ToolCall,
  type ToolHandlerResult,
} from '../../modules/chat/tool-handlers'
import type { TaskTraceRecorder } from '../../utils/task-trace'
import type { BattleModelFeatures, BattleModelInput } from './battle-types'
import { safeParseJson } from './battle-serialization'

export interface BattleExecutionContext {
  checkRunCancelled: () => void
  checkAttemptCancelled: () => void
  buildAbortHandlers: () => { onControllerReady?: (controller: AbortController | null) => void; onControllerClear?: () => void }
  traceRecorder?: TaskTraceRecorder | null
  buildTraceContext: (extra?: Record<string, unknown>) => Record<string, unknown>
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
  if (Number.isFinite(parsed) && parsed > 0) {
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
    modelConfig: BattleModelInput
    resolved: { connection: Connection; rawModelId: string }
    systemSettings: Record<string, string>
    context: BattleExecutionContext
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void
  }) {
    const { prompt, modelConfig, resolved, systemSettings, context, emitDelta } = params
    context.checkRunCancelled()
    context.checkAttemptCancelled()

    const session = this.buildVirtualSession(resolved.connection, resolved.rawModelId)
    const providerSupportsTools =
      resolved.connection.provider === 'openai' ||
      resolved.connection.provider === 'openai_responses' ||
      resolved.connection.provider === 'azure_openai'
    const requestedFeatures = modelConfig.features || {}
    const webSearchConfig = buildAgentWebSearchConfig(systemSettings)
    const pythonConfig = buildAgentPythonToolConfig(systemSettings)
    const webSearchActive =
      providerSupportsTools &&
      requestedFeatures.web_search === true &&
      webSearchConfig.enabled &&
      Boolean(webSearchConfig.apiKey)
    const pythonActive =
      providerSupportsTools &&
      requestedFeatures.python_tool === true &&
      pythonConfig.enabled
    const effectiveFeatures: BattleModelFeatures = {
      ...requestedFeatures,
      web_search: webSearchActive,
      python_tool: pythonActive,
    }
    if (!webSearchActive) {
      delete effectiveFeatures.web_search_scope
      delete effectiveFeatures.web_search_include_summary
      delete effectiveFeatures.web_search_include_raw
      delete effectiveFeatures.web_search_size
    }

    const payload: any = {
      sessionId: 0,
      content: prompt,
      reasoningEnabled: modelConfig.reasoningEnabled,
      reasoningEffort: modelConfig.reasoningEffort,
      ollamaThink: modelConfig.ollamaThink,
      contextEnabled: false,
      features: effectiveFeatures,
      custom_body: modelConfig.custom_body,
      custom_headers: modelConfig.custom_headers,
    }

    const extraPrompt = typeof modelConfig.extraPrompt === 'string' ? modelConfig.extraPrompt.trim() : ''

    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content: prompt,
      images: [],
      mode: emitDelta ? 'stream' : 'completion',
      personalPrompt: null,
      extraSystemPrompts: extraPrompt ? [extraPrompt] : [],
    })

    if (effectiveFeatures.web_search || effectiveFeatures.python_tool) {
      return this.executeWithTools(
        prepared,
        { webSearchActive, pythonActive, features: effectiveFeatures },
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
    expectedAnswer: string
    answer: string
    threshold: number
    judgeModel: { connection: Connection; rawModelId: string }
    context: BattleExecutionContext
  }) {
    const { prompt, expectedAnswer, answer, threshold, judgeModel, context } = params
    context.checkRunCancelled()
    context.checkAttemptCancelled()

    const judgePrompt = this.buildJudgePrompt(prompt, expectedAnswer, answer)
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
      images: [],
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
    toolFlags: { webSearchActive: boolean; pythonActive: boolean; features: BattleModelFeatures },
    context: BattleExecutionContext,
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    const provider = prepared.providerRequest.providerLabel
    if (provider !== 'openai' && provider !== 'openai_responses' && provider !== 'azure_openai') {
      return this.executeSimple(prepared, context)
    }

    const sysMap = prepared.systemSettings
    const webSearchConfig = buildAgentWebSearchConfig(sysMap)
    const pythonConfig = buildAgentPythonToolConfig(sysMap)
    const requestedFeatures = toolFlags.features || {}
    if (typeof requestedFeatures.web_search_scope === 'string') {
      webSearchConfig.scope = requestedFeatures.web_search_scope
    }
    if (typeof requestedFeatures.web_search_include_summary === 'boolean') {
      webSearchConfig.includeSummary = requestedFeatures.web_search_include_summary
    }
    if (typeof requestedFeatures.web_search_include_raw === 'boolean') {
      webSearchConfig.includeRawContent = requestedFeatures.web_search_include_raw
    }
    if (typeof requestedFeatures.web_search_size === 'number' && Number.isFinite(requestedFeatures.web_search_size)) {
      const next = Math.max(1, Math.min(10, requestedFeatures.web_search_size))
      webSearchConfig.resultLimit = next
    }

    const toolRegistry = createToolHandlerRegistry({
      webSearch: toolFlags.webSearchActive ? webSearchConfig : null,
      python: toolFlags.pythonActive ? pythonConfig : null,
    })
    const toolDefinitions = toolRegistry.getToolDefinitions()
    const allowedToolNames = toolRegistry.getAllowedToolNames()
    const maxIterations = resolveMaxToolIterations(sysMap)

    let workingMessages = prepared.messagesPayload.map((msg) => ({ ...msg }))
    let lastUsage = null as any

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      context.checkRunCancelled()
      context.checkAttemptCancelled()
      if (emitDelta) {
        const streamed = await this.streamToolIteration({
          prepared,
          provider,
          messages: workingMessages,
          toolDefinitions,
          context,
          emitDelta,
        })
        if (streamed.usage) {
          lastUsage = streamed.usage
        }
        if (streamed.toolCalls.length === 0) {
          const text = streamed.content || ''
          if (!text.trim()) {
            throw new Error('模型未返回有效文本')
          }
          const usage = streamed.usage
            ? buildUsage({ usage: streamed.usage }, {
              promptTokens: prepared.promptTokens,
              contextLimit: prepared.contextLimit,
              contextRemaining: prepared.contextRemaining,
            })
            : {}
          return { content: text, usage }
        }

        workingMessages = workingMessages.concat({
          role: 'assistant',
          content: streamed.content || '',
          tool_calls: streamed.toolCalls,
        })

        for (const toolCall of streamed.toolCalls) {
          const toolName = toolCall?.function?.name || ''
          const args = this.safeParseToolArgs(toolCall)
          let result: ToolHandlerResult | null = null
          if (toolName && allowedToolNames.has(toolName)) {
            result = await toolRegistry.handleToolCall(toolName, toolCall as ToolCall, args, {
              sessionId: 0,
              emitReasoning: () => {},
              sendToolEvent: () => {},
            })
          }
          if (!result) {
            result = {
              toolCallId: toolCall.id || crypto.randomUUID(),
              toolName: toolName || 'unknown',
              message: {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolName || 'unknown',
                content: JSON.stringify({ error: 'Unsupported tool requested by the model' }),
              },
            }
          }

          workingMessages = workingMessages.concat(result.message)
        }
        continue
      }

      const body = convertOpenAIReasoningPayload({
        ...prepared.baseRequestBody,
        stream: false,
        messages: workingMessages,
        tools: toolDefinitions,
        tool_choice: 'auto',
      })

      const response = await this.requester.requestWithBackoff({
        request: {
          url: prepared.providerRequest.url,
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
          iteration,
        }),
        ...context.buildAbortHandlers(),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
      }

      const json = (await response.json()) as any
      const message = json?.choices?.[0]?.message || {}
      lastUsage = json?.usage ?? null

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (toolCalls.length === 0) {
        const text = message.content || ''
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

      workingMessages = workingMessages.concat({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls,
      })

      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name || ''
        const args = this.safeParseToolArgs(toolCall)
        let result: ToolHandlerResult | null = null
        if (toolName && allowedToolNames.has(toolName)) {
          result = await toolRegistry.handleToolCall(toolName, toolCall as ToolCall, args, {
            sessionId: 0,
            emitReasoning: () => {},
            sendToolEvent: () => {},
          })
        }
        if (!result) {
          result = {
            toolCallId: toolCall.id || crypto.randomUUID(),
            toolName: toolName || 'unknown',
            message: {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName || 'unknown',
              content: JSON.stringify({ error: 'Unsupported tool requested by the model' }),
            },
          }
        }

        workingMessages = workingMessages.concat(result.message)
      }
    }

    const fallbackUsage = lastUsage ? buildUsage({ usage: lastUsage }, {
      promptTokens: prepared.promptTokens,
      contextLimit: prepared.contextLimit,
      contextRemaining: prepared.contextRemaining,
    }) : {
      prompt_tokens: prepared.promptTokens,
      completion_tokens: 0,
      total_tokens: prepared.promptTokens,
      context_limit: prepared.contextLimit,
      context_remaining: prepared.contextRemaining,
    }

    return { content: '工具调用次数已达上限，未生成最终答案。', usage: fallbackUsage }
  }

  private async streamToolIteration(params: {
    prepared: PreparedChatRequest
    provider: string
    messages: any[]
    toolDefinitions: any[]
    context: BattleExecutionContext
    emitDelta: (delta: { content?: string; reasoning?: string }) => void
  }) {
    const chatBody = convertOpenAIReasoningPayload({
      ...params.prepared.baseRequestBody,
      stream: true,
      messages: params.messages,
      tools: params.toolDefinitions,
      tool_choice: 'auto',
    })
    const body =
      params.provider === 'openai_responses' ? convertChatCompletionsRequestToResponses(chatBody) : chatBody

    const response = await this.requester.requestWithBackoff({
      request: {
        url: params.prepared.providerRequest.url,
        headers: params.prepared.providerRequest.headers,
        body,
      },
      context: {
        sessionId: 0,
        provider: params.provider,
        route: '/api/battle/execute',
        timeoutMs: params.prepared.providerRequest.timeoutMs,
      },
      traceRecorder: params.context.traceRecorder,
      traceContext: params.context.buildTraceContext({
        phase: 'tool',
        mode: 'stream',
      }),
      ...params.context.buildAbortHandlers(),
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
    let usageSnapshot: Record<string, any> | null = null
    let sawSse = false
    let doneSeen = false
    const toolCallBuffers = new Map<
      number,
      { id?: string; type?: string; function: { name?: string; arguments: string } }
    >()
    const responsesToolCallBuffers = new Map<
      string,
      { callId: string; name?: string; arguments: string; order: number }
    >()
    let fallbackToolCalls: ToolCall[] = []

    const handleToolDelta = (toolDelta: any) => {
      const idx = typeof toolDelta?.index === 'number' ? toolDelta.index : 0
      const existing = toolCallBuffers.get(idx) || { function: { name: undefined, arguments: '' } }
      if (toolDelta?.id) existing.id = toolDelta.id
      if (toolDelta?.type) existing.type = toolDelta.type
      if (toolDelta?.function?.name) existing.function.name = toolDelta.function.name
      if (toolDelta?.function?.arguments) {
        existing.function.arguments = `${existing.function.arguments || ''}${toolDelta.function.arguments}`
      }
      toolCallBuffers.set(idx, existing)
    }

    const aggregateToolCalls = () =>
      (responsesToolCallBuffers.size > 0
        ? Array.from(responsesToolCallBuffers.values())
            .sort((a, b) => a.order - b.order)
            .map((entry) => ({
              id: entry.callId,
              type: 'function',
              function: {
                name: entry.name || 'unknown',
                arguments: entry.arguments || '{}',
              },
            }))
        : Array.from(toolCallBuffers.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([_, entry]) => ({
              id: entry.id || crypto.randomUUID(),
              type: entry.type || 'function',
              function: {
                name: entry.function.name || 'unknown',
                arguments: entry.function.arguments || '{}',
              },
            })))

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

    try {
      while (true) {
        params.context.checkRunCancelled()
        params.context.checkAttemptCancelled()
        const { done, value } = await reader.read()
        if (value) {
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
            let parsed: any
            try {
              parsed = JSON.parse(data)
            } catch {
              continue
            }
            if (typeof parsed?.type === 'string' && parsed.type.startsWith('response.')) {
              if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string' && parsed.delta) {
                content += parsed.delta
                params.emitDelta({ content: parsed.delta })
              } else if (
                (parsed.type === 'response.reasoning_text.delta' || parsed.type === 'response.reasoning_summary_text.delta') &&
                typeof parsed.delta === 'string' &&
                parsed.delta
              ) {
                params.emitDelta({ reasoning: parsed.delta })
              } else if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
                const item = parsed.item
                if (item?.type === 'function_call') {
                  const callId = typeof item.call_id === 'string' ? item.call_id : null
                  if (callId) {
                    const existing = responsesToolCallBuffers.get(callId) || {
                      callId,
                      name: undefined,
                      arguments: '',
                      order: typeof parsed.output_index === 'number' ? parsed.output_index : responsesToolCallBuffers.size,
                    }
                    if (typeof item.name === 'string' && item.name) existing.name = item.name
                    if (typeof item.arguments === 'string') existing.arguments = item.arguments || existing.arguments
                    responsesToolCallBuffers.set(callId, existing)
                  }
                }
              } else if (parsed.type === 'response.function_call_arguments.delta') {
                const callId = typeof parsed.call_id === 'string' ? parsed.call_id : null
                const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
                if (callId && delta) {
                  const existing = responsesToolCallBuffers.get(callId) || {
                    callId,
                    name: undefined,
                    arguments: '',
                    order: responsesToolCallBuffers.size,
                  }
                  existing.arguments = `${existing.arguments || ''}${delta}`
                  responsesToolCallBuffers.set(callId, existing)
                }
              } else if (
                parsed.type === 'response.completed' ||
                parsed.type === 'response.failed' ||
                parsed.type === 'response.incomplete'
              ) {
                doneSeen = true
                if (parsed.response?.usage) {
                  usageSnapshot = parsed.response.usage
                }
              }
              continue
            }
            const { contentDelta, reasoningDelta } = extractDeltaPayload(parsed)
            if (typeof contentDelta === 'string' && contentDelta) {
              content += contentDelta
              params.emitDelta({ content: contentDelta })
            }
            if (typeof reasoningDelta === 'string' && reasoningDelta) {
              params.emitDelta({ reasoning: reasoningDelta })
            }
            const choice = parsed?.choices?.[0]
            const delta = choice?.delta || {}
            if (Array.isArray(delta.tool_calls)) {
              for (const toolDelta of delta.tool_calls) {
                handleToolDelta(toolDelta)
              }
            }
            if (parsed?.usage) {
              usageSnapshot = parsed.usage
            }
          }
        }
        if (doneSeen || done) break
      }
    } finally {
      reader.releaseLock()
    }

    if (!sawSse) {
      const raw = buffer.trim()
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed?.output)) {
            content = extractTextFromResponsesResponse(parsed) || ''
            const reasoningText = extractReasoningFromResponsesResponse(parsed) || ''
            if (reasoningText) params.emitDelta({ reasoning: reasoningText })
            if (parsed?.usage) usageSnapshot = parsed.usage
          } else {
            const message = parsed?.choices?.[0]?.message || {}
            content = typeof message.content === 'string' ? message.content : ''
            const reasoningText =
              (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
              (typeof message.reasoning === 'string' && message.reasoning) ||
              (typeof message.analysis === 'string' && message.analysis) ||
              (typeof parsed?.reasoning === 'string' && parsed.reasoning) ||
              (typeof parsed?.analysis === 'string' && parsed.analysis) ||
              ''
            if (reasoningText) {
              params.emitDelta({ reasoning: reasoningText })
            }
            const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
            fallbackToolCalls = toolCalls as ToolCall[]
            if (parsed?.usage) usageSnapshot = parsed.usage
          }
        } catch {
          // ignore
        }
      }
    }

    const toolCalls = toolCallBuffers.size > 0 ? aggregateToolCalls() : fallbackToolCalls

    return {
      content,
      toolCalls,
      usage: usageSnapshot,
    }
  }

  private safeParseToolArgs(toolCall: any): Record<string, unknown> {
    try {
      const raw = toolCall?.function?.arguments
      if (!raw) return {}
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  private buildJudgePrompt(question: string, expectedAnswer: string, answer: string) {
    return [
      '你是严格的答案裁判，只输出 JSON，不要包含多余解释。',
      '请根据“问题”和“期望答案”判断“模型答案”是否准确。',
      '输出格式：{"pass": true/false, "score": 0~1, "reason": "简短原因"}',
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
