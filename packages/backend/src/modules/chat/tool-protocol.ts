import { randomUUID } from 'node:crypto'
import type { ToolCall, ToolDefinition, ToolHandlerResult } from './tool-handlers/types'
import { convertOpenAIReasoningPayload } from '../../utils/providers'
import { resolveToolProviderAdapter } from './provider-adapters'

export type ToolSchema = 'tools' | 'functions' | 'text'

export type LegacyFunctionCall = { name?: string; arguments: string }

export type OpenAIToolCallBuffer = {
  id?: string
  type?: string
  function: { name?: string; arguments: string }
}

export type ResponsesToolCallBuffer = {
  callId: string
  name?: string
  arguments: string
  order: number
}

export type ToolCallBuffers = {
  openai: Map<number, OpenAIToolCallBuffer>
  responses: Map<string, ResponsesToolCallBuffer>
}

type ToolParseInput = {
  openaiToolCallBuffers: Map<number, OpenAIToolCallBuffer>
  responsesToolCallBuffers: Map<string, ResponsesToolCallBuffer>
  messageToolCalls?: ToolCall[]
  legacyFunctionCall?: LegacyFunctionCall | null
  textContent?: string | null
  textProtocolEnabled?: boolean
  toolDefinitions?: ToolDefinition[]
  allowedToolNames?: Set<string>
}

type ToolParseResult = {
  toolCalls: ToolCall[]
  textContent?: string | null
}

const TEXT_PROTOCOL_PROMPT_PREFIX = '工具调用协议(XML):'
const TEXT_PROTOCOL_RESULT_PREFIX = '工具结果'

export function resolveToolSchema(params: {
  provider?: string
  requestData?: Record<string, unknown> | null
}): ToolSchema {
  const raw =
    (params.requestData?.tool_schema as string | undefined) ||
    (params.requestData?.toolSchema as string | undefined) ||
    ''
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (normalized === 'functions' || normalized === 'function' || normalized === 'legacy') return 'functions'
  if (normalized === 'text' || normalized === 'xml' || normalized === 'text-protocol') return 'text'
  if (params.provider === 'openai_responses') return 'tools'
  const provider = (params.provider || '').toLowerCase()
  const modelId = typeof params.requestData?.model === 'string'
    ? params.requestData.model.toLowerCase()
    : ''
  if (modelId && (modelId.includes('claude') || modelId.includes('anthropic'))) {
    return 'text'
  }
  if (provider && provider !== 'openai' && provider !== 'azure_openai' && provider !== 'openai_responses') {
    return 'text'
  }
  return 'tools'
}

export function buildToolRequest(params: {
  requestData: Record<string, unknown>
  messages: any[]
  toolDefinitions: ToolDefinition[]
  schema: ToolSchema
  provider?: string
  stream?: boolean
}): { body: any; messages: any[]; textPromptAdded: boolean } {
  const { messages, textPromptAdded } =
    params.schema === 'text'
      ? injectTextProtocolPrompt(params.messages, params.toolDefinitions)
      : { messages: params.messages, textPromptAdded: false }

  const base = convertOpenAIReasoningPayload({
    ...params.requestData,
    stream: params.stream ?? true,
    messages,
  })

  delete base.tools
  delete base.tool_choice
  delete base.parallel_tool_calls
  delete base.functions
  delete base.function_call
  delete base.tool_schema
  delete base.toolSchema

  if (params.schema === 'functions') {
    base.functions = params.toolDefinitions.map((tool) => tool.function)
    base.function_call = 'auto'
  } else if (params.schema === 'tools') {
    const adapter = resolveToolProviderAdapter(params.provider)
    const toolPayload = adapter(params.toolDefinitions)
    Object.assign(base, toolPayload)
    if (base.tools && typeof base.tool_choice === 'undefined') {
      base.tool_choice = 'auto'
    }
  }

  return { body: base, messages, textPromptAdded }
}

export function createToolCallBuffers(): ToolCallBuffers {
  return { openai: new Map(), responses: new Map() }
}

