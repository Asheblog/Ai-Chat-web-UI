import {
  extractReasoningFromResponsesResponse,
  extractTextFromResponsesResponse,
} from '../../utils/openai-responses'
import type {
  ToolCall,
  ToolDefinition,
  ToolHandlerResult,
} from './tool-handlers/types'
import {
  type LegacyFunctionCall,
  type ToolSchema,
  appendLegacyFunctionCallDelta,
  appendOpenAIToolCallDelta,
  appendResponsesToolCallEvent,
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
}

export type ToolOrchestrationResult =
  | {
      status: 'completed'
      content: string
      usage: Record<string, any> | null
      messages: any[]
      reasoningChunks: string[]
      toolSchema: ToolSchema
    }
  | {
      status: 'max_iterations'
      usage: Record<string, any> | null
      messages: any[]
      reasoningChunks: string[]
      toolSchema: ToolSchema
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
  ) => Promise<ToolHandlerResult | null>
  checkAbort?: () => void
  onSchemaFallback?: (schema: ToolSchema) => MaybePromise<void>
  onUnsupportedTool?: (toolName: string, toolCallId: string | undefined) => MaybePromise<void>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (usage: Record<string, any>) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  includeReasoningInToolMessage?: boolean
  emptyContentErrorMessage?: string
}

export async function runToolOrchestration(
  params: ToolOrchestratorParams,
): Promise<ToolOrchestrationResult> {
  const provider = params.provider || ''
  const includeReasoningInToolMessage = params.includeReasoningInToolMessage !== false
  const workingMessages = params.initialMessages.map((msg) => ({ ...msg }))
  const maxIterations =
    Number.isFinite(params.maxIterations) && params.maxIterations > 0
      ? Math.floor(params.maxIterations)
      : 1
  let toolSchema: ToolSchema = resolveToolSchema({
    provider,
    requestData: params.requestData ?? undefined,
  })
  let lastUsage: Record<string, any> | null = null
  const reasoningChunks: string[] = []

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    params.checkAbort?.()

    const turn = await executeTurnWithFallback({
      provider,
      schema: toolSchema,
      iteration,
      messages: workingMessages,
      stream: params.stream,
      toolDefinitions: params.toolDefinitions,
      allowedToolNames: params.allowedToolNames,
      requestTurn: params.requestTurn,
      onSchemaFallback: params.onSchemaFallback,
      onContentDelta: params.onContentDelta,
      onReasoningDelta: params.onReasoningDelta,
      onUsage: params.onUsage,
      onStreamChunk: params.onStreamChunk,
      onFirstResponseEvent: params.onFirstResponseEvent,
      checkAbort: params.checkAbort,
    })

    toolSchema = turn.schema
    if (turn.parsed.usage) {
      lastUsage = turn.parsed.usage
    }
    if (turn.parsed.reasoning.trim()) {
      reasoningChunks.push(turn.parsed.reasoning.trim())
    }

    if (turn.parsed.toolCalls.length === 0) {
      const finalContent = turn.parsed.content || ''
      if (!finalContent.trim()) {
        throw new Error(
          params.emptyContentErrorMessage || 'Model finished without producing a final answer',
        )
      }
      return {
        status: 'completed',
        content: finalContent,
        usage: lastUsage,
        messages: workingMessages,
        reasoningChunks,
        toolSchema,
      }
    }

    const reasoningPayload = turn.parsed.reasoning.trim()
    if (toolSchema === 'functions') {
      let isFirstToolCall = true
      for (const toolCall of turn.parsed.toolCalls) {
        const toolName = toolCall?.function?.name || ''
        const toolArguments = toolCall?.function?.arguments || '{}'
        workingMessages.push({
          role: 'assistant',
          content: isFirstToolCall ? turn.parsed.content : '',
          function_call: {
            name: toolName || 'unknown',
            arguments: toolArguments,
          },
        })
        isFirstToolCall = false
        const result = await executeToolCall({
          toolName,
          toolCall,
          handleToolCall: params.handleToolCall,
          allowedToolNames: params.allowedToolNames,
          onUnsupportedTool: params.onUnsupportedTool,
        })
        workingMessages.push({
          role: 'function',
          name: result.toolName,
          content: result.message.content,
        })
      }
      continue
    }

    if (toolSchema === 'text') {
      workingMessages.push({
        role: 'assistant',
        content: turn.parsed.content,
      })
      for (const toolCall of turn.parsed.toolCalls) {
        const toolName = toolCall?.function?.name || ''
        const result = await executeToolCall({
          toolName,
          toolCall,
          handleToolCall: params.handleToolCall,
          allowedToolNames: params.allowedToolNames,
          onUnsupportedTool: params.onUnsupportedTool,
        })
        workingMessages.push(
          buildTextToolResultMessage({
            toolName: result.toolName,
            content: result.message.content,
          }),
        )
      }
      continue
    }

    workingMessages.push({
      role: 'assistant',
      content: turn.parsed.content,
      ...(includeReasoningInToolMessage && reasoningPayload
        ? { reasoning_content: reasoningPayload }
        : {}),
      tool_calls: turn.parsed.toolCalls,
    })

    for (const toolCall of turn.parsed.toolCalls) {
      const toolName = toolCall?.function?.name || ''
      const result = await executeToolCall({
        toolName,
        toolCall,
        handleToolCall: params.handleToolCall,
        allowedToolNames: params.allowedToolNames,
        onUnsupportedTool: params.onUnsupportedTool,
      })
      workingMessages.push(result.message)
    }
  }

  return {
    status: 'max_iterations',
    usage: lastUsage,
    messages: workingMessages,
    reasoningChunks,
    toolSchema,
  }
}

