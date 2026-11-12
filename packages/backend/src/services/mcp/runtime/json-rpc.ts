import type { McpTransport } from './transport'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

export class McpRpcError extends Error {
  code?: number | string
  constructor(message: string, code?: number | string) {
    super(message)
    this.name = 'McpRpcError'
    this.code = code
  }
}

/**
 * 最小 JSON-RPC 2.0 客户端：只实现 MCP 需要的 request / notify 与消息分发。
 */
export class JsonRpcClient {
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private closed = false

  constructor(
    private readonly transport: McpTransport,
    private readonly timeoutMs: number,
  ) {
    this.transport.onMessage((payload) => this.dispatch(payload))
    this.transport.onError((error) => this.failAll(error))
    this.transport.onClose(() => {
      this.closed = true
      this.failAll(new McpRpcError('MCP 传输已关闭'))
    })
  }

  async connect(): Promise<void> {
    await this.transport.start()
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.closed) return Promise.reject(new McpRpcError('MCP 连接已关闭'))
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = this.timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new McpRpcError(`MCP 请求超时：${method}`, -32000))
          }, this.timeoutMs)
        : null
      this.pending.set(id, { resolve, reject, timer })
      this.transport.send(payload).catch((error) => {
        const entry = this.pending.get(id)
        if (entry?.timer) clearTimeout(entry.timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new McpRpcError(String(error)))
      })
    })
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    if (this.closed) return
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params })
    await this.transport.send(payload)
  }

  async close(): Promise<void> {
    this.closed = true
    this.failAll(new McpRpcError('MCP 连接已关闭'))
    await this.transport.close()
  }

  private dispatch(payload: string): void {
    const trimmed = payload.trim()
    if (!trimmed) return
    let message: any
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return

    // 响应：有 id 且带 result / error
    if (typeof message.id === 'number') {
      const entry = this.pending.get(message.id)
      if (!entry) return
      if (entry.timer) clearTimeout(entry.timer)
      this.pending.delete(message.id)
      if (message.error) {
        entry.reject(new McpRpcError(String(message.error.message || 'MCP 调用失败'), message.error.code))
      } else {
        entry.resolve(message.result)
      }
      return
    }

    // 服务端反向请求：按协议回答「不支持方法」，避免对端阻塞
    if (typeof message.id === 'string' || typeof message.id !== 'undefined') {
      const reply = JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not supported by client' },
      })
      void this.transport.send(reply)
    }
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}
