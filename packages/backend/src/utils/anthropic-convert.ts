/**
 * Anthropic Messages API <-> OpenAI Chat Completions 请求/响应转换。
 *
 * 只负责：内部 Chat Completions 请求 -> Anthropic Messages 请求；
 * Anthropic 非流式响应 -> 内部 chat.completion。
 */

import {
  convertUsage,
  createToolCallId,
  isRecord,
  mapStopReason,
  toNumber,
} from './anthropic-shared'

const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096

const REASONING_EFFORT_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 16384,
}

type AnthropicContentBlock = Record<string, unknown>
type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicContentBlock[] }

type ChatMessage = {
  role?: string
  content?: unknown
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string | Record<string, unknown> }
  }>
  tool_call_id?: string
  thinking_blocks?: Array<Record<string, unknown>>
}



const flattenText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      if (part.type === 'text' && typeof part.text === 'string') return part.text
      if (part.type === 'input_text' && typeof part.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}


const parseToolArguments = (raw: unknown): Record<string, unknown> => {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const toImageBlock = (url: string): AnthropicContentBlock | null => {
  const dataUrl = /^data:([^;]+);base64,([\s\S]*)$/.exec(url)
  if (dataUrl) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUrl[1],
        data: dataUrl[2],
      },
    }
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: 'image', source: { type: 'url', url } }
  }
  return null
}

const toAnthropicContent = (content: unknown): AnthropicContentBlock[] => {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) blocks.push({ type: 'text', text: part })
      continue
    }
    if (!isRecord(part)) continue
    if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string' && part.text) {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'image_url') {
      const url = part.image_url?.url
      if (typeof url === 'string' && url) {
        const block = toImageBlock(url)
        if (block) blocks.push(block)
      }
    }
  }
  return blocks
}

const toToolResultContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = flattenText(content)
    if (text) return text
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

const convertTools = (tools: unknown): AnthropicContentBlock[] | undefined => {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  const converted: AnthropicContentBlock[] = []
  for (const tool of tools) {
    if (!isRecord(tool)) continue
    const fn = isRecord(tool.function) ? tool.function : null
    if (fn) {
      const name = typeof fn.name === 'string' ? fn.name.trim() : ''
      if (!name) continue
      converted.push({
        name,
        description: typeof fn.description === 'string' ? fn.description : '',
        input_schema: isRecord(fn.parameters)
          ? fn.parameters
          : { type: 'object', properties: {} },
      })
      continue
    }
    if (typeof tool.name === 'string' && tool.name.trim()) {
      converted.push({
        name: tool.name.trim(),
        description: typeof tool.description === 'string' ? tool.description : '',
        input_schema: isRecord(tool.input_schema)
          ? tool.input_schema
          : { type: 'object', properties: {} },
      })
    }
  }
  return converted.length > 0 ? converted : undefined
}

const convertToolChoice = (choice: unknown): { toolChoice?: Record<string, unknown>; disableTools?: boolean } => {
  if (typeof choice === 'string') {
    const normalized = choice.trim().toLowerCase()
    if (normalized === 'none') return { disableTools: true }
    if (normalized === 'required' || normalized === 'any') return { toolChoice: { type: 'any' } }
    if (normalized === 'auto') return { toolChoice: { type: 'auto' } }
    return {}
  }
  if (isRecord(choice)) {
    const fn = isRecord(choice.function) ? choice.function : null
    const name = typeof fn?.name === 'string' ? fn.name : typeof choice.name === 'string' ? choice.name : ''
    if (name) return { toolChoice: { type: 'tool', name } }
    if (typeof choice.type === 'string') {
      const type = choice.type.trim().toLowerCase()
      if (type === 'none') return { disableTools: true }
      if (type === 'auto' || type === 'any') return { toolChoice: { type } }
    }
  }
  return {}
}

const resolveThinkingBudget = (body: Record<string, any>): number | null => {
  if (isRecord(body.thinking) && body.thinking.type === 'enabled') {
    const explicit = toNumber(body.thinking.budget_tokens)
    if (explicit && explicit > 0) return Math.floor(explicit)
    return 4096
  }
  if (typeof body.reasoning_effort === 'string' && body.reasoning_effort.trim()) {
    const effort = body.reasoning_effort.trim().toLowerCase()
    return REASONING_EFFORT_BUDGETS[effort] ?? 4096
  }
  return null
}

/**
 * 把内部 OpenAI Chat Completions 请求体转换为 Anthropic Messages 请求体。
 * 输入不会被修改。
 */