async function executeTurnWithFallback(params: {
  provider: string
  schema: ToolSchema
  iteration: number
  messages: any[]
  stream: boolean
  toolDefinitions: ToolDefinition[]
  allowedToolNames: Set<string>
  requestTurn: (params: ToolTurnRequestParams) => Promise<ToolTurnRequestResult>
  onSchemaFallback?: (schema: ToolSchema) => MaybePromise<void>
  onContentDelta?: (delta: string) => MaybePromise<void>
  onReasoningDelta?: (delta: string) => MaybePromise<void>
  onUsage?: (usage: Record<string, any>) => MaybePromise<void>
  onStreamChunk?: () => MaybePromise<void>
  onFirstResponseEvent?: () => MaybePromise<void>
  checkAbort?: () => void
}): Promise<{ schema: ToolSchema; parsed: ParsedToolTurn }> {
  let activeSchema = params.schema
  while (true) {
    try {
      const turnResult = await params.requestTurn({
        schema: activeSchema,
        messages: params.messages,
        iteration: params.iteration,
        stream: params.stream,
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
          onUsage: params.onUsage,
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
  const bufferTextOutput = params.schema === 'text'
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
  let legacyFunctionCall: LegacyFunctionCall | null = null

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
          if (typeof parsed?.type === 'string' && parsed.type.startsWith('response.')) {
            if (
              parsed.type === 'response.output_text.delta' &&
              typeof parsed.delta === 'string' &&
              parsed.delta
            ) {
              content += parsed.delta
              if (!bufferTextOutput) {
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
              parsed.type === 'response.completed' ||
              parsed.type === 'response.failed' ||
              parsed.type === 'response.incomplete'
            ) {
              doneSeen = true
              await emitUsage(parsed.response?.usage)
            }
            appendResponsesToolCallEvent(toolCallBuffers.responses, parsed)
            continue
          }

          const { contentDelta, reasoningDelta } = extractDeltaPayload(parsed)
          if (typeof contentDelta === 'string' && contentDelta) {
            content += contentDelta
            if (!bufferTextOutput) {
              await emitContentDelta(contentDelta)
              contentAlreadySent = true
            }
          }
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            reasoning += reasoningDelta
            await emitReasoningDelta(reasoningDelta)
          }
          const choice = parsed?.choices?.[0]
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

  if (!contentAlreadySent && !bufferTextOutput && cleanedContent) {
    await emitContentDelta(cleanedContent)
    contentAlreadySent = true
  }
  if (bufferTextOutput && toolCalls.length === 0 && cleanedContent) {
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
  if (Array.isArray(parsed?.output)) {
    rawContent = extractTextFromResponsesResponse(parsed) || ''
    rawReasoning = extractReasoningFromResponsesResponse(parsed) || ''
    messageToolCalls = extractToolCallsFromResponsesOutput(parsed.output)
  } else {
    const message = parsed?.choices?.[0]?.message || {}
    rawContent = typeof message.content === 'string' ? message.content : ''
    rawReasoning = extractMessageReasoning(message, parsed)
    messageToolCalls = extractToolCallsFromMessage(message)
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

  return {
    content: messageContent,
    reasoning: rawReasoning,
    toolCalls,
    usage: parsed?.usage ?? null,
  }
}

async function executeToolCall(params: {
  toolName: string
  toolCall: ToolCall
  handleToolCall: (
    toolName: string,
    toolCall: ToolCall,
    args: Record<string, unknown>,
  ) => Promise<ToolHandlerResult | null>
  allowedToolNames: Set<string>
  onUnsupportedTool?: (toolName: string, toolCallId: string | undefined) => MaybePromise<void>
}): Promise<ToolHandlerResult> {
  const args = safeParseToolArgs(params.toolCall)
  let result: ToolHandlerResult | null = null
  if (params.toolName && params.allowedToolNames.has(params.toolName)) {
    result = await params.handleToolCall(params.toolName, params.toolCall, args)
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
