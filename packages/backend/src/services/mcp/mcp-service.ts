import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaMcpRepository,
  type McpRepository,
  type McpInstallationCreateData,
  type McpConnectionCreateData,
  type McpConnectionWithInstallation,
  type McpBindingWithConnection,
} from '../../repositories/mcp-repository'

export class McpServiceError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'McpServiceError'
    this.statusCode = statusCode
  }
}

// --- Runtime Client (abstract, for testing with fakes) ---

export interface McpToolManifest {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpRuntimeClient {
  listTools(connection: {
    id: number
    transport?: string
    endpoint?: string | null
    command?: string | null
    configJson?: string
    secretVaultId?: number | null
  }): Promise<McpToolManifest[]>
  callTool(
    connection: { id: number; transport?: string; endpoint?: string | null },
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>
}

// --- Service Dependencies ---

export interface McpServiceDeps {
  prisma?: PrismaClient
  repository?: McpRepository
  runtimeClient?: McpRuntimeClient
  getSystemSetting?: (key: string) => Promise<string | null>
}

const GLOBAL_GATE_KEY = 'mcp_global_enabled'

// --- Tool View ---

export interface McpToolView {
  name: string // prefixed name: mcp_{connectionId}_{originalName}
  originalName: string
  connectionId: number
  description: string | null
  inputSchema: Record<string, unknown>
  pinned: boolean
  toolSetRevision: number
}

// --- Service ---

export class McpService {
  private repository: McpRepository
  private runtimeClient?: McpRuntimeClient
  private getSystemSetting: (key: string) => Promise<string | null>

  constructor(deps: McpServiceDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaMcpRepository(prisma)
    this.runtimeClient = deps.runtimeClient
    this.getSystemSetting = deps.getSystemSetting ?? (async () => null)
  }

  // --- Global Gate ---

  private async checkGlobalGate(): Promise<void> {
    const value = await this.getSystemSetting(GLOBAL_GATE_KEY)
    if (value === 'false') {
      throw new McpServiceError(
        'MCP 全局总闸已关闭。管理员在系统设置中禁用了 MCP 能力。',
        403,
      )
    }
  }

  // --- Installations ---

  async createInstallation(
    data: {
      namespaceKey: string
      name: string
      description?: string | null
      sourceType?: string
      sourceUrl?: string | null
      sourceKey?: string | null
      registrySource?: string | null
      transport?: string
      endpoint?: string | null
      command?: string | null
      argsJson?: string
      envJson?: string
    },
    isAdmin = false,
  ) {
    if (!isAdmin) {
      if (data.sourceType === 'local_package') {
        throw new McpServiceError('local_package 类型的 MCP 安装只能由管理员创建', 403)
      }
      throw new McpServiceError('只有管理员可以创建 MCP 安装模板', 403)
    }

    const existing = await this.repository.findInstallationByKey(data.namespaceKey)
    if (existing) {
      throw new McpServiceError(`MCP 安装 "${data.namespaceKey}" 已存在`, 409)
    }

    return this.repository.createInstallation({
      namespaceKey: data.namespaceKey,
      name: data.name,
      description: data.description ?? null,
      sourceType: data.sourceType ?? 'remote',
      sourceUrl: data.sourceUrl ?? null,
      sourceKey: data.sourceKey ?? null,
      registrySource: data.registrySource ?? null,
      transport: data.transport ?? 'streamable_http',
      endpoint: data.endpoint ?? null,
      command: data.command ?? null,
      argsJson: data.argsJson ?? '[]',
      envJson: data.envJson ?? '{}',
      status: 'active',
    })
  }

  async listInstallations(params?: { sourceType?: string; status?: string }) {
    await this.checkGlobalGate()
    return this.repository.listInstallations(params)
  }

  async getInstallation(id: number) {
    const inst = await this.repository.findInstallationById(id)
    if (!inst) throw new McpServiceError(`MCP 安装 #${id} 不存在`, 404)
    return inst
  }

  async updateInstallation(id: number, data: Partial<McpInstallationCreateData>) {
    const inst = await this.repository.findInstallationById(id)
    if (!inst) throw new McpServiceError(`MCP 安装 #${id} 不存在`, 404)
    return this.repository.updateInstallation(id, data)
  }

  // --- Connections ---

  async createConnection(
    data: {
      installationId: number
      ownerUserId?: number | null
      name: string
      enabled?: boolean
      configJson?: string
      secretVaultId?: number | null
    },
    isAdmin = false,
  ) {
    const inst = await this.repository.findInstallationById(data.installationId)
    if (!inst) throw new McpServiceError(`MCP 安装 #${data.installationId} 不存在`, 404)

    // TODO: 待 MCP Gateway 实现后移除 local_package 阻断
    if (inst.sourceType === 'local_package' && !isAdmin) {
      throw new McpServiceError(
        'local_package 类型的 MCP 连接只能由管理员创建。' +
          '系统将在 MCP Gateway 可用后支持本地包运行。',
        403,
      )
    }

    return this.repository.createConnection({
      installationId: data.installationId,
      ownerUserId: data.ownerUserId ?? null,
      name: data.name,
      enabled: data.enabled ?? true,
      configJson: data.configJson ?? '{}',
      secretVaultId: data.secretVaultId ?? null,
    })
  }

