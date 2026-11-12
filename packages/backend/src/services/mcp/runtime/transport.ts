/**
 * MCP 运行时传输层抽象。
 *
 * 与 MCP 官方 SDK 的 Transport 语义对齐，但零外部依赖：
 * 只要求 start / send / close 与消息回调。
 */

export type McpTransportMessageHandler = (payload: string) => void
export type McpTransportErrorHandler = (error: Error) => void
export type McpTransportCloseHandler = () => void

export interface McpTransport {
  start(): Promise<void>
  send(payload: string): Promise<void>
  close(): Promise<void>
  onMessage(handler: McpTransportMessageHandler): void
  onError(handler: McpTransportErrorHandler): void
  onClose(handler: McpTransportCloseHandler): void
}

export interface ParsedSseEvent {
  event?: string
  data: string
}

/** 逐行解析 text/event-stream，按空行切分事件。 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  let dataLines: string[] = []

  const flush = (): ParsedSseEvent | null => {
    if (dataLines.length === 0) {
      event = undefined
      return null
    }
    const parsed: ParsedSseEvent = { event, data: dataLines.join('\n') }
    event = undefined
    dataLines = []
    return parsed
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const rawLine = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (rawLine === '') {
        const flushed = flush()
        if (flushed) yield flushed
      } else if (rawLine.startsWith('event:')) {
        event = rawLine.slice(6).trim()
      } else if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).replace(/^ /, ''))
      }
      index = buffer.indexOf('\n')
    }
  }

  const flushed = flush()
  if (flushed) yield flushed
}