export function appendOpenAIToolCallDelta(
  buffers: Map<number, OpenAIToolCallBuffer>,
  toolDelta: any,
): void {
  const idx = typeof toolDelta?.index === 'number' ? toolDelta.index : 0
  const existing = buffers.get(idx) || { function: { name: undefined, arguments: '' } }
  if (toolDelta?.id) existing.id = toolDelta.id
  if (toolDelta?.type) existing.type = toolDelta.type
  if (toolDelta?.function?.name) existing.function.name = toolDelta.function.name
  const argDelta = toolDelta?.function?.arguments
  if (typeof argDelta === 'string' && argDelta) {
    existing.function.arguments = `${existing.function.arguments || ''}${argDelta}`
  } else if (argDelta && typeof argDelta === 'object') {
    existing.function.arguments = JSON.stringify(argDelta)
  }
  buffers.set(idx, existing)
}

export function appendResponsesToolCallEvent(
  buffers: Map<string, ResponsesToolCallBuffer>,
  parsed: any,
): void {
  if (parsed?.type === 'response.output_item.added' || parsed?.type === 'response.output_item.done') {
    const item = parsed?.item
    if (item?.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : null
      if (!callId) return
      const existing = buffers.get(callId) || {
        callId,
        name: undefined,
        arguments: '',
        order: typeof parsed.output_index === 'number' ? parsed.output_index : buffers.size,
      }
      if (typeof item.name === 'string' && item.name) existing.name = item.name
      if (typeof item.arguments === 'string') {
        existing.arguments = item.arguments || existing.arguments
      } else if (item.arguments && typeof item.arguments === 'object') {
        existing.arguments = JSON.stringify(item.arguments)
      }
      buffers.set(callId, existing)
    }
    return
  }

  if (parsed?.type === 'response.function_call_arguments.delta') {
    const callId = typeof parsed.call_id === 'string' ? parsed.call_id : null
    const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
    if (!callId || !delta) return
    const existing = buffers.get(callId) || {
      callId,
      name: undefined,
      arguments: '',
      order: buffers.size,
    }
    existing.arguments = `${existing.arguments || ''}${delta}`
    buffers.set(callId, existing)
  }
}

export function appendLegacyFunctionCallDelta(
  legacy: LegacyFunctionCall | null,
  delta: any,
): LegacyFunctionCall | null {
  if (!delta || typeof delta !== 'object') return legacy
  const next = legacy ?? { name: undefined, arguments: '' }
  if (typeof delta.name === 'string' && delta.name) {
    next.name = delta.name
  }
  if (typeof delta.arguments === 'string') {
    next.arguments += delta.arguments
  }
  return next
}

export function extractToolCallsFromMessage(message: any): ToolCall[] {
  const rawToolCalls = message?.tool_calls
  const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : rawToolCalls ? [rawToolCalls] : []
  if (toolCalls.length > 0) return toolCalls as ToolCall[]
  const fn = message?.function_call
  if (fn && typeof fn === 'object') {
    const name = typeof fn.name === 'string' ? fn.name : undefined
    const args =
      typeof fn.arguments === 'string'
        ? fn.arguments
        : fn.arguments && typeof fn.arguments === 'object'
          ? JSON.stringify(fn.arguments)
          : ''
    return buildLegacyToolCalls({ name, arguments: args })
  }
  return []
}

export function extractToolCallsFromResponsesOutput(output: any[]): ToolCall[] {
  if (!Array.isArray(output)) return []
  const calls: ToolCall[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    if (item.type !== 'function_call') continue
    const callId = typeof item.call_id === 'string' ? item.call_id : randomUUID()
    const name = typeof item.name === 'string' ? item.name : undefined
    const args =
      typeof item.arguments === 'string'
        ? item.arguments
        : item.arguments && typeof item.arguments === 'object'
          ? JSON.stringify(item.arguments)
          : ''
    if (!name) continue
    calls.push({
      id: callId,
      type: 'function',
      function: { name, arguments: args || '{}' },
    })
  }
  return calls
}

export function parseToolCalls(params: ToolParseInput): ToolParseResult {
  const aggregated = aggregateToolCalls(params.openaiToolCallBuffers, params.responsesToolCallBuffers)
  let toolCalls =
    aggregated.length > 0
      ? aggregated
      : params.messageToolCalls && params.messageToolCalls.length > 0
        ? params.messageToolCalls
        : buildLegacyToolCalls(params.legacyFunctionCall)

  let textContent = params.textContent ?? undefined

  if (
    params.textProtocolEnabled &&
    toolCalls.length === 0 &&
    typeof params.textContent === 'string' &&
    params.toolDefinitions &&
    params.allowedToolNames
  ) {
    const result = extractToolCallsFromTextProtocol(
      params.textContent,
      params.toolDefinitions,
      params.allowedToolNames,
    )
    toolCalls = result.toolCalls
    textContent = result.cleanedContent
  }

  return { toolCalls: normalizeToolCalls(toolCalls), textContent }
}

export function isUnsupportedToolParamError(error: any): boolean {
  const message = typeof error?.message === 'string' ? error.message : ''
  const payloadText = error?.payload ? JSON.stringify(error.payload) : ''
  const merged = `${message} ${payloadText}`.toLowerCase()
  const mentionsToolParam =
    merged.includes('tools') || merged.includes('tool_choice') || merged.includes('parallel_tool_calls')
  const mentionsUnsupported =
    merged.includes('unknown') ||
    merged.includes('unrecognized') ||
    merged.includes('unsupported') ||
    merged.includes('invalid')
  return mentionsToolParam && mentionsUnsupported
}

export function isUnsupportedFunctionParamError(error: any): boolean {
  const message = typeof error?.message === 'string' ? error.message : ''
  const payloadText = error?.payload ? JSON.stringify(error.payload) : ''
  const merged = `${message} ${payloadText}`.toLowerCase()
  const mentionsFunctionParam = merged.includes('functions') || merged.includes('function_call')
  const mentionsUnsupported =
    merged.includes('unknown') ||
    merged.includes('unrecognized') ||
    merged.includes('unsupported') ||
    merged.includes('invalid')
  return mentionsFunctionParam && mentionsUnsupported
}

export function buildTextToolResultMessage(params: {
  toolName: string
  content: string
}): { role: 'user'; content: string } {
  const name = params.toolName || 'unknown'
  const content = params.content || ''
  return { role: 'user', content: `${TEXT_PROTOCOL_RESULT_PREFIX}(${name}): ${content}` }
}

export function normalizeToolHandlerResult(
  result: ToolHandlerResult,
  toolCallId?: string,
): ToolHandlerResult {
  const resolvedId =
    (typeof toolCallId === 'string' && toolCallId.trim()) ||
    (typeof result.toolCallId === 'string' && result.toolCallId.trim()) ||
    randomUUID()
  return {
    ...result,
    toolCallId: resolvedId,
    message: {
      ...result.message,
      tool_call_id: resolvedId,
    },
  }
}

export function buildUnsupportedToolResult(toolCallId: string | undefined, toolName: string): ToolHandlerResult {
  const resolvedId =
    typeof toolCallId === 'string' && toolCallId.trim() ? toolCallId.trim() : randomUUID()
  const name = toolName || 'unknown'
  return {
    toolCallId: resolvedId,
    toolName: name,
    message: {
      role: 'tool',
      tool_call_id: resolvedId,
      name,
      content: JSON.stringify({ error: 'Unsupported tool requested by the model' }),
    },
  }
}

export function normalizeToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return []
  const usedIds = new Set<string>()
  const normalized: ToolCall[] = []
  for (const call of toolCalls) {
    if (!call || typeof call !== 'object') continue
    const name = normalizeToolCallName(call)
    if (!name) continue
    const rawArgs =
      (call as any)?.function?.arguments ??
      (call as any)?.arguments ??
      (call as any)?.input ??
      (call as any)?.args
    const args = normalizeToolCallArguments(rawArgs)
    const id = normalizeToolCallId((call as any)?.id, usedIds)
    normalized.push({
      id,
      type: (call as any)?.type || 'function',
      function: {
        name,
        arguments: args || '{}',
      },
    } as ToolCall)
  }
  return normalized
}

function buildLegacyToolCalls(legacy: LegacyFunctionCall | null | undefined): ToolCall[] {
  if (!legacy || !legacy.name) return []
  return [
    {
      id: randomUUID(),
      type: 'function',
      function: {
        name: legacy.name,
        arguments: legacy.arguments || '{}',
      },
    },
  ]
}

function normalizeToolCallName(call: any): string {
  const name = call?.function?.name ?? call?.name ?? call?.tool?.name ?? ''
  return typeof name === 'string' ? name.trim() : ''
}

function normalizeToolCallArguments(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw || '{}'
  }
  if (raw == null) return '{}'
  try {
    return JSON.stringify(raw)
  } catch {
    return '{}'
  }
}

function normalizeToolCallId(candidate: unknown, usedIds: Set<string>): string {
  const raw = typeof candidate === 'string' ? candidate.trim() : ''
  let id = raw
  if (!id || usedIds.has(id)) {
    id = randomUUID()
  }
  usedIds.add(id)
  return id
}

