import {
  normalizeStreamChunk,
  parseStreamLines,
} from '@aichat/shared/chat-stream-parser'
import { readSseStream } from '@aichat/shared/sse-reader'
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
  let completed = false

  try {
    for await (const line of readSseStream(response)) {
      if (STREAM_DEBUG_ENABLED) {
        console.debug('[streamChat] line', line.slice(0, 120))
      }
      const batch = parseStreamLines(`${line}\n`)
      if (batch.completed) {
        completed = true
      }
      for (const chunk of batch.chunks) {
        yield chunk
      }
      // error/run_error 事件后立即终止循环，不等待底层流 close
      if (batch.terminated) {
        break
      }
    }
  } finally {
    onCleanup()
  }

  if (!completed) {
    const error: any = new Error('Stream closed before completion')
    error.code = 'STREAM_INCOMPLETE'
    error.streamKey = streamKey
    throw error
  }
}
