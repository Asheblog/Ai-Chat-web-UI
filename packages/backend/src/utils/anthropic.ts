/**
 * Anthropic Messages API <-> OpenAI Chat Completions 兼容层。
 *
 * 仓库内部（chat / battle / vision / title summary / compression / tool orchestrator）
 * 统一使用 OpenAI Chat Completions 形状。本模块负责：
 * 1. 把内部请求体转换为 Anthropic Messages 请求；
 * 2. 把 Anthropic 非流式响应转换为 OpenAI chat.completion；
 * 3. 把 Anthropic SSE 事件转换为 OpenAI chat.completion.chunk；
 * 4. 在 HTTP 边界包装 Response，使既有消费方无需感知协议差异。
 *
 * 参考：https://docs.anthropic.com/en/api/messages
 */

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

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toNumber = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(num) ? num : null
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

const createToolCallId = (): string =>
  'toolu_' + Math.random().toString(36).slice(2, 10)

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

const mapStopReason = (stopReason: unknown): string => {
  switch (typeof stopReason === 'string' ? stopReason : '') {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'refusal':
      return 'content_filter'
    case 'stop_sequence':
    case 'end_turn':
    case 'pause_turn':
      return 'stop'
    default:
      return 'stop'
  }
}

const convertUsage = (usage: any): Record<string, any> | undefined => {
  if (!isRecord(usage)) return undefined
  // Anthropic 的 input_tokens 不含缓存命中/写入；OpenAI prompt_tokens 是总输入。
  const input = toNumber(usage.input_tokens) ?? 0
  const cacheRead = toNumber(usage.cache_read_input_tokens) ?? 0
  const cacheCreation = toNumber(usage.cache_creation_input_tokens) ?? 0
  const prompt = input + cacheRead + cacheCreation
  const completion = toNumber(usage.output_tokens) ?? 0
  const result: Record<string, any> = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  }
  if (cacheRead > 0) {
    result.prompt_tokens_details = { cached_tokens: cacheRead }
  }
  return result
}

/**
 * 把 Anthropic Messages 响应转换为 OpenAI chat.completion。
 * 已符合 OpenAI 形状的载荷原样返回，便于所有调用点复用。
 */
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

export interface AnthropicSseState {
  buffer: string
  blocks: Map<number, { type: string; toolIndex?: number; thinking?: string; signature?: string; data?: string }>
  thinkingBlocks: Array<Record<string, unknown>>
  nextToolIndex: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  stopReason: string | null
  model: string | null
  id: string | null
  created: number
  finishEmitted: boolean
  done: boolean
}

export function createAnthropicSseState(): AnthropicSseState {
  return {
    buffer: '',
    blocks: new Map(),
    thinkingBlocks: [],
    nextToolIndex: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    stopReason: null,
    model: null,
    id: null,
    created: Math.floor(Date.now() / 1000),
    finishEmitted: false,
    done: false,
  }
}

const buildChunk = (
  state: AnthropicSseState,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: Record<string, any>,
  extra?: Record<string, unknown>,
): string => {
  const payload: Record<string, any> = {
    id: state.id ?? 'anthropic-chunk',
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model ?? '',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  }
  if (usage) payload.usage = usage
  if (extra) Object.assign(payload, extra)
  return 'data: ' + JSON.stringify(payload) + '\n\n'
}

const buildFinishChunk = (state: AnthropicSseState, finishReason: string): string => {
  state.finishEmitted = true
  return buildChunk(
    state,
    {},
    finishReason,
    convertUsage({
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens,
      cache_creation_input_tokens: state.cacheCreationTokens,
    }),
    state.thinkingBlocks.length > 0
      ? { anthropic_thinking_blocks: state.thinkingBlocks }
      : undefined,
  )
}

