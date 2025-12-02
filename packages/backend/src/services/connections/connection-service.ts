import type { Connection, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
  type ConnectionWriteData,
} from '../../repositories/connection-repository'
import { normalizeCapabilityFlags } from '../../utils/capabilities'

export class ConnectionServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ConnectionServiceError'
    this.statusCode = statusCode
  }
}

type ProviderType = 'openai' | 'azure_openai' | 'ollama' | 'google_genai'
type AuthType = 'bearer' | 'none' | 'session' | 'system_oauth' | 'microsoft_entra_id'
type VendorType = 'deepseek'

export interface ConnectionServiceDeps {
  prisma?: PrismaClient
  repository?: ConnectionRepository
  encryptApiKey?: (value: string) => string
  refreshModelCatalog?: (connection: Connection) => Promise<unknown>
  verifyConnection?: (config: {
    provider: ProviderType
    vendor?: VendorType
    baseUrl: string
    enable: boolean
    authType: AuthType
    apiKey?: string
    headers?: Record<string, string>
    azureApiVersion?: string
    prefixId?: string
    tags?: Array<{ name: string }>
    modelIds?: string[]
    connectionType?: 'external' | 'local'
    defaultCapabilities?: Record<string, unknown> | undefined
  }) => Promise<void>
  logger?: Pick<typeof console, 'warn' | 'error'>
}

export interface ConnectionPayload {
  provider: ProviderType
  vendor?: VendorType
  baseUrl: string
  enable?: boolean
  authType?: AuthType
  apiKey?: string
  headers?: Record<string, string>
  azureApiVersion?: string
  prefixId?: string
  tags?: Array<{ name: string }>
  modelIds?: string[]
  connectionType?: 'external' | 'local'
  defaultCapabilities?: Record<string, unknown> | undefined
}

const sanitizeBaseUrl = (value: string) => value.replace(/\/$/, '')

const serializeRecord = (value?: Record<string, unknown>) =>
  value ? JSON.stringify(value) : ''

const serializeArray = <T>(value?: T[]) => JSON.stringify(value ?? [])

export class ConnectionService {
  private repository: ConnectionRepository
  private encryptApiKey: (value: string) => string
  private refreshModelCatalog: (connection: Connection) => Promise<unknown>
  private verifyConnection?: ConnectionServiceDeps['verifyConnection']
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: ConnectionServiceDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaConnectionRepository(prisma)
    this.encryptApiKey = deps.encryptApiKey ?? ((value) => value)
    this.refreshModelCatalog = deps.refreshModelCatalog ?? (async () => {})
    this.verifyConnection = deps.verifyConnection
    this.logger = deps.logger ?? console
  }

  async listSystemConnections() {
    return this.repository.listSystemConnections()
  }

  async createSystemConnection(payload: ConnectionPayload) {
    const connection = await this.repository.createSystemConnection(
      this.buildConnectionData(payload),
    )
    await this.refreshCatalogSafe(connection, 'create')
    return connection
  }

  async updateSystemConnection(id: number, payload: Partial<ConnectionPayload>) {
    const existing = await this.repository.findSystemConnectionById(id)
    if (!existing) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    const updates = this.buildConnectionData(payload, true)
    const connection = await this.repository.updateSystemConnection(id, updates)
    await this.refreshCatalogSafe(connection, 'update')
    return connection
  }

  async deleteSystemConnection(id: number) {
    const existing = await this.repository.findSystemConnectionById(id)
    if (!existing) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    await this.repository.deleteSystemConnection(id)
    await this.repository.deleteModelCatalogByConnectionId(id)
  }

  async verifyConnectionConfig(payload: ConnectionPayload) {
    if (!this.verifyConnection) {
      throw new ConnectionServiceError('verifyConnection dependency not provided', 500)
    }
    await this.verifyConnection({
      provider: payload.provider,
      vendor: payload.vendor,
      baseUrl: payload.baseUrl,
      enable: payload.enable ?? true,
      authType: payload.authType ?? 'bearer',
      apiKey: payload.apiKey,
      headers: payload.headers,
      azureApiVersion: payload.azureApiVersion,
      prefixId: payload.prefixId,
      tags: payload.tags,
      modelIds: payload.modelIds,
      connectionType: payload.connectionType,
      defaultCapabilities: normalizeCapabilityFlags(payload.defaultCapabilities),
    })
  }

  private buildConnectionData(
    payload: Partial<ConnectionPayload>,
    isPartial = false,
  ): ConnectionWriteData {
    const data: ConnectionWriteData = {
      ownerUserId: null,
    }
    if (!isPartial || payload.provider) {
      if (!payload.provider) throw new ConnectionServiceError('provider is required', 400)
      data.provider = payload.provider
    }
    if (!isPartial || payload.baseUrl) {
      if (!payload.baseUrl) throw new ConnectionServiceError('baseUrl is required', 400)
      data.baseUrl = sanitizeBaseUrl(payload.baseUrl)
    }
    if (!isPartial || payload.vendor !== undefined) {
      data.vendor = payload.vendor ?? null
    }
    if (!isPartial || typeof payload.enable === 'boolean') {
      data.enable = payload.enable ?? true
    }
    if (!isPartial || payload.authType) {
      data.authType = payload.authType ?? 'bearer'
    }
    if (!isPartial || payload.apiKey !== undefined) {
      data.apiKey =
        payload.authType === 'bearer' && payload.apiKey
          ? this.encryptApiKey(payload.apiKey)
          : ''
    }
    if (!isPartial || payload.headers) {
      data.headersJson = serializeRecord(payload.headers)
    }
    if (!isPartial || payload.azureApiVersion !== undefined) {
      data.azureApiVersion = payload.azureApiVersion ?? null
    }
    if (!isPartial || payload.prefixId !== undefined) {
      data.prefixId = payload.prefixId ?? null
    }
    if (!isPartial || payload.tags) {
      data.tagsJson = serializeArray(payload.tags)
    }
    if (!isPartial || payload.modelIds) {
      data.modelIdsJson = serializeArray(payload.modelIds)
    }
    if (!isPartial || payload.defaultCapabilities) {
      const normalized = normalizeCapabilityFlags(payload.defaultCapabilities) || {}
      data.defaultCapabilitiesJson = JSON.stringify(normalized)
    }
    if (!isPartial || payload.connectionType) {
      data.connectionType = payload.connectionType ?? 'external'
    }
    return data
  }

  private async refreshCatalogSafe(connection: Connection, action: 'create' | 'update') {
    try {
      await this.refreshModelCatalog(connection)
    } catch (error) {
      this.logger.warn?.(`刷新模型目录失败(${action})`, {
        id: connection.id,
        error: error instanceof Error ? error.message : error,
      })
    }
  }
}
