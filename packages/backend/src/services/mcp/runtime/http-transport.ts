import { parseSseStream, type McpTransport } from './transport'

export class McpHttpTransportError extends Error {
  statusCode?: number
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'McpHttpTransportError'
    this.statusCode = statusCode
  }
}

interface HttpTransportOptions {
  url: string
  headers?: Record<string, string>
  timeoutMs: number
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  return { signal: controller.signal, clear: () => { if (timer) clearTimeout(timer) } }
}

/**
 * Streamable HTTP：每个 JSON-RPC 消息一次 POST，响应可能是 JSON 或 SSE 流，
 * 服务端通过 Mcp-Session-Id 头维持会话。
 */
export class StreamableHttpTransport implements McpTransport {
  private sessionId?: string
  private messageHandler: ((payload: string) => void) | null = null
  private errorHandler: ((error: Error) => void) | null = null
  private closeHandler: (() => void) | null = null

  constructor(private readonly options: HttpTransportOptions) {}

  async start(): Promise<void> {
    // 无需预热：首次 POST（initialize）即建会话
  }

  async send(payload: string): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.options.headers ?? {}),
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId

    const { signal, clear } = withTimeout(this.options.timeoutMs)
    let response: Response
    try {
      response = await fetch(this.options.url, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
    } catch (error) {
      clear()
      if ((error as Error)?.name === 'AbortError') {
        throw new McpHttpTransportError(`MCP 端点超时：${this.options.url}`, 504)
      }
      throw new McpHttpTransportError(`无法连接 MCP 端点：${(error as Error)?.message ?? 'network error'}`)
    }

    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId

    try {
      if (response.status === 202 || response.status === 204) {
        await response.body?.cancel().catch(() => undefined)
        return
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new McpHttpTransportError(
          `MCP 端点返回 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`,
          response.status,
        )
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('text/event-stream') && response.body) {
        for await (const event of parseSseStream(response.body)) {
          if (event.data) this.messageHandler?.(event.data)
        }
        return
      }

      const text = await response.text()
      if (text.trim()) this.messageHandler?.(text)
    } finally {
      clear()
    }
  }

  async close(): Promise<void> {
    this.closeHandler?.()
    if (!this.sessionId) return
    try {
      await fetch(this.options.url, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.sessionId, ...(this.options.headers ?? {}) },
      })
    } catch {
      // 关闭是尽力而为
    }
  }

  onMessage(handler: (payload: string) => void): void { this.messageHandler = handler }
  onError(handler: (error: Error) => void): void { this.errorHandler = handler }
  onClose(handler: () => void): void { this.closeHandler = handler }
}

/**
 * 旧版 HTTP+SSE：先 GET 建立事件流并取得 message endpoint，再向该 endpoint POST 消息。
 */
export class SseHttpTransport implements McpTransport {
  private messageUrl?: string
  private ready?: Promise<void>
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private messageHandler: ((payload: string) => void) | null = null
  private errorHandler: ((error: Error) => void) | null = null
  private closeHandler: (() => void) | null = null

  constructor(private readonly options: HttpTransportOptions) {}

  async start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.readLoop()
    return this.ready
  }

  private async readLoop(): Promise<void> {
    const { signal, clear } = withTimeout(this.options.timeoutMs)
    try {
      const response = await fetch(this.options.url, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...(this.options.headers ?? {}),
        },
        signal,
      })
      if (!response.ok || !response.body) {
        throw new McpHttpTransportError(`SSE 端点返回 HTTP ${response.status}`, response.status)
      }
      for await (const event of parseSseStream(response.body)) {
        if (event.event === 'endpoint') {
          this.messageUrl = new URL(event.data, this.options.url).toString()
          this.resolveReady?.()
          this.resolveReady = null
          clear()
          continue
        }
        if (event.data) this.messageHandler?.(event.data)
      }
      this.closeHandler?.()
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      this.rejectReady?.(wrapped)
      this.rejectReady = null
      this.errorHandler?.(wrapped)
      clear()
    }
  }

  async send(payload: string): Promise<void> {
    if (!this.messageUrl) await this.start()
    if (!this.messageUrl) throw new McpHttpTransportError('SSE 端点未就绪')

    const { signal, clear } = withTimeout(this.options.timeoutMs)
    try {
      const response = await fetch(this.messageUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.options.headers ?? {}) },
        body: payload,
        signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new McpHttpTransportError(`SSE 消息投递失败 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`, response.status)
      }
    } finally {
      clear()
    }
  }

  async close(): Promise<void> {
    this.closeHandler?.()
  }

  onMessage(handler: (payload: string) => void): void { this.messageHandler = handler }
  onError(handler: (error: Error) => void): void { this.errorHandler = handler }
  onClose(handler: () => void): void { this.closeHandler = handler }
}
