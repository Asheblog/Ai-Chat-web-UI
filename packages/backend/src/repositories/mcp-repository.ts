import type { PrismaClient, McpInstallation, McpConnection, McpBinding, McpToolCache } from '@prisma/client'

export type McpInstallationCreateData = {
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
  status?: string
  createdBy?: number | null
}

export type McpConnectionCreateData = {
  installationId: number
  ownerUserId?: number | null
  name: string
  enabled?: boolean
  configJson?: string
  secretVaultId?: number | null
  toolSetRevision?: number
  status?: string
}

export type McpConnectionUpdateData = {
  name?: string
  enabled?: boolean
  configJson?: string
  secretVaultId?: number | null
  toolSetRevision?: number
  status?: string
}

export type McpBindingCreateData = {
  connectionId: number
  scopeType: string
  scopeId: string
  enabled?: boolean
  toolSetRevision?: number
  createdBy?: number | null
}

export type McpToolCacheUpsertData = {
  connectionId: number
  originalName: string
  description?: string | null
  inputSchemaJson?: string
  toolSetRevision?: number
}

export interface McpConnectionWithInstallation extends McpConnection {
  installation: McpInstallation
}

export interface McpBindingWithConnection extends McpBinding {
  connection: McpConnectionWithInstallation
}

export interface McpRepository {
  // Installations
  createInstallation(data: McpInstallationCreateData): Promise<McpInstallation>
  findInstallationById(id: number): Promise<McpInstallation | null>
  findInstallationByKey(namespaceKey: string): Promise<McpInstallation | null>
  listInstallations(params?: { sourceType?: string; status?: string }): Promise<McpInstallation[]>
  updateInstallation(id: number, data: Partial<McpInstallationCreateData>): Promise<McpInstallation>
  deleteInstallation(id: number): Promise<void>

  // Connections
  createConnection(data: McpConnectionCreateData): Promise<McpConnection>
  findConnectionById(id: number): Promise<McpConnectionWithInstallation | null>
  listConnections(params?: { installationId?: number; ownerUserId?: number | null; status?: string }): Promise<McpConnectionWithInstallation[]>
  updateConnection(id: number, data: McpConnectionUpdateData): Promise<McpConnection>
  deleteConnection(id: number): Promise<void>

  // Bindings
  createBinding(data: McpBindingCreateData): Promise<McpBinding>
  findBinding(connectionId: number, scopeType: string, scopeId: string): Promise<McpBinding | null>
  listBindings(params: { scopeType?: string; scopeId?: string; connectionId?: number }): Promise<McpBindingWithConnection[]>
  updateBinding(id: number, data: { enabled?: boolean; toolSetRevision?: number }): Promise<McpBinding>
  deleteBinding(id: number): Promise<void>

  // Tool Cache
  upsertToolCache(data: McpToolCacheUpsertData): Promise<McpToolCache>
  findToolCache(connectionId: number, originalName: string): Promise<McpToolCache | null>
  listToolCache(params: { connectionId?: number; pinned?: boolean }): Promise<McpToolCache[]>
  updateToolCachePin(id: number, pinned: boolean, pinnedBy?: number | null): Promise<McpToolCache>
  deleteToolCacheByConnection(connectionId: number): Promise<void>
}

export class PrismaMcpRepository implements McpRepository {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  // --- Installations ---

  createInstallation(data: McpInstallationCreateData) {
    return this.prisma.mcpInstallation.create({ data })
  }

  findInstallationById(id: number) {
    return this.prisma.mcpInstallation.findUnique({ where: { id } })
  }

  findInstallationByKey(namespaceKey: string) {
    return this.prisma.mcpInstallation.findUnique({ where: { namespaceKey } })
  }