const processAnthropicEvent = (state: AnthropicSseState, parsed: any): string => {
  if (!isRecord(parsed)) return ''
  switch (parsed.type) {
    case 'message_start': {
      const message = isRecord(parsed.message) ? parsed.message : {}
      if (typeof message.id === 'string') state.id = message.id
      if (typeof message.model === 'string') state.model = message.model
      state.inputTokens = toNumber(message.usage?.input_tokens) ?? state.inputTokens
      state.outputTokens = toNumber(message.usage?.output_tokens) ?? state.outputTokens
      state.cacheReadTokens = toNumber(message.usage?.cache_read_input_tokens) ?? state.cacheReadTokens
      state.cacheCreationTokens =
        toNumber(message.usage?.cache_creation_input_tokens) ?? state.cacheCreationTokens
      return buildChunk(state, { role: 'assistant', content: '' }, null)
    }
    case 'content_block_start': {
      const index = toNumber(parsed.index) ?? 0
      const block = isRecord(parsed.content_block) ? parsed.content_block : {}
      const type = typeof block.type === 'string' ? block.type : 'text'
      if (type === 'tool_use') {
        const toolIndex = state.nextToolIndex
        state.nextToolIndex += 1
        state.blocks.set(index, { type, toolIndex })
        const name = typeof block.name === 'string' ? block.name : 'tool'
        const id = typeof block.id === 'string' ? block.id : `toolu_${toolIndex}`
        return buildChunk(
          state,
          {
            tool_calls: [
              {
                index: toolIndex,
                id,
                type: 'function',
                function: { name, arguments: '' },
              },
            ],
          },
          null,
        )
      }
      if (type === 'thinking') {
        state.blocks.set(index, { type, thinking: '', signature: '' })
      } else if (type === 'redacted_thinking') {
        state.blocks.set(index, {
          type,
          data: typeof block.data === 'string' ? block.data : '',
        })
      } else {
        state.blocks.set(index, { type })
      }
      return ''
    }
    case 'content_block_delta': {
      const index = toNumber(parsed.index) ?? 0
      const delta = isRecord(parsed.delta) ? parsed.delta : {}
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        return buildChunk(state, { content: delta.text }, null)
      }
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
        const block = state.blocks.get(index)
        if (block?.type === 'thinking') {
          block.thinking = `${block.thinking || ''}${delta.thinking}`
        }
        return buildChunk(state, { reasoning_content: delta.thinking }, null)
      }
      if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        const block = state.blocks.get(index)
        if (block?.type === 'thinking') {
          block.signature = `${block.signature || ''}${delta.signature}`
        }
        return ''
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const block = state.blocks.get(index)
        if (block?.toolIndex != null && delta.partial_json) {
          return buildChunk(
            state,
            {
              tool_calls: [
                {
                  index: block.toolIndex,
                  function: { arguments: delta.partial_json },
                },
              ],
            },
            null,
          )
        }
      }
      return ''
    }
    case 'content_block_stop': {
      const index = toNumber(parsed.index) ?? 0
      const block = state.blocks.get(index)
      if (block?.type === 'thinking' && block.thinking) {
        state.thinkingBlocks.push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature || '',
        })
      } else if (block?.type === 'redacted_thinking' && block.data) {
        state.thinkingBlocks.push({ type: 'redacted_thinking', data: block.data })
      }
      return ''
    }
    case 'message_delta': {
      const delta = isRecord(parsed.delta) ? parsed.delta : {}
      if (typeof delta.stop_reason === 'string') state.stopReason = delta.stop_reason
      const output = toNumber(parsed.usage?.output_tokens)
      if (output != null) state.outputTokens = output
      if (!state.finishEmitted) {
        return buildFinishChunk(state, mapStopReason(state.stopReason))
      }
      return ''
    }
    case 'message_stop': {
      state.done = true
      const finish = state.finishEmitted
        ? ''
        : buildFinishChunk(state, mapStopReason(state.stopReason))
      return finish + 'data: [DONE]\n\n'
    }
    case 'error': {
      const error = isRecord(parsed.error) ? parsed.error : {}
      return 'data: ' + JSON.stringify({
        error: {
          message: typeof error.message === 'string' ? error.message : 'Anthropic stream error',
          type: typeof error.type === 'string' ? error.type : 'provider_error',
        },
      }) + '\n\n'
    }
    case 'ping':
    default:
      return ''
  }
}

/**
 * 增量转换 Anthropic SSE 文本。调用方按到达顺序拼接返回值即可得到 OpenAI SSE。
 */
export function convertAnthropicSseChunk(chunk: string, state: AnthropicSseState): string {
  if (!chunk) return ''
  state.buffer += chunk
  const lines = state.buffer.split('\n')
  state.buffer = lines.pop() ?? ''
  let output = ''
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trimStart()
    if (!data) continue
    let parsed: any
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    output += processAnthropicEvent(state, parsed)
  }
  return output
}

/** 流结束时冲刷半行、补 finish chunk 与 [DONE]。 */
export function finishAnthropicSse(state: AnthropicSseState): string {
  let output = ''
  if (state.buffer.trim()) {
    const trailing = state.buffer
    state.buffer = ''
    output += convertAnthropicSseChunk(trailing + '\n', state)
  }
  if (!state.done) {
    if (!state.finishEmitted) {
      output += buildFinishChunk(state, mapStopReason(state.stopReason))
    }
    output += 'data: [DONE]\n\n'
    state.done = true
  }
  return output
}

export function createAnthropicSseToOpenAIStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const state = createAnthropicSseState()
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const output = convertAnthropicSseChunk(decoder.decode(chunk, { stream: true }), state)
      if (output) controller.enqueue(encoder.encode(output))
    },
    flush(controller) {
      const output = finishAnthropicSse(state)
      if (output) controller.enqueue(encoder.encode(output))
    },
  })
}

const copyResponseHeaders = (response: Response): Headers => {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  return headers
}

/**
 * 在 HTTP 边界把 Anthropic 响应归一化为内部 OpenAI 形状。
 * 非 Anthropic 或错误响应原样返回。
 */
export async function adaptProviderResponse(
  response: Response,
  provider: string,
  stream: boolean,
): Promise<Response> {
  if (provider !== 'anthropic' || !response.ok) return response

  const upstreamContentType = response.headers.get('content-type') || ''
  const upstreamLooksJson = /application\/json/i.test(upstreamContentType)

  if (stream && !upstreamLooksJson) {
    if (!response.body) return response
    const headers = copyResponseHeaders(response)
    headers.set('content-type', 'text/event-stream; charset=utf-8')
    return new Response(response.body.pipeThrough(createAnthropicSseToOpenAIStream()), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  const text = await response.text()
  const headers = copyResponseHeaders(response)
  headers.set('content-type', 'application/json; charset=utf-8')
  try {
    const json = JSON.parse(text)
    return new Response(JSON.stringify(convertAnthropicMessageToChatCompletion(json)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/** 直接 fetch 的调用点使用：读取并按 provider 归一化 JSON。 */
export async function readProviderJson<T = any>(
  response: { json?: () => Promise<any>; text: () => Promise<string> },
  provider: string,
): Promise<T> {
  let json: any
  if (typeof (response as any).json === 'function') {
    try {
      json = await (response as any).json()
    } catch {
      const text = await response.text()
      json = text ? JSON.parse(text) : {}
    }
  } else {
    const text = await response.text()
    json = text ? JSON.parse(text) : {}
  }
  if (provider === 'anthropic') {
    return convertAnthropicMessageToChatCompletion(json) as T
  }
  return json as T
}