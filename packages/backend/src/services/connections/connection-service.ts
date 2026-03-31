import type { Connection, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
  type ConnectionCreateData,
  type ConnectionUpdateData,
} from '../../repositories/connection-repository'
import {
  CAPABILITY_KEYS,
  normalizeCapabilityFlags,
  type CapabilityFlags,
} from '../../utils/capabilities'
import {
  fetchModelsForConnection as defaultFetchModelsForConnection,
  type CatalogItem,
  type ConnectionConfig,
  type AuthType,
  type ProviderType,
} from '../../utils/providers'

export class ConnectionServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ConnectionServiceError'
    this.statusCode = statusCode
  }
}

type VendorType = 'deepseek'

type TagItem = { name: string }

type NormalizedApiKeyPayload = {
  id?: number
  apiKeyLabel: string | null
  apiKey?: string
  modelIds: string[]
  enable: boolean
}

type GroupedConnectionRows = {
  id: number
  signature: string
  rows: Connection[]
}

export interface ConnectionServiceDeps {
  prisma?: PrismaClient
  repository?: ConnectionRepository
  encryptApiKey?: (value: string) => string
  decryptApiKey?: (value: string) => string
  refreshModelCatalog?: (connection: Connection) => Promise<unknown>
  fetchModelsForConnection?: (config: ConnectionConfig) => Promise<CatalogItem[]>
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

export interface ConnectionApiKeyPayload {
  id?: number
  apiKeyLabel?: string
  apiKey?: string
  modelIds?: string[]
  enable?: boolean
}

export interface ConnectionPayload {
  provider: ProviderType
  vendor?: VendorType
  baseUrl: string
  authType?: AuthType
  headers?: Record<string, string>
  azureApiVersion?: string
  prefixId?: string
  tags?: Array<{ name: string }>
  connectionType?: 'external' | 'local'
  defaultCapabilities?: Record<string, unknown> | undefined
  apiKeys: ConnectionApiKeyPayload[]
}

export interface ConnectionApiKeyView {
  id: number
  apiKeyLabel: string | null
  apiKeyMasked: string | null
  hasStoredApiKey: boolean
  modelIds: string[]
  enable: boolean
  createdAt: string
  updatedAt: string
}

export interface ConnectionGroupView {
  id: number
  connectionIds: number[]
  provider: ProviderType
  vendor?: VendorType | null
  baseUrl: string
  authType: AuthType
  azureApiVersion?: string | null
  prefixId?: string | null
  tags: TagItem[]
  connectionType: 'external' | 'local'
  defaultCapabilities: CapabilityFlags
  apiKeys: ConnectionApiKeyView[]
  createdAt: string
  updatedAt: string
}

export interface VerifyConnectionKeyResult {
  id?: number
  apiKeyLabel: string | null
  apiKeyMasked: string | null
  hasStoredApiKey: boolean
  enable: boolean
  success: boolean
  warning?: string | null
  error?: string | null
  models: CatalogItem[]
}

export interface VerifyConnectionResult {
  results: VerifyConnectionKeyResult[]
  successCount: number
  failureCount: number
  totalModels: number
}

const sanitizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

const normalizeOptionalString = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

const normalizeTags = (value?: Array<{ name: string }> | null): TagItem[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map((item) => ({ name: (item?.name || '').trim() }))
    .filter((item) => {
      if (!item.name) return false
      const lowered = item.name.toLowerCase()
      if (seen.has(lowered)) return false
      seen.add(lowered)
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

const normalizeStringArray = (value?: string[] | null) => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const trimmed = String(item || '').trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

const sortCapabilityFlags = (value?: CapabilityFlags | null): CapabilityFlags => {
  const input = value || {}
  return CAPABILITY_KEYS.reduce<CapabilityFlags>((acc, key) => {
    if (input[key] !== undefined) {
      acc[key] = input[key]
    }
    return acc
  }, {})
}

const serializeTags = (value?: Array<{ name: string }> | null) =>
  JSON.stringify(normalizeTags(value))

const serializeStringArray = (value?: string[] | null) =>
  JSON.stringify(normalizeStringArray(value))

const parseTags = (raw?: string | null): TagItem[] => {
  if (!raw) return []
  try {
    return normalizeTags(JSON.parse(raw))
  } catch {
    return []
  }
}

const parseStringArray = (raw?: string | null): string[] => {
  if (!raw) return []
  try {
    return normalizeStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

const parseRecord = (raw?: string | null): Record<string, string> => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.keys(parsed)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = String((parsed as Record<string, unknown>)[key] ?? '')
        return acc
      }, {})
  } catch {
    return {}
  }
}

const serializeRecord = (value?: Record<string, unknown> | null) =>
  JSON.stringify(
    Object.keys(value || {})
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = String((value as Record<string, unknown>)[key] ?? '')
        return acc
      }, {}),
  )

const parseDefaultCapabilities = (raw?: string | null): CapabilityFlags => {
  if (!raw) return {}
  try {
    return sortCapabilityFlags(normalizeCapabilityFlags(JSON.parse(raw)))
  } catch {
    return {}
  }
}

const serializeDefaultCapabilities = (value?: Record<string, unknown> | null) =>
  JSON.stringify(sortCapabilityFlags(normalizeCapabilityFlags(value)))

const maskApiKey = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

const stringifySignature = (row: {
  provider: string
  vendor?: string | null
  baseUrl: string
  authType: string
  headers: Record<string, string>
  azureApiVersion?: string | null
  prefixId?: string | null
  tags: TagItem[]
  connectionType?: string | null
  defaultCapabilities: CapabilityFlags
}) =>
  JSON.stringify({
    provider: row.provider,
    vendor: row.vendor || null,
    baseUrl: sanitizeBaseUrl(row.baseUrl),
    authType: row.authType || 'bearer',
    headers: row.headers,
    azureApiVersion: row.azureApiVersion || null,
    prefixId: row.prefixId || null,
    tags: row.tags,
    connectionType: (row.connectionType || 'external') as 'external' | 'local',
    defaultCapabilities: row.defaultCapabilities,
  })

const compareDatesDesc = (a: string, b: string) => {
  if (a === b) return 0
  return a > b ? -1 : 1
}

