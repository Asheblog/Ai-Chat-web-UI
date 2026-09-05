/**
 * 通用 SSE 流读取器 —— web / mobile / backend 共用（RN 安全）。
 *
 * 只负责「字节流 → 完整行」的分帧与资源释放，不解析 data: 负载；
 * 具体协议解析由调用方注入（chat 用 chat-stream-parser，battle 用 battle 事件解析）。
 *
 * 收敛重复实现：
 * - frontend features/chat/api/stream-reader.ts
 * - frontend features/battle/api.ts（streamBattle / rejudgeWithNewAnswer 两份循环）
 * - mobile mobile-api-client.ts
 */

export interface SseStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  releaseLock(): void
}

export interface SseStreamSource {
  body?: {
    getReader?: () => SseStreamReader
  } | null
}

export interface SplitSseLinesResult {
  lines: string[]
  remaining: string
}

/**
 * 从缓冲区切出完整行（兼容 \n、\r\n、\r）。
 * flush=true 时把残行也作为最后一行返回。
 */
export const splitSseLines = (buffer: string, flush = false): SplitSseLinesResult => {
  const lines: string[] = []
  let remaining = buffer

  while (true) {
    const newlineIndex = remaining.search(/[\r\n]/)
    if (newlineIndex === -1) {
      if (flush && remaining.length > 0) {
        lines.push(remaining)
        remaining = ''
      }
      break
    }

    const line = remaining.slice(0, newlineIndex)
    const separator = remaining[newlineIndex]
    const skip = separator === '\r' && remaining[newlineIndex + 1] === '\n' ? 2 : 1
    remaining = remaining.slice(newlineIndex + skip)
    lines.push(line)
  }

  return { lines, remaining }
}

/**
 * 逐行读取 SSE 响应。调用方在 for await 中处理每一行；
 * 提前 return/break 会触发 finally 释放 reader。
 */
export async function* readSseStream(
  source: SseStreamSource,
): AsyncGenerator<string, void, unknown> {
  const reader = source.body?.getReader?.()
  if (!reader) {
    throw new Error('Response body is not readable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const batch = splitSseLines(buffer)
        buffer = batch.remaining
        for (const line of batch.lines) {
          yield line
        }
      }
      if (done) {
        const batch = splitSseLines(buffer, true)
        for (const line of batch.lines) {
          yield line
        }
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
}
