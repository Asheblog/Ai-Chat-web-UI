import { convertUsage, isRecord, mapStopReason, toNumber } from './anthropic-shared'

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