function aggregateToolCalls(
  openaiBuffers: Map<number, OpenAIToolCallBuffer>,
  responsesBuffers: Map<string, ResponsesToolCallBuffer>,
): ToolCall[] {
  if (responsesBuffers.size > 0) {
    return Array.from(responsesBuffers.values())
      .sort((a, b) => a.order - b.order)
      .map((entry) => ({
        id: entry.callId,
        type: 'function',
        function: {
          name: entry.name || 'web_search',
          arguments: entry.arguments || '{}',
        },
      }))
  }
  if (openaiBuffers.size > 0) {
    return Array.from(openaiBuffers.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, entry]) => ({
        id: entry.id || randomUUID(),
        type: entry.type || 'function',
        function: {
          name: entry.function.name || 'web_search',
          arguments: entry.function.arguments || '{}',
        },
      }))
  }
  return []
}

function extractToolCallsFromTextProtocol(
  content: string,
  toolDefinitions: ToolDefinition[],
  allowedToolNames: Set<string>,
): { toolCalls: ToolCall[]; cleanedContent: string } {
  if (!content || allowedToolNames.size === 0) {
    return { toolCalls: [], cleanedContent: content }
  }
  const paramMap = buildToolParamMap(toolDefinitions)
  const toolCalls: ToolCall[] = []
  const toolRegex = /<([a-zA-Z0-9_-]+)>([\s\S]*?)<\/\1>/g
  let cleaned = content

  cleaned = cleaned.replace(toolRegex, (match, toolName: string, body: string) => {
    if (!allowedToolNames.has(toolName)) return match
    const paramNames = paramMap.get(toolName) ?? new Set<string>()
    const params: Record<string, unknown> = {}
    let sawParam = false
    const paramRegex = /<([a-zA-Z0-9_-]+)>([\s\S]*?)<\/\1>/g
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRegex.exec(body))) {
      const paramName = paramMatch[1]
      if (!paramNames.has(paramName)) continue
      params[paramName] = (paramMatch[2] || '').trim()
      sawParam = true
    }
    if (!sawParam) {
      const fallbackParam = paramNames.has('query')
        ? 'query'
        : paramNames.size === 1
          ? Array.from(paramNames)[0]
          : null
      if (fallbackParam) {
        params[fallbackParam] = body.trim()
      }
    }

    toolCalls.push({
      id: randomUUID(),
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(params),
      },
    })

    return ''
  })

  return { toolCalls, cleanedContent: cleaned.trim() }
}

function buildToolParamMap(toolDefinitions: ToolDefinition[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const def of toolDefinitions) {
    const name = def?.function?.name
    if (!name) continue
    const props = def?.function?.parameters?.properties
    const keys = props && typeof props === 'object' ? Object.keys(props) : []
    map.set(name, new Set(keys))
  }
  return map
}

function injectTextProtocolPrompt(messages: any[], toolDefinitions: ToolDefinition[]): { messages: any[]; textPromptAdded: boolean } {
  if (!toolDefinitions.length) return { messages, textPromptAdded: false }
  const hasPrompt = messages.some(
    (msg) => msg?.role === 'system' && typeof msg?.content === 'string' && msg.content.includes(TEXT_PROTOCOL_PROMPT_PREFIX),
  )
  if (hasPrompt) return { messages, textPromptAdded: false }

  const toolLines = toolDefinitions.map((tool) => {
    const name = tool.function.name
    const props = tool.function.parameters?.properties
    const paramNames = props && typeof props === 'object' ? Object.keys(props) : []
    if (paramNames.length === 0) {
      return `<${name}></${name}>`
    }
    const params = paramNames.map((param) => `<${param}>...</${param}>`).join('')
    return `<${name}>${params}</${name}>`
  })

  const prompt = [
    TEXT_PROTOCOL_PROMPT_PREFIX,
    '当需要调用工具时，仅输出以下 XML 结构，不要添加额外解释或 Markdown。',
    '若需要多个工具，按顺序输出多个 XML 块。',
    '工具结果会以纯文本返回，格式：工具结果(工具名): {JSON}。',
    '可用工具格式：',
    ...toolLines,
  ].join('\n')

  const insertIndex = messages.findIndex((msg) => msg?.role !== 'system')
  const nextMessages = messages.slice()
  const targetIndex = insertIndex === -1 ? nextMessages.length : insertIndex
  nextMessages.splice(targetIndex, 0, { role: 'system', content: prompt })
  return { messages: nextMessages, textPromptAdded: true }
}
