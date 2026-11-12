import type { McpRuntimeClient, McpToolManifest } from './mcp-service'
import { parseMcpArgs, parseMcpConfigJson, pickStringRecord } from './mcp-connection-config'
import { McpProtocolClient } from './runtime/client'
import { StreamableHttpTransport, SseHttpTransport } from './runtime/http-transport'
import { DockerStdioTransport, resolveGatewayTarget, McpGatewayError } from './runtime/docker-stdio-transport'
import type { McpTransport } from './runtime/transport'

export interface McpRuntimeConnection {
  id: number
  transport?: string
  endpoint?: string | null
  command?: string | null
  args?: string[] | null
  configJson?: string
  secretVaultId?: number | null
}

export interface McpRuntimeConnectionConfig {
  env: Record<string, string>
  headers: Record<string, string>
  args: string[]
  command?: string
  endpoint?: string
}

export interface McpRuntimeClientDeps {
  timeoutMs?: number
  /** 由服务层注入：把 secretVaultId 解成环境变量/请求头，运行层不接触密钥库。 */
  resolveSecrets?: (connection: McpRuntimeConnection) => Promise<{ env?: Record<string, string>; headers?: Record<string, string> }>
}

const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_RUNTIME_TIMEOUT_MS || 30000)

export function resolveConnectionConfig(connection: McpRuntimeConnection): McpRuntimeConnectionConfig {
  const config = parseMcpConfigJson(connection.configJson)
  return {
    env: pickStringRecord(config?.env),
    headers: pickStringRecord(config?.headers),
    args: parseMcpArgs(connection.args ?? null, connection.configJson),
    command: typeof config?.command === 'string' ? config.command : connection.command ?? undefined,
    endpoint: typeof config?.endpoint === 'string' ? config.endpoint : connection.endpoint ?? undefined,
  }
}

/**
 * 无 SDK 依赖的 MCP 运行层：
 * - streamable_http / sse：直接连远程端点
 * - stdio：交给 Docker 网关容器执行（ADR-0015）
 */
export class HttpMcpRuntimeClient implements McpRuntimeClient {
  private readonly timeoutMs: number
  private readonly resolveSecrets?: McpRuntimeClientDeps['resolveSecrets']

  constructor(deps: McpRuntimeClientDeps = {}) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.resolveSecrets = deps.resolveSecrets
  }

  private async open(connection: McpRuntimeConnection): Promise<McpProtocolClient> {
    const base = resolveConnectionConfig(connection)
    const secrets = this.resolveSecrets ? await this.resolveSecrets(connection) : {}
    const env = { ...base.env, ...(secrets.env ?? {}) }
    const headers = { ...base.headers, ...(secrets.headers ?? {}) }
    const transportName = (connection.transport || 'streamable_http').toLowerCase()

    let transport: McpTransport
    if (transportName === 'stdio') {
      if (!base.command) {
        throw new McpGatewayError('本地包型 MCP 缺少启动命令', 'MCP_GATEWAY_INVALID_COMMAND')
      }
      const target = resolveGatewayTarget(base.command, base.args)
      transport = new DockerStdioTransport(target, env)
    } else if (transportName === 'sse') {
      if (!base.endpoint) throw new Error('MCP 连接缺少 endpoint')
      transport = new SseHttpTransport({ url: base.endpoint, headers, timeoutMs: this.timeoutMs })
    } else {
      if (!base.endpoint) throw new Error('MCP 连接缺少 endpoint')
      transport = new StreamableHttpTransport({ url: base.endpoint, headers, timeoutMs: this.timeoutMs })
    }

    const client = new McpProtocolClient(transport, this.timeoutMs)
    await client.initialize()
    return client
  }

  private async withClient<T>(
    connection: McpRuntimeConnection,
    run: (client: McpProtocolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.open(connection)
    try {
      return await run(client)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async listTools(connection: McpRuntimeConnection): Promise<McpToolManifest[]> {
    return this.withClient(connection, async (client) => {
      const tools = await client.listTools()
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    })
  }

  async callTool(
    connection: McpRuntimeConnection,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    return this.withClient(connection, (client) => client.callTool(toolName, args))
  }
}