  listInstallations(params?: { sourceType?: string; status?: string }) {
    return this.prisma.mcpInstallation.findMany({
      where: {
        ...(params?.sourceType ? { sourceType: params.sourceType } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  updateInstallation(id: number, data: Partial<McpInstallationCreateData>) {
    return this.prisma.mcpInstallation.update({ where: { id }, data })
  }

  async deleteInstallation(id: number) {
    await this.prisma.mcpInstallation.delete({ where: { id } })
  }

  // --- Connections ---

  createConnection(data: McpConnectionCreateData) {
    return this.prisma.mcpConnection.create({ data })
  }

  async findConnectionById(id: number): Promise<McpConnectionWithInstallation | null> {
    const result = await this.prisma.mcpConnection.findUnique({
      where: { id },
      include: { installation: true },
    })
    return result as McpConnectionWithInstallation | null
  }

  async listConnections(params?: { installationId?: number; ownerUserId?: number | null; status?: string }): Promise<McpConnectionWithInstallation[]> {
    const where: any = {}
    if (params?.installationId != null) where.installationId = params.installationId
    if (params?.ownerUserId !== undefined) where.ownerUserId = params.ownerUserId
    if (params?.status) where.status = params.status
    const result = await this.prisma.mcpConnection.findMany({
      where,
      include: { installation: true },
      orderBy: { createdAt: 'desc' },
    })
    return result as McpConnectionWithInstallation[]
  }

  updateConnection(id: number, data: McpConnectionUpdateData) {
    return this.prisma.mcpConnection.update({ where: { id }, data })
  }

  async deleteConnection(id: number) {
    await this.prisma.mcpConnection.delete({ where: { id } })
  }

  // --- Bindings ---

  createBinding(data: McpBindingCreateData) {
    return this.prisma.mcpBinding.create({ data })
  }

  findBinding(connectionId: number, scopeType: string, scopeId: string) {
    return this.prisma.mcpBinding.findUnique({
      where: { connectionId_scopeType_scopeId: { connectionId, scopeType, scopeId } },
    })
  }

  async listBindings(params: { scopeType?: string; scopeId?: string; connectionId?: number }): Promise<McpBindingWithConnection[]> {
    const where: any = {}
    if (params.scopeType) where.scopeType = params.scopeType
    if (params.scopeId) where.scopeId = params.scopeId
    if (params.connectionId != null) where.connectionId = params.connectionId
    const result = await this.prisma.mcpBinding.findMany({
      where,
      include: { connection: { include: { installation: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return result as McpBindingWithConnection[]
  }

  updateBinding(id: number, data: { enabled?: boolean; toolSetRevision?: number }) {
    return this.prisma.mcpBinding.update({ where: { id }, data })
  }

  async deleteBinding(id: number) {
    await this.prisma.mcpBinding.delete({ where: { id } })
  }

  // --- Tool Cache ---

  upsertToolCache(data: McpToolCacheUpsertData) {
    return this.prisma.mcpToolCache.upsert({
      where: { connectionId_originalName: { connectionId: data.connectionId, originalName: data.originalName } },
      create: {
        connectionId: data.connectionId,
        originalName: data.originalName,
        description: data.description ?? null,
        inputSchemaJson: data.inputSchemaJson ?? '{}',
        toolSetRevision: data.toolSetRevision ?? 1,
      },
      update: {
        description: data.description ?? null,
        inputSchemaJson: data.inputSchemaJson ?? '{}',
        toolSetRevision: data.toolSetRevision ?? 1,
        updatedAt: new Date(),
      },
    })
  }

  findToolCache(connectionId: number, originalName: string) {
    return this.prisma.mcpToolCache.findUnique({
      where: { connectionId_originalName: { connectionId, originalName } },
    })
  }

  listToolCache(params: { connectionId?: number; pinned?: boolean }) {
    const where: any = {}
    if (params.connectionId != null) where.connectionId = params.connectionId
    if (params.pinned != null) where.pinned = params.pinned
    return this.prisma.mcpToolCache.findMany({
      where,
      orderBy: { originalName: 'asc' },
    })
  }

  updateToolCachePin(id: number, pinned: boolean, pinnedBy?: number | null) {
    return this.prisma.mcpToolCache.update({
      where: { id },
      data: { pinned, pinnedBy: pinnedBy ?? null, pinnedAt: pinned ? new Date() : null },
    })
  }

  async deleteToolCacheByConnection(connectionId: number) {
    await this.prisma.mcpToolCache.deleteMany({ where: { connectionId } })
  }
}
