import {
  normalizeStreamChunk,
  parseStreamLines,
} from '@aichat/shared/chat-stream-parser'
import type { ChatStreamChunk } from '@aichat/shared/chat-stream-contract'

const STREAM_DEBUG_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_STREAM === '1'

/**
 * 单条 payload 归一化（兼容别名）。
 * 实现已收敛至 @aichat/shared/chat-stream-parser。
 */
export const normalizeChunk = normalizeStreamChunk

export async function* parseEventStream(
  response: Response,
  streamKey: string,
  onCleanup: () => void,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  if (!reader) {
    throw new Error('Response body is not readable')
  }

  let buffer = ''
  let completed = false

  try {
    let terminated = false
    while (!terminated) {
      const { done, value } = await reader.read()
      if (value) {
        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        if (STREAM_DEBUG_ENABLED) {
          console.debug('[streamChat] chunk', decoded.slice(0, 120))
        }
        const batch = parseStreamLines(buffer)
        buffer = batch.remaining
        if (batch.completed) {
          completed = true
        }
        for (const chunk of batch.chunks) {
          yield chunk
        }
        // error/run_error 事件后立即终止循环，不等待底层流 close
        if (batch.terminated) {
          terminated = true
          break
        }
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
    onCleanup()
  }

  if (!completed) {
    const error: any = new Error('Stream closed before completion')
    error.code = 'STREAM_INCOMPLETE'
    error.streamKey = streamKey
    throw error
  }
}
