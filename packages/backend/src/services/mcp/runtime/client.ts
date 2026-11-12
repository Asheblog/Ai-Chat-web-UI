import { JsonRpcClient } from './json-rpc'
import type { McpTransport } from './transport'

export interface McpServerTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpCallResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2024-11-05'
const MAX_TOOL_PAGES = 5

/**
 * MCP 协议客户端：initialize → tools/list → tools/call。
 * 每次调用建立短连接，避免长驻进程泄漏；容器连接在 close 时回收。
 */
export class McpProtocolClient {
  private readonly rpc: JsonRpcClient
  private initialized = false

  constructor(
    transport: McpTransport,
    private readonly timeoutMs: number,
  ) {
    this.rpc = new JsonRpcClient(transport, timeoutMs)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.rpc.connect()
    await this.rpc.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'aichat', version: '2.1.0' },
    })
    await this.rpc.notify('notifications/initialized')
    this.initialized = true
  }

  async listTools(): Promise<McpServerTool[]> {
    await this.initialize()
    const tools: McpServerTool[] = []
    let cursor: string | undefined

    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await this.rpc.request(
        'tools/list',
        cursor ? { cursor } : {},
      )
      const batch = Array.isArray(result?.tools) ? result.tools : []
      for (const item of batch) {
        if (!item || typeof item.name !== 'string') continue
        tools.push({
          name: item.name,
          description: typeof item.description === 'string' ? item.description : undefined,
          inputSchema: item.inputSchema && typeof item.inputSchema === 'object' ? item.inputSchema : { type: 'object', properties: {} },
        })
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }

    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.initialize()
    const result = await this.rpc.request('tools/call', { name, arguments: args })
    const content = Array.isArray(result?.content)
      ? result.content
          .filter((item: any) => item && typeof item.type === 'string')
          .map((item: any) => ({ type: String(item.type), text: typeof item.text === 'string' ? item.text : undefined }))
      : []
    return { content, isError: Boolean(result?.isError) }
  }

  async close(): Promise<void> {
    await this.rpc.close()
  }
}