  async listConnections(params: { installationId?: number; ownerUserId?: number | null; status?: string }) {
    await this.checkGlobalGate()
    return this.repository.listConnections(params)
  }

  async getConnection(id: number) {
    const conn = await this.repository.findConnectionById(id)
    if (!conn) throw new McpServiceError(`MCP 连接 #${id} 不存在`, 404)
    return conn
  }

  async updateConnection(id: number, data: { name?: string; enabled?: boolean; configJson?: string; secretVaultId?: number | null; status?: string }) {
    const conn = await this.repository.findConnectionById(id)
    if (!conn) throw new McpServiceError(`MCP 连接 #${id} 不存在`, 404)
    return this.repository.updateConnection(id, data)
  }

  async deleteConnection(id: number) {
    const conn = await this.repository.findConnectionById(id)
    if (!conn) throw new McpServiceError(`MCP 连接 #${id} 不存在`, 404)
    await this.repository.deleteToolCacheByConnection(id)
    await this.repository.deleteConnection(id)
  }

  // --- Bindings ---

  async bindConnection(data: {
    connectionId: number
    scopeType: string
    scopeId: string
    enabled?: boolean
    createdBy?: number | null
  }) {
    const conn = await this.repository.findConnectionById(data.connectionId)
    if (!conn) throw new McpServiceError(`MCP 连接 #${data.connectionId} 不存在`, 404)

    const existing = await this.repository.findBinding(data.connectionId, data.scopeType, data.scopeId)
    if (existing) {
      throw new McpServiceError('该连接已在此范围内绑定', 409)
    }

    return this.repository.createBinding({
      connectionId: data.connectionId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      enabled: data.enabled ?? true,
      toolSetRevision: conn.toolSetRevision,
      createdBy: data.createdBy ?? null,
    })
  }

  async listBindings(params: { scopeType?: string; scopeId?: string; connectionId?: number }) {
    await this.checkGlobalGate()
    return this.repository.listBindings(params)
  }

  async updateBinding(id: number, data: { enabled?: boolean }) {
    return this.repository.updateBinding(id, data)
  }

  async deleteBinding(id: number) {
    await this.repository.deleteBinding(id)
  }

  // --- Tool Cache ---

  async refreshToolCache(connectionId: number): Promise<number> {
    const conn = await this.repository.findConnectionById(connectionId)
    if (!conn) throw new McpServiceError(`MCP 连接 #${connectionId} 不存在`, 404)
    if (!conn.enabled) throw new McpServiceError('无法刷新已禁用的连接', 400)

    if (!this.runtimeClient) {
      throw new McpServiceError('MCP Runtime Client 未配置，无法刷新工具缓存', 500)
    }

    // TODO: 待 MCP Gateway 实现后移除 local_package 阻断
    // Check for local_package
    if (conn.installation.sourceType === 'local_package') {
      throw new McpServiceError(
        '需要 MCP Gateway，当前未启用/未实现。' +
          'local_package 类型的 MCP 服务需要通过 MCP Gateway 运行。',
        501,
      )
    }

    const tools = await this.runtimeClient.listTools({
      id: conn.id,
      transport: conn.installation.transport,
      endpoint: conn.installation.endpoint,
      command: conn.installation.command,
      configJson: conn.configJson,
      secretVaultId: conn.secretVaultId,
    })

    const newRevision = conn.toolSetRevision + 1

    for (const tool of tools) {
      await this.repository.upsertToolCache({
        connectionId,
        originalName: tool.name,
        description: tool.description ?? null,
        inputSchemaJson: JSON.stringify(tool.inputSchema),
        toolSetRevision: newRevision,
      })
    }

    await this.repository.updateConnection(connectionId, { toolSetRevision: newRevision })

    return newRevision
  }

  async pinTool(connectionId: number, originalName: string, pinnedBy?: number | null) {
    await this.checkGlobalGate()
    const tool = await this.repository.findToolCache(connectionId, originalName)
    if (!tool) throw new McpServiceError(`工具 "${originalName}" 不存在于连接 #${connectionId} 的缓存中`, 404)
    return this.repository.updateToolCachePin(tool.id, true, pinnedBy)
  }

  async unpinTool(connectionId: number, originalName: string) {
    await this.checkGlobalGate()
    const tool = await this.repository.findToolCache(connectionId, originalName)
    if (!tool) throw new McpServiceError(`工具 "${originalName}" 不存在于连接 #${connectionId} 的缓存中`, 404)
    return this.repository.updateToolCachePin(tool.id, false, null)
  }