export class ConnectionService {
  private repository: ConnectionRepository
  private encryptApiKey: (value: string) => string
  private decryptApiKey: (value: string) => string
  private refreshModelCatalog: (connection: Connection) => Promise<unknown>
  private fetchModelsForConnection: (config: ConnectionConfig) => Promise<CatalogItem[]>
  private verifyConnection?: ConnectionServiceDeps['verifyConnection']
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: ConnectionServiceDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaConnectionRepository(prisma)
    this.encryptApiKey = deps.encryptApiKey ?? ((value) => value)
    this.decryptApiKey = deps.decryptApiKey ?? ((value) => value)
    this.refreshModelCatalog = deps.refreshModelCatalog ?? (async () => {})
    this.fetchModelsForConnection = deps.fetchModelsForConnection ?? defaultFetchModelsForConnection
    this.verifyConnection = deps.verifyConnection
    this.logger = deps.logger ?? console
  }

  async listSystemConnections(): Promise<ConnectionGroupView[]> {
    const rows = await this.repository.listSystemConnections()
    return this.groupRows(rows).map((group) => this.toGroupView(group.rows))
  }

  async createSystemConnection(payload: ConnectionPayload): Promise<ConnectionGroupView> {
    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys)
    const shared = this.buildSharedCreateData(payload)
    const created: Connection[] = []

    for (const key of normalizedKeys) {
      const connection = await this.repository.createSystemConnection({
        ...shared,
        ...this.buildApiKeyCreateData(key, payload.authType ?? 'bearer'),
      })
      created.push(connection)
      await this.refreshCatalogSafe(connection, 'create')
    }

    return this.toGroupView(created)
  }

  async updateSystemConnection(id: number, payload: ConnectionPayload): Promise<ConnectionGroupView> {
    const group = await this.requireGroupById(id)
    const existingById = new Map(group.rows.map((row) => [row.id, row]))
    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys)
    const shared = this.buildSharedUpdateData(payload, group.rows[0])
    const sharedCreate = this.buildSharedCreateData(payload, parseRecord(group.rows[0]?.headersJson))
    const touched: Connection[] = []
    const seenIds = new Set<number>()

    for (const key of normalizedKeys) {
      if (key.id != null) {
        const existing = existingById.get(key.id)
        if (!existing) {
          throw new ConnectionServiceError(`API Key #${key.id} 不属于当前端点`, 400)
        }
        seenIds.add(existing.id)
        const connection = await this.repository.updateSystemConnection(existing.id, {
          ...shared,
          ...this.buildApiKeyUpdateData(key, payload.authType ?? 'bearer', existing),
        })
        touched.push(connection)
        await this.refreshCatalogSafe(connection, 'update')
        continue
      }

      const connection = await this.repository.createSystemConnection({
        ...sharedCreate,
        ...this.buildApiKeyCreateData(key, payload.authType ?? 'bearer'),
      })
      touched.push(connection)
      await this.refreshCatalogSafe(connection, 'create')
    }

    for (const row of group.rows) {
      if (seenIds.has(row.id)) continue
      await this.repository.deleteSystemConnection(row.id)
      await this.repository.deleteModelCatalogByConnectionId(row.id)
    }

    return this.toGroupView(touched)
  }

  async deleteSystemConnection(id: number) {
    const group = await this.requireGroupById(id)
    for (const row of group.rows) {
      await this.repository.deleteSystemConnection(row.id)
      await this.repository.deleteModelCatalogByConnectionId(row.id)
    }
  }

  async verifyConnectionConfig(payload: ConnectionPayload): Promise<VerifyConnectionResult> {
    const verifyConnection = this.verifyConnection
    if (!verifyConnection) {
      throw new ConnectionServiceError('verifyConnection dependency not provided', 500)
    }

    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys)
    const existingById = await this.loadExistingRows(normalizedKeys)

    const results = await Promise.all(
      normalizedKeys.map(async (key) => {
        const existing = key.id != null ? existingById.get(key.id) ?? null : null
        const plainApiKey = this.resolvePlainApiKey({
          authType: payload.authType ?? 'bearer',
          apiKeyInput: key.apiKey,
          existing,
          requireOnMissingExisting: true,
        })
        const apiKeyMasked = maskApiKey(plainApiKey)
        const hasStoredApiKey = Boolean((key.apiKey && key.apiKey.trim()) || existing?.apiKey)

        try {
          await verifyConnection({
            provider: payload.provider,
            vendor: payload.vendor,
            baseUrl: payload.baseUrl,
            enable: true,
            authType: payload.authType ?? 'bearer',
            apiKey: plainApiKey || undefined,
            headers: payload.headers ?? (existing ? parseRecord(existing.headersJson) : undefined),
            azureApiVersion: payload.azureApiVersion,
            prefixId: payload.prefixId,
            tags: payload.tags,
            modelIds: key.modelIds,
            connectionType: payload.connectionType,
            defaultCapabilities: normalizeCapabilityFlags(payload.defaultCapabilities),
          })

          let models: CatalogItem[] = []
          let warning: string | null = null

          try {
            models = await this.fetchModelsForConnection({
              provider: payload.provider,
              baseUrl: payload.baseUrl,
              enable: true,
              authType: payload.authType ?? 'bearer',
              apiKey: plainApiKey || undefined,
              headers: payload.headers ?? (existing ? parseRecord(existing.headersJson) : undefined),
              azureApiVersion: payload.azureApiVersion,
              prefixId: payload.prefixId,
              tags: payload.tags,
              modelIds: key.modelIds,
              connectionType: payload.connectionType,
              defaultCapabilities: normalizeCapabilityFlags(payload.defaultCapabilities),
            })
          } catch (error) {
            warning = error instanceof Error ? error.message : String(error)
            models = key.modelIds.map((item) => ({
              id: payload.prefixId ? `${payload.prefixId}.${item}` : item,
              rawId: item,
              name: item,
              provider: payload.provider,
              channelName: payload.provider,
              connectionBaseUrl: sanitizeBaseUrl(payload.baseUrl),
              connectionType: (payload.connectionType || 'external') as 'external' | 'local',
              tags: normalizeTags(payload.tags),
            }))
          }

          return {
            id: key.id,
            apiKeyLabel: key.apiKeyLabel,
            apiKeyMasked,
            hasStoredApiKey,
            enable: key.enable,
            success: true,
            warning,
            models,
          } satisfies VerifyConnectionKeyResult
        } catch (error) {
          return {
            id: key.id,
            apiKeyLabel: key.apiKeyLabel,
            apiKeyMasked,
            hasStoredApiKey,
            enable: key.enable,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            models: [],
          } satisfies VerifyConnectionKeyResult
        }
      }),
    )

    return {
      results,
      successCount: results.filter((item) => item.success).length,
      failureCount: results.filter((item) => !item.success).length,
      totalModels: results.reduce((sum, item) => sum + item.models.length, 0),
    }
  }

  private normalizeApiKeys(input: ConnectionApiKeyPayload[]): NormalizedApiKeyPayload[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new ConnectionServiceError('至少需要一个 API Key 条目', 400)
    }

    return input.map((item, index) => ({
      id: Number.isFinite(item?.id) ? Number(item.id) : undefined,
      apiKeyLabel: normalizeOptionalString(item?.apiKeyLabel) || `Key ${index + 1}`,
      apiKey: typeof item?.apiKey === 'string' ? item.apiKey.trim() : undefined,
      modelIds: normalizeStringArray(item?.modelIds),
      enable: item?.enable ?? true,
    }))
  }

  private buildSharedCreateData(
    payload: ConnectionPayload,
    fallbackHeaders?: Record<string, string>,
  ): ConnectionCreateData {
    return {
      ownerUserId: null,
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: sanitizeBaseUrl(payload.baseUrl),
      authType: payload.authType ?? 'bearer',
      headersJson: serializeRecord(payload.headers ?? fallbackHeaders),
      azureApiVersion: normalizeOptionalString(payload.azureApiVersion),
      prefixId: normalizeOptionalString(payload.prefixId),
      tagsJson: serializeTags(payload.tags),
      defaultCapabilitiesJson: serializeDefaultCapabilities(payload.defaultCapabilities),
      connectionType: payload.connectionType ?? 'external',
    }
  }

  private buildSharedUpdateData(payload: ConnectionPayload, existing: Connection): ConnectionUpdateData {
    return {
      ownerUserId: null,
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: sanitizeBaseUrl(payload.baseUrl),
      authType: payload.authType ?? 'bearer',
      headersJson: serializeRecord(payload.headers ?? parseRecord(existing.headersJson)),
      azureApiVersion: normalizeOptionalString(payload.azureApiVersion),
      prefixId: normalizeOptionalString(payload.prefixId),
      tagsJson: serializeTags(payload.tags),
      defaultCapabilitiesJson: serializeDefaultCapabilities(payload.defaultCapabilities),
      connectionType: payload.connectionType ?? 'external',
    }
  }

  private buildApiKeyCreateData(
    payload: NormalizedApiKeyPayload,
    authType: AuthType,
  ): Pick<ConnectionCreateData, 'enable' | 'apiKey' | 'apiKeyLabel' | 'modelIdsJson'> {
    return {
      enable: payload.enable,
      apiKey: this.resolveStoredApiKeyForCreate(payload, authType),
      apiKeyLabel: payload.apiKeyLabel,
      modelIdsJson: serializeStringArray(payload.modelIds),
    }
  }

  private buildApiKeyUpdateData(
    payload: NormalizedApiKeyPayload,
    authType: AuthType,
    existing: Connection,
  ): Pick<ConnectionUpdateData, 'enable' | 'apiKey' | 'apiKeyLabel' | 'modelIdsJson'> {
    return {
      enable: payload.enable,
      apiKey: this.resolveStoredApiKeyForUpdate(payload, authType, existing),
      apiKeyLabel: payload.apiKeyLabel,
      modelIdsJson: serializeStringArray(payload.modelIds),
    }
  }

  private resolveStoredApiKeyForCreate(payload: NormalizedApiKeyPayload, authType: AuthType) {
    if (authType !== 'bearer') {
      return ''
    }
    if (!payload.apiKey) {
      throw new ConnectionServiceError(`${payload.apiKeyLabel || 'API Key'} 不能为空`, 400)
    }
    return this.encryptApiKey(payload.apiKey)
  }

  private resolveStoredApiKeyForUpdate(
    payload: NormalizedApiKeyPayload,
    authType: AuthType,
    existing: Connection,
  ) {
    if (authType !== 'bearer') {
      return ''
    }
    if (payload.apiKey) {
      return this.encryptApiKey(payload.apiKey)
    }
    if (existing.apiKey) {
      return existing.apiKey
    }
    throw new ConnectionServiceError(`${payload.apiKeyLabel || 'API Key'} 不能为空`, 400)
  }

  private resolvePlainApiKey(params: {
    authType: AuthType
    apiKeyInput?: string
    existing?: Connection | null
    requireOnMissingExisting: boolean
  }) {
    if (params.authType !== 'bearer') return ''
    if (params.apiKeyInput && params.apiKeyInput.trim()) {
      return params.apiKeyInput.trim()
    }
    if (params.existing?.apiKey) {
      return this.decryptSafely(params.existing.apiKey)
    }
    if (params.requireOnMissingExisting) {
      throw new ConnectionServiceError('存在未填写的新 API Key，无法验证', 400)
    }
    return ''
  }

  private decryptSafely(value: string) {
    try {
      return this.decryptApiKey(value)
    } catch {
      return value
    }
  }

  private async loadExistingRows(keys: NormalizedApiKeyPayload[]) {
    const ids = Array.from(
      new Set(
        keys
          .map((item) => item.id)
          .filter((item): item is number => typeof item === 'number' && item > 0),
      ),
    )
    if (ids.length === 0) return new Map<number, Connection>()

    const rows = await this.repository.listSystemConnections()
    return new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row]))
  }

  private async requireGroupById(id: number): Promise<GroupedConnectionRows> {
    const rows = await this.repository.listSystemConnections()
    const groups = this.groupRows(rows)
    const found = groups.find((group) => group.id === id || group.rows.some((row) => row.id === id))
    if (!found) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    return found
  }

  private groupRows(rows: Connection[]): GroupedConnectionRows[] {
    const map = new Map<string, Connection[]>()

    for (const row of [...rows].sort((a, b) => a.id - b.id)) {
      const signature = stringifySignature({
        provider: row.provider,
        vendor: row.vendor,
        baseUrl: row.baseUrl,
        authType: row.authType,
        headers: parseRecord(row.headersJson),
        azureApiVersion: row.azureApiVersion,
        prefixId: row.prefixId,
        tags: parseTags(row.tagsJson),
        connectionType: row.connectionType,
        defaultCapabilities: parseDefaultCapabilities(row.defaultCapabilitiesJson),
      })
      const bucket = map.get(signature) ?? []
      bucket.push(row)
      map.set(signature, bucket)
    }

    return Array.from(map.entries())
      .map(([signature, groupedRows]) => ({
        id: Math.min(...groupedRows.map((row) => row.id)),
        signature,
        rows: [...groupedRows].sort((a, b) => {
          const labelA = normalizeOptionalString(a.apiKeyLabel) || ''
          const labelB = normalizeOptionalString(b.apiKeyLabel) || ''
          return labelA.localeCompare(labelB, 'zh-CN') || a.id - b.id
        }),
      }))
      .sort((a, b) => {
        const updatedA = a.rows.reduce(
          (max, row) => (row.updatedAt.toISOString() > max ? row.updatedAt.toISOString() : max),
          '',
        )
        const updatedB = b.rows.reduce(
          (max, row) => (row.updatedAt.toISOString() > max ? row.updatedAt.toISOString() : max),
          '',
        )
        return compareDatesDesc(updatedA, updatedB)
      })
  }

  private toGroupView(rows: Connection[]): ConnectionGroupView {
    const sortedRows = [...rows].sort((a, b) => a.id - b.id)
    const base = sortedRows[0]
    const createdAt = sortedRows
      .map((row) => row.createdAt.toISOString())
      .sort()[0]
    const updatedAt = sortedRows
      .map((row) => row.updatedAt.toISOString())
      .sort()
      .slice(-1)[0]

    return {
      id: Math.min(...sortedRows.map((row) => row.id)),
      connectionIds: sortedRows.map((row) => row.id),
      provider: base.provider as ProviderType,
      vendor: (base.vendor as VendorType | null) ?? null,
      baseUrl: sanitizeBaseUrl(base.baseUrl),
      authType: (base.authType as AuthType) || 'bearer',
      azureApiVersion: base.azureApiVersion ?? null,
      prefixId: base.prefixId ?? null,
      tags: parseTags(base.tagsJson),
      connectionType: (base.connectionType || 'external') as 'external' | 'local',
      defaultCapabilities: parseDefaultCapabilities(base.defaultCapabilitiesJson),
      apiKeys: sortedRows.map((row) => {
        const plain = row.apiKey ? this.decryptSafely(row.apiKey) : ''
        return {
          id: row.id,
          apiKeyLabel: normalizeOptionalString(row.apiKeyLabel) || `Key ${row.id}`,
          apiKeyMasked: maskApiKey(plain),
          hasStoredApiKey: Boolean(row.apiKey),
          modelIds: parseStringArray(row.modelIdsJson),
          enable: Boolean(row.enable),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        } satisfies ConnectionApiKeyView
      }),
      createdAt,
      updatedAt,
    }
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