export function convertChatCompletionsRequestToAnthropic(requestBody: any): any {
  const body = isRecord(requestBody) ? requestBody : {}
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : []

  const systemParts: string[] = []
  const anthropicMessages: AnthropicMessage[] = []
  const pushMessage = (role: 'user' | 'assistant', blocks: AnthropicContentBlock[]) => {
    if (blocks.length === 0) return
    const last = anthropicMessages[anthropicMessages.length - 1]
    if (last && last.role === role) {
      last.content.push(...blocks)
      return
    }
    anthropicMessages.push({ role, content: blocks })
  }

  for (const message of messages) {
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : 'user'
    if (role === 'system' || role === 'developer') {
      const text = flattenText(message.content)
      if (text) systemParts.push(text)
      continue
    }
    if (role === 'tool') {
      const toolUseId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
      if (!toolUseId) continue
      pushMessage('user', [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: toToolResultContent(message.content),
        },
      ])
      continue
    }
    if (role === 'assistant') {
      const thinkingBlocks: AnthropicContentBlock[] = []
      const rawThinkingBlocks = Array.isArray(message.thinking_blocks) ? message.thinking_blocks : []
      for (const block of rawThinkingBlocks) {
        if (!isRecord(block)) continue
        if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          typeof block.signature === 'string' &&
          block.signature
        ) {
          thinkingBlocks.push({
            type: 'thinking',
            thinking: block.thinking,
            signature: block.signature,
          })
        } else if (block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data) {
          thinkingBlocks.push({ type: 'redacted_thinking', data: block.data })
        }
      }
      const blocks = [...thinkingBlocks, ...toAnthropicContent(message.content)]
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      for (const call of toolCalls) {
        const name = typeof call?.function?.name === 'string' ? call.function.name.trim() : ''
        if (!name) continue
        blocks.push({
          type: 'tool_use',
          id: typeof call.id === 'string' && call.id ? call.id : createToolCallId(),
          name,
          input: parseToolArguments(call?.function?.arguments),
        })
      }
      pushMessage('assistant', blocks)
      continue
    }
    pushMessage('user', toAnthropicContent(message.content))
  }

  const resolvedSystem =
    systemParts.join('\n\n').trim() ||
    (typeof body.system === 'string' ? body.system : '')

  let maxTokens = Math.floor(
    toNumber(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens) ??
      ANTHROPIC_DEFAULT_MAX_TOKENS,
  )
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    maxTokens = ANTHROPIC_DEFAULT_MAX_TOKENS
  }

  const next: Record<string, any> = {
    model: typeof body.model === 'string' ? body.model : undefined,
    messages: anthropicMessages,
    max_tokens: maxTokens,
    stream: Boolean(body.stream),
  }

  if (resolvedSystem) next.system = resolvedSystem

  const temperature = toNumber(body.temperature)
  if (temperature != null) {
    next.temperature = Math.min(1, Math.max(0, temperature))
  }
  const topP = toNumber(body.top_p)
  if (topP != null) next.top_p = topP
  const topK = toNumber(body.top_k)
  if (topK != null) next.top_k = Math.floor(topK)

  const stop = body.stop ?? body.stop_sequences
  if (typeof stop === 'string' && stop) {
    next.stop_sequences = [stop]
  } else if (Array.isArray(stop)) {
    const sequences = stop.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (sequences.length > 0) next.stop_sequences = sequences
  }

  if (isRecord(body.metadata) && typeof body.metadata.user_id === 'string' && body.metadata.user_id) {
    next.metadata = { user_id: body.metadata.user_id }
  }

  const { toolChoice, disableTools } = convertToolChoice(body.tool_choice)
  const tools = disableTools ? undefined : convertTools(body.tools)
  if (tools) {
    next.tools = tools
    next.tool_choice = toolChoice ?? { type: 'auto' }
  }

  const thinkingBudget = resolveThinkingBudget(body)
  if (thinkingBudget && thinkingBudget > 0) {
    // Anthropic 要求 budget_tokens < max_tokens，否则直接 400。
    maxTokens = Math.max(maxTokens, thinkingBudget + 1024)
    next.max_tokens = maxTokens
    next.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(thinkingBudget, maxTokens - 1),
    }
  }

  return next
}


export function convertAnthropicMessageToChatCompletion(message: any): any {
  if (!isRecord(message)) return message
  if (Array.isArray(message.choices)) return message

  if (message.type === 'error' || isRecord(message.error)) {
    const error = isRecord(message.error) ? message.error : {}
    return {
      error: {
        message: typeof error.message === 'string' ? error.message : 'Anthropic request failed',
        type: typeof error.type === 'string' ? error.type : 'provider_error',
      },
    }
  }

  const contentBlocks = Array.isArray(message.content) ? message.content : []
  const textParts: string[] = typeof message.content === 'string' ? [message.content] : []
  const reasoningParts: string[] = []
  const thinkingBlocks: Array<Record<string, unknown>> = []
  const toolCalls: any[] = []

  for (const block of contentBlocks) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      reasoningParts.push(block.thinking)
      if (typeof block.signature === 'string' && block.signature) {
        thinkingBlocks.push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature,
        })
      }
      continue
    }
    if (block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data) {
      thinkingBlocks.push({ type: 'redacted_thinking', data: block.data })
      continue
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : ''
      if (!name) continue
      const id =
        typeof block.id === 'string' && block.id
          ? block.id
          : createToolCallId()
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
        },
      })
    }
  }

  const messagePayload: Record<string, any> = {
    role: 'assistant',
    content: textParts.join(''),
  }
  if (reasoningParts.length > 0) {
    messagePayload.reasoning_content = reasoningParts.join('')
  }
  if (thinkingBlocks.length > 0) {
    messagePayload.thinking_blocks = thinkingBlocks
  }
  if (toolCalls.length > 0) {
    messagePayload.tool_calls = toolCalls
  }

  const result: Record<string, any> = {
    id: typeof message.id === 'string' ? message.id : 'chatcmpl-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof message.model === 'string' ? message.model : '',
    choices: [
      {
        index: 0,
        message: messagePayload,
        finish_reason: mapStopReason(message.stop_reason),
      },
    ],
  }
  const usage = convertUsage(message.usage)
  if (usage) result.usage = usage
  return result
}