  async searchTools(query: string) {
    await this.checkGlobalGate()
    const all = await this.repository.listToolCache({})
    const lowered = query.toLowerCase()
    return all.filter(
      (t) =>
        t.originalName.toLowerCase().includes(lowered) ||
        (t.description && t.description.toLowerCase().includes(lowered)),
    )
  }

  async getToolDetail(connectionId: number, originalName: string) {
    await this.checkGlobalGate()
    const tool = await this.repository.findToolCache(connectionId, originalName)
    if (!tool) throw new McpServiceError(`工具 "${originalName}" 不存在于连接 #${connectionId} 的缓存中`, 404)
    return tool
  }

  // --- Session-scoped meta-tool variants ---

  /** Search tools visible to a given session: enabled and bound to the session. */
  async searchToolsForSession(sessionId: number, query: string) {
    await this.checkGlobalGate()
    const bindings = await this.repository.listBindings({ scopeType: 'session', scopeId: String(sessionId) })
    const visibleConnIds = bindings
      .filter((b) => b.enabled && b.connection.enabled)
      .map((b) => b.connectionId)
    if (visibleConnIds.length === 0) return []

    const all = await this.repository.listToolCache({})
    const lowered = query.toLowerCase()
    return all.filter(
      (t) =>
        visibleConnIds.includes(t.connectionId) &&
        (t.originalName.toLowerCase().includes(lowered) ||
          (t.description && t.description.toLowerCase().includes(lowered))),
    )
  }

  /** Get tool detail only if the connection is bound to the given session. */
  async getToolDetailForSession(sessionId: number, connectionId: number, originalName: string) {
    await this.checkGlobalGate()
    const bindings = await this.repository.listBindings({ scopeType: 'session', scopeId: String(sessionId) })
    const boundConnIds = bindings
      .filter((b) => b.enabled && b.connection.enabled)
      .map((b) => b.connectionId)
    if (!boundConnIds.includes(connectionId)) {
      throw new McpServiceError(`工具 "${originalName}" 不存在或无权访问`, 404)
    }
    const tool = await this.repository.findToolCache(connectionId, originalName)
    if (!tool) throw new McpServiceError(`工具 "${originalName}" 不存在于连接 #${connectionId} 的缓存中`, 404)
    return tool
  }

  // --- Session Tool Listing ---

  /** Tool name prefix for MCP tools exposed to models */
  static toolPrefix(connectionId: number, originalName: string): string {
    return `mcp_${connectionId}_${originalName}`
  }

  /** Parse a prefixed tool name back to connectionId and originalName */
  static parseToolName(prefixed: string): { connectionId: number; originalName: string } | null {
    const match = prefixed.match(/^mcp_(\d+)_(.+)$/)
    if (!match) return null
    return { connectionId: Number(match[1]), originalName: match[2] }
  }

  async listToolsForSession(sessionId: number): Promise<McpToolView[]> {
    await this.checkGlobalGate()

    const bindings = await this.repository.listBindings({
      scopeType: 'session',
      scopeId: String(sessionId),
    })

    const tools: McpToolView[] = []

    for (const binding of bindings) {
      if (!binding.enabled) continue
      if (!binding.connection.enabled) continue

      const cacheEntries = await this.repository.listToolCache({
        connectionId: binding.connectionId,
        pinned: true,
      })

      for (const entry of cacheEntries) {
        tools.push({
          name: McpService.toolPrefix(entry.connectionId, entry.originalName),
          originalName: entry.originalName,
          connectionId: entry.connectionId,
          description: entry.description,
          inputSchema: this.safeParseJson(entry.inputSchemaJson),
          pinned: entry.pinned,
          toolSetRevision: entry.toolSetRevision,
        })
      }
    }

    return tools
  }

  // --- Runtime Tool Call ---

  async callTool(
    connectionId: number,
    originalName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    await this.checkGlobalGate()
    if (!this.runtimeClient) {
      throw new McpServiceError('MCP Runtime Client 未配置', 500)
    }

    const conn = await this.repository.findConnectionById(connectionId)
    if (!conn) throw new McpServiceError(`MCP 连接 #${connectionId} 不存在`, 404)
    if (!conn.enabled) throw new McpServiceError('MCP 连接已禁用', 400)

    // TODO: 待 MCP Gateway 实现后移除 local_package 阻断
    if (conn.installation.sourceType === 'local_package') {
      throw new McpServiceError(
        '需要 MCP Gateway，当前未启用/未实现。' +
          'local_package 类型的 MCP 服务需要通过 MCP Gateway 运行。',
        501,
      )
    }

    return this.runtimeClient.callTool(
      { id: conn.id, transport: conn.installation.transport, endpoint: conn.installation.endpoint },
      originalName,
      args,
    )
  }

  private safeParseJson(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
}
