import type { Connection, ConnectionGroup, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
  type ConnectionGroupCreateData,
  type ConnectionGroupUpdateData,
  type ConnectionGroupWithCredentials,
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
import type { SecretVaultService as ISecretVaultService } from '../secret-vault'
import { allocateUniqueDisplayName, seedDisplayName } from './display-name'

export class ConnectionServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ConnectionServiceError'
    this.statusCode = statusCode
  }
}

type VendorType = 'deepseek' | 'openai_interleave'

type TagItem = { name: string }

/** 内部规范化后的 API Key 条目 —— apiKey 仅作为写入输入，不保存到数据库 */
type NormalizedApiKeyPayload = {
  id?: number
  apiKeyLabel: string | null
  apiKey?: string
  modelIds: string[]
  enable: boolean
}

export interface ConnectionServiceDeps {
  prisma?: PrismaClient
  repository?: ConnectionRepository
  secretVault?: ISecretVaultService
  refreshModelCatalog?: (group: ConnectionGroup, credential: Connection) => Promise<unknown>
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
  logger?: Pick<typeof console, 'warn' | 'error' | 'info'>
}

/** 前端 API 输入：apiKey 作为写入/验证输入 */
export interface ConnectionApiKeyPayload {
  id?: number
  apiKeyLabel?: string | null
  apiKey?: string
  modelIds?: string[]
  enable?: boolean
}

export interface ConnectionPayload {
  displayName: string
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

/** 导入允许缺省 displayName（v1 由 seed 补齐） */
export type ImportConnectionPayload = Omit<ConnectionPayload, 'displayName'> & {
  displayName?: string
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
  displayName: string
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

export interface ExportConnectionApiKey {
  apiKeyLabel?: string
  apiKey: string
  modelIds: string[]
  enable: boolean
}

export interface ExportConnection {
  displayName: string
  provider: ProviderType
  vendor?: VendorType
  baseUrl: string
  authType: AuthType
  headers?: Record<string, string>
  azureApiVersion?: string
  prefixId?: string
  tags: TagItem[]
  connectionType: 'external' | 'local'
  defaultCapabilities: CapabilityFlags
  apiKeys: ExportConnectionApiKey[]
}

export interface ExportSystemConnectionsResult {
  schemaVersion: 2
  exportedAt: string
  connections: ExportConnection[]
  skippedKeys: number
  skippedReasons: string[]
}

export interface ImportSystemConnectionsPayload {
  schemaVersion: 1 | 2
  connections: ImportConnectionPayload[]
}

export interface ImportSystemConnectionsResult {
  createdGroups: number
  updatedGroups: number
  addedKeys: number
  skippedKeys: number
  skippedReasons: string[]
}

export interface ConnectionActorContext {
  userId?: number | null
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

const pickCredentialForCatalog = (
  group: ConnectionGroup,
  credentials: Connection[],
): Connection | null => {
  const enabled = credentials.filter((item) => item.enable)
  const pool = enabled.length > 0 ? enabled : credentials
  if (pool.length === 0) return null
  if ((group.authType as AuthType) === 'none') {
    return pool[0] ?? null
  }
  return pool.find((item) => item.secretVaultId != null) ?? pool[0] ?? null
}

export class ConnectionService {
  private repository: ConnectionRepository
  private secretVault?: ISecretVaultService
  private refreshModelCatalog: (group: ConnectionGroup, credential: Connection) => Promise<unknown>
  private fetchModelsForConnection: (config: ConnectionConfig) => Promise<CatalogItem[]>
  private verifyConnection?: ConnectionServiceDeps['verifyConnection']
  private logger: Pick<typeof console, 'warn' | 'error' | 'info'>

  constructor(deps: ConnectionServiceDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaConnectionRepository(prisma)
    this.secretVault = deps.secretVault
    this.refreshModelCatalog = deps.refreshModelCatalog ?? (async () => {})
    this.fetchModelsForConnection = deps.fetchModelsForConnection ?? defaultFetchModelsForConnection
    this.verifyConnection = deps.verifyConnection
    this.logger = deps.logger ?? console
  }

  /** Dual-read: group id → itself; legacy credential id → its connectionGroupId */
  async resolveGroupId(id: number): Promise<number> {
    const asGroup = await this.repository.findSystemGroupById(id)
    if (asGroup) return asGroup.id

    const groups = await this.repository.listSystemGroups()
    for (const group of groups) {
      if (group.credentials.some((credential) => credential.id === id)) {
        return group.id
      }
    }
    throw new ConnectionServiceError('Connection not found', 404)
  }

  async listSystemConnections(): Promise<ConnectionGroupView[]> {
    const groups = await this.repository.listSystemGroups()
    return groups
      .map((group) => this.toGroupView(group))
      .sort((a, b) => compareDatesDesc(a.updatedAt, b.updatedAt))
  }

  async createSystemConnection(payload: ConnectionPayload): Promise<ConnectionGroupView> {
    const displayName = this.requireDisplayName(payload.displayName)
    await this.assertSystemDisplayNameAvailable(displayName)

    const authType = payload.authType ?? 'bearer'
    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys, authType)
    const groupData = this.buildGroupCreateData({ ...payload, displayName })
    const group = await this.repository.createSystemGroup(groupData)

    const createdCredentials: Connection[] = []
    for (const key of normalizedKeys) {
      const credential = await this.repository.createCredential({
        connectionGroupId: group.id,
        enable: key.enable,
        apiKeyLabel: key.apiKeyLabel,
        modelIdsJson: serializeStringArray(key.modelIds),
      })

      const svId = await this.createAndPersistVaultSecret(credential.id, key, authType)
      if (svId != null) {
        ;(credential as Connection).secretVaultId = svId
      }
      createdCredentials.push(credential)
    }

    await this.refreshCatalogSafe(group, createdCredentials, 'create')
    const fresh = await this.repository.findSystemGroupById(group.id)
    if (!fresh) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    return this.toGroupView(fresh)
  }

  async updateSystemConnection(id: number, payload: ConnectionPayload): Promise<ConnectionGroupView> {
    const groupId = await this.resolveGroupId(id)
    const existing = await this.requireGroupById(groupId)
    const displayName = this.requireDisplayName(payload.displayName)
    await this.assertSystemDisplayNameAvailable(displayName, groupId)

    const authType = payload.authType ?? 'bearer'
    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys, authType)
    const existingById = new Map(existing.credentials.map((row) => [row.id, row]))
    const seenIds = new Set<number>()
    const touched: Connection[] = []

    await this.repository.updateSystemGroup(groupId, this.buildGroupUpdateData({ ...payload, displayName }))

    for (const key of normalizedKeys) {
      if (key.id != null) {
        const credential = existingById.get(key.id)
        if (!credential) {
          throw new ConnectionServiceError(`API Key #${key.id} 不属于当前端点`, 400)
        }
        seenIds.add(credential.id)

        const updated = await this.repository.updateCredential(credential.id, {
          enable: key.enable,
          apiKeyLabel: key.apiKeyLabel,
          modelIdsJson: serializeStringArray(key.modelIds),
        })

        if (authType === 'bearer') {
          const resolvedVaultId = await this.replaceOrPreserveVaultSecret(updated.id, key, credential)
          if (resolvedVaultId != null) {
            ;(updated as Connection).secretVaultId = resolvedVaultId
          }
        }

        touched.push(updated)
        continue
      }

      const created = await this.repository.createCredential({
        connectionGroupId: groupId,
        enable: key.enable,
        apiKeyLabel: key.apiKeyLabel,
        modelIdsJson: serializeStringArray(key.modelIds),
      })

      const svId = await this.createAndPersistVaultSecret(created.id, key, authType)
      if (svId != null) {
        ;(created as Connection).secretVaultId = svId
      }
      touched.push(created)
    }

    for (const row of existing.credentials) {
      if (seenIds.has(row.id)) continue
      await this.repository.deleteCredential(row.id)
    }

    const groupSnapshot: ConnectionGroup = {
      ...existing,
      displayName,
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: sanitizeBaseUrl(payload.baseUrl),
      authType,
      headersJson: serializeRecord(payload.headers ?? parseRecord(existing.headersJson)),
      azureApiVersion: normalizeOptionalString(payload.azureApiVersion),
      prefixId: normalizeOptionalString(payload.prefixId),
      tagsJson: serializeTags(payload.tags),
      defaultCapabilitiesJson: serializeDefaultCapabilities(payload.defaultCapabilities),
      connectionType: payload.connectionType ?? 'external',
    }

    await this.refreshCatalogSafe(groupSnapshot, touched, 'update')
    const fresh = await this.repository.findSystemGroupById(groupId)
    if (!fresh) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    return this.toGroupView(fresh)
  }

  async deleteSystemConnection(id: number) {
    const groupId = await this.resolveGroupId(id)
    await this.repository.deleteSystemGroup(groupId)
  }

  async exportSystemConnections(
    actor?: ConnectionActorContext,
  ): Promise<ExportSystemConnectionsResult> {
    const groups = await this.repository.listSystemGroups()
    const connections: ExportConnection[] = []
    let skippedKeys = 0
    const skippedReasons: string[] = []

    for (const group of groups) {
      const authType = (group.authType as AuthType) || 'bearer'
      const headers = parseRecord(group.headersJson)
      const exportKeys: ExportConnectionApiKey[] = []

      for (const row of group.credentials) {
        let apiKey = ''
        if (authType === 'bearer' && row.secretVaultId) {
          try {
            if (!this.secretVault) {
              throw new ConnectionServiceError('Secret Vault 未配置，无法解密 API Key', 500)
            }
            apiKey = await this.secretVault.decryptById(row.secretVaultId)
          } catch {
            skippedKeys += 1
            skippedReasons.push(
              `连接 #${row.id} (${normalizeOptionalString(row.apiKeyLabel) || 'Key'}): 解密失败`,
            )
            continue
          }
        }

        exportKeys.push({
          apiKeyLabel: normalizeOptionalString(row.apiKeyLabel) || `Key ${row.id}`,
          apiKey,
          modelIds: parseStringArray(row.modelIdsJson),
          enable: Boolean(row.enable),
        })
      }

      if (exportKeys.length === 0) continue

      connections.push({
        displayName: group.displayName,
        provider: group.provider as ProviderType,
        vendor: (group.vendor as VendorType | null) ?? undefined,
        baseUrl: sanitizeBaseUrl(group.baseUrl),
        authType,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        azureApiVersion: group.azureApiVersion ?? undefined,
        prefixId: group.prefixId ?? undefined,
        tags: parseTags(group.tagsJson),
        connectionType: (group.connectionType || 'external') as 'external' | 'local',
        defaultCapabilities: parseDefaultCapabilities(group.defaultCapabilitiesJson),
        apiKeys: exportKeys,
      })
    }

    this.logger.info?.('系统连接已导出', {
      actorUserId: actor?.userId ?? null,
      connectionCount: connections.length,
      skippedKeys,
    })

    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      connections,
      skippedKeys,
      skippedReasons,
    }
  }

  async importSystemConnections(
    payload: ImportSystemConnectionsPayload,
    actor?: ConnectionActorContext,
  ): Promise<ImportSystemConnectionsResult> {
    if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) {
      throw new ConnectionServiceError('不支持的 schemaVersion', 400)
    }

    let signatureToGroup = this.buildSignatureGroupMap(await this.repository.listSystemGroups())

    let createdGroups = 0
    let updatedGroups = 0
    let addedKeys = 0
    let skippedKeys = 0
    const skippedReasons: string[] = []

    for (const connection of payload.connections) {
      const withDisplayName = await this.ensureImportDisplayName(connection, signatureToGroup)
      const signature = this.signatureFromPayload(withDisplayName)
      const existing = signatureToGroup.get(signature)

      if (!existing) {
        await this.createSystemConnection(withDisplayName)
        createdGroups += 1
        addedKeys += connection.apiKeys.length
        signatureToGroup = this.buildSignatureGroupMap(await this.repository.listSystemGroups())
        continue
      }

      const authType = (existing.authType as AuthType) || 'bearer'
      const existingPlaintextSet = new Set<string>()

      for (const row of existing.credentials) {
        if (authType !== 'bearer' || !row.secretVaultId) {
          existingPlaintextSet.add('')
          continue
        }
        try {
          if (!this.secretVault) {
            throw new ConnectionServiceError('Secret Vault 未配置，无法解密已有 API Key', 500)
          }
          const plain = await this.secretVault.decryptById(row.secretVaultId)
          existingPlaintextSet.add(plain)
        } catch {
          skippedKeys += 1
          skippedReasons.push(
            `已有 Key #${row.id} (${normalizeOptionalString(row.apiKeyLabel) || 'Key'}): 解密失败，无法去重比对`,
          )
        }
      }

      const keysToAdd: ConnectionApiKeyPayload[] = []
      for (const importKey of connection.apiKeys) {
        const plain = authType === 'bearer' ? (importKey.apiKey?.trim() || '') : ''
        const label = importKey.apiKeyLabel || 'Key'

        if (authType === 'bearer' && !plain) {
          skippedKeys += 1
          skippedReasons.push(`导入 Key (${label}): apiKey 为空`)
          continue
        }

        if (existingPlaintextSet.has(plain)) {
          skippedKeys += 1
          skippedReasons.push(`导入 Key (${label}): 明文已存在`)
          continue
        }

        keysToAdd.push(importKey)
        existingPlaintextSet.add(plain)
      }

      if (keysToAdd.length === 0) continue

      const mergePayload: ConnectionPayload = {
        displayName: existing.displayName,
        provider: existing.provider as ProviderType,
        vendor: (existing.vendor as VendorType | null) ?? undefined,
        baseUrl: sanitizeBaseUrl(existing.baseUrl),
        authType,
        headers: parseRecord(existing.headersJson),
        azureApiVersion: existing.azureApiVersion ?? undefined,
        prefixId: existing.prefixId ?? undefined,
        tags: parseTags(existing.tagsJson),
        connectionType: (existing.connectionType || 'external') as 'external' | 'local',
        defaultCapabilities: parseDefaultCapabilities(existing.defaultCapabilitiesJson),
        apiKeys: [
          ...existing.credentials.map((row) => ({
            id: row.id,
            apiKeyLabel: normalizeOptionalString(row.apiKeyLabel) || undefined,
            modelIds: parseStringArray(row.modelIdsJson),
            enable: Boolean(row.enable),
          })),
          ...keysToAdd,
        ],
      }

      await this.updateSystemConnection(existing.id, mergePayload)
      updatedGroups += 1
      addedKeys += keysToAdd.length
      signatureToGroup = this.buildSignatureGroupMap(await this.repository.listSystemGroups())
    }

    this.logger.info?.('系统连接已导入', {
      actorUserId: actor?.userId ?? null,
      createdGroups,
      updatedGroups,
      addedKeys,
      skippedKeys,
    })

    return {
      createdGroups,
      updatedGroups,
      addedKeys,
      skippedKeys,
      skippedReasons,
    }
  }

  async verifyConnectionConfig(payload: ConnectionPayload | ImportConnectionPayload): Promise<VerifyConnectionResult> {
    const verifyConnection = this.verifyConnection
    if (!verifyConnection) {
      throw new ConnectionServiceError('verifyConnection dependency not provided', 500)
    }

    const authType = payload.authType ?? 'bearer'
    const normalizedKeys = this.normalizeApiKeys(payload.apiKeys, authType)
    const existingById = await this.loadExistingCredentials(normalizedKeys)

    const results = await Promise.all(
      normalizedKeys.map(async (key) => {
        const existing = key.id != null ? existingById.get(key.id) ?? null : null
        const hasStoredApiKey = Boolean(existing?.secretVaultId)

        let plainApiKey: string
        try {
          plainApiKey = await this.resolvePlainApiKeyForVerify({
            authType,
            apiKeyInput: key.apiKey,
            existing,
          })
        } catch (error) {
          return {
            id: key.id,
            apiKeyLabel: key.apiKeyLabel,
            apiKeyMasked: key.apiKey ? maskApiKey(key.apiKey) : null,
            hasStoredApiKey,
            enable: key.enable,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            models: [],
          } satisfies VerifyConnectionKeyResult
        }

        const apiKeyMasked = maskApiKey(plainApiKey)

        try {
          await verifyConnection({
            provider: payload.provider,
            vendor: payload.vendor,
            baseUrl: payload.baseUrl,
            enable: true,
            authType,
            apiKey: plainApiKey || undefined,
            headers: payload.headers,
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
              authType,
              apiKey: plainApiKey || undefined,
              headers: payload.headers,
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

  // --- private helpers ---

  private requireDisplayName(value?: string | null): string {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed) {
      throw new ConnectionServiceError('displayName 不能为空', 400)
    }
    return trimmed
  }

  private async assertSystemDisplayNameAvailable(displayName: string, excludeGroupId?: number) {
    const groups = await this.repository.listSystemGroups()
    const conflict = groups.find(
      (group) => group.displayName === displayName && group.id !== excludeGroupId,
    )
    if (conflict) {
      throw new ConnectionServiceError(`显示名「${displayName}」已被使用`, 409)
    }
  }

  private async ensureImportDisplayName(
    connection: ImportConnectionPayload,
    signatureToGroup: Map<string, ConnectionGroupWithCredentials>,
  ): Promise<ConnectionPayload> {
    const provided = normalizeOptionalString(connection.displayName)
    if (provided) {
      return { ...connection, displayName: provided }
    }

    const seed = seedDisplayName({
      prefixId: connection.prefixId,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
    })
    const taken = new Set(
      Array.from(signatureToGroup.values()).map((group) => group.displayName),
    )
    // also reserve names from a fresh list so create uniqueness holds
    const allGroups = await this.repository.listSystemGroups()
    for (const group of allGroups) {
      taken.add(group.displayName)
    }
    return {
      ...connection,
      displayName: allocateUniqueDisplayName(seed, taken),
    }
  }

  private normalizeApiKeys(
    input: ConnectionApiKeyPayload[],
    authType: AuthType,
  ): NormalizedApiKeyPayload[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new ConnectionServiceError('至少需要一个 API Key 条目', 400)
    }

    return input.map((item, index) => {
      const apiKey = typeof item?.apiKey === 'string' ? item.apiKey.trim() : undefined
      if (authType === 'bearer' && !apiKey && item?.id == null) {
        throw new ConnectionServiceError(`${item?.apiKeyLabel || `Key ${index + 1}`} 的 apiKey 不能为空`, 400)
      }
      return {
        id: Number.isFinite(item?.id) ? Number(item.id) : undefined,
        apiKeyLabel: normalizeOptionalString(item?.apiKeyLabel) || `Key ${index + 1}`,
        apiKey,
        modelIds: normalizeStringArray(item?.modelIds),
        enable: item?.enable ?? true,
      }
    })
  }

  private buildGroupCreateData(payload: ConnectionPayload): ConnectionGroupCreateData {
    return {
      ownerUserId: null,
      displayName: payload.displayName.trim(),
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: sanitizeBaseUrl(payload.baseUrl),
      enable: true,
      authType: payload.authType ?? 'bearer',
      headersJson: serializeRecord(payload.headers),
      azureApiVersion: normalizeOptionalString(payload.azureApiVersion),
      prefixId: normalizeOptionalString(payload.prefixId),
      tagsJson: serializeTags(payload.tags),
      defaultCapabilitiesJson: serializeDefaultCapabilities(payload.defaultCapabilities),
      connectionType: payload.connectionType ?? 'external',
    }
  }

  private buildGroupUpdateData(payload: ConnectionPayload): ConnectionGroupUpdateData {
    return {
      ownerUserId: null,
      displayName: payload.displayName.trim(),
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: sanitizeBaseUrl(payload.baseUrl),
      authType: payload.authType ?? 'bearer',
      headersJson: serializeRecord(payload.headers),
      azureApiVersion: normalizeOptionalString(payload.azureApiVersion),
      prefixId: normalizeOptionalString(payload.prefixId),
      tagsJson: serializeTags(payload.tags),
      defaultCapabilitiesJson: serializeDefaultCapabilities(payload.defaultCapabilities),
      connectionType: payload.connectionType ?? 'external',
    }
  }

  /** Create Vault secret and persist secretVaultId on credential. Returns the secretVaultId. */
  private async createAndPersistVaultSecret(
    credentialId: number,
    key: NormalizedApiKeyPayload,
    authType: AuthType,
  ): Promise<number | null> {
    if (authType !== 'bearer') return null

    if (!this.secretVault) {
      throw new ConnectionServiceError(
        'Secret Vault 未配置。bearer 认证类型的连接需要 Secret Vault 来安全存储 API Key。' +
          '请设置 SECRET_VAULT_MASTER_KEY 环境变量。',
        500,
      )
    }
    if (!key.apiKey) {
      throw new ConnectionServiceError(`${key.apiKeyLabel || 'API Key'} 不能为空`, 400)
    }

    const created = await this.secretVault.createSecret({
      scope: 'system',
      scopeId: 'system',
      kind: 'api_key',
      label: key.apiKeyLabel || `Connection #${credentialId}`,
      value: key.apiKey,
      refId: String(credentialId),
      refType: 'connection',
    })

    await this.repository.updateCredential(credentialId, { secretVaultId: created.id })
    return created.id
  }

  /** Replace Vault secret if new apiKey provided; preserve existing; throw if neither. */
  private async replaceOrPreserveVaultSecret(
    credentialId: number,
    key: NormalizedApiKeyPayload,
    existing: Connection,
  ): Promise<number | null> {
    if (!this.secretVault) {
      if (existing.secretVaultId) return existing.secretVaultId
      throw new ConnectionServiceError(
        'Secret Vault 未配置且连接无已有密钥引用。bearer 认证需要 Secret Vault。',
        500,
      )
    }

    if (key.apiKey) {
      if (existing.secretVaultId) {
        await this.secretVault.deleteSecret(existing.secretVaultId).catch(() => {})
      }
      const created = await this.secretVault.createSecret({
        scope: 'system',
        scopeId: 'system',
        kind: 'api_key',
        label: key.apiKeyLabel || `Connection #${credentialId}`,
        value: key.apiKey,
        refId: String(credentialId),
        refType: 'connection',
      })
      await this.repository.updateCredential(credentialId, { secretVaultId: created.id })
      return created.id
    }

    if (existing.secretVaultId) return existing.secretVaultId

    throw new ConnectionServiceError(
      `${key.apiKeyLabel || 'API Key'} 不能为空：未提供 apiKey 且连接无已存储的密钥`,
      400,
    )
  }

  private async resolvePlainApiKeyForVerify(params: {
    authType: AuthType
    apiKeyInput?: string
    existing?: Connection | null
  }): Promise<string> {
    if (params.authType !== 'bearer') return ''

    if (params.apiKeyInput && params.apiKeyInput.trim()) {
      return params.apiKeyInput.trim()
    }

    if (params.existing?.secretVaultId) {
      if (!this.secretVault) {
        throw new ConnectionServiceError('Secret Vault 未配置，无法解密已有密钥进行验证', 500)
      }
      return this.secretVault.decryptById(params.existing.secretVaultId)
    }

    throw new ConnectionServiceError('存在未填写的新 API Key，无法验证', 400)
  }

  private async loadExistingCredentials(keys: NormalizedApiKeyPayload[]) {
    const ids = Array.from(
      new Set(
        keys
          .map((item) => item.id)
          .filter((item): item is number => typeof item === 'number' && item > 0),
      ),
    )
    if (ids.length === 0) return new Map<number, Connection>()

    const groups = await this.repository.listSystemGroups()
    const map = new Map<number, Connection>()
    for (const group of groups) {
      for (const credential of group.credentials) {
        if (ids.includes(credential.id)) {
          map.set(credential.id, credential)
        }
      }
    }
    return map
  }

  private async requireGroupById(id: number): Promise<ConnectionGroupWithCredentials> {
    const found = await this.repository.findSystemGroupById(id)
    if (!found) {
      throw new ConnectionServiceError('Connection not found', 404)
    }
    return found
  }

  private toGroupView(group: ConnectionGroupWithCredentials): ConnectionGroupView {
    const credentials = [...group.credentials].sort((a, b) => {
      const labelA = normalizeOptionalString(a.apiKeyLabel) || ''
      const labelB = normalizeOptionalString(b.apiKeyLabel) || ''
      return labelA.localeCompare(labelB, 'zh-CN') || a.id - b.id
    })

    return {
      id: group.id,
      displayName: group.displayName,
      connectionIds: credentials.map((row) => row.id),
      provider: group.provider as ProviderType,
      vendor: (group.vendor as VendorType | null) ?? null,
      baseUrl: sanitizeBaseUrl(group.baseUrl),
      authType: (group.authType as AuthType) || 'bearer',
      azureApiVersion: group.azureApiVersion ?? null,
      prefixId: group.prefixId ?? null,
      tags: parseTags(group.tagsJson),
      connectionType: (group.connectionType || 'external') as 'external' | 'local',
      defaultCapabilities: parseDefaultCapabilities(group.defaultCapabilitiesJson),
      apiKeys: credentials.map((row) => {
        const hasKey = Boolean(row.secretVaultId)
        return {
          id: row.id,
          apiKeyLabel: normalizeOptionalString(row.apiKeyLabel) || `Key ${row.id}`,
          apiKeyMasked: hasKey ? '****' : null,
          hasStoredApiKey: hasKey,
          modelIds: parseStringArray(row.modelIdsJson),
          enable: Boolean(row.enable),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        } satisfies ConnectionApiKeyView
      }),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    }
  }

  private async refreshCatalogSafe(
    group: ConnectionGroup,
    credentials: Connection[],
    action: 'create' | 'update',
  ) {
    const credential = pickCredentialForCatalog(group, credentials)
    if (!credential) return
    try {
      await this.refreshModelCatalog(group, credential)
    } catch (error) {
      this.logger.warn?.(`刷新模型目录失败(${action})`, {
        id: group.id,
        error: error instanceof Error ? error.message : error,
      })
    }
  }

  private buildSignatureGroupMap(groups: ConnectionGroupWithCredentials[]) {
    return new Map(
      groups.map((group) => [
        stringifySignature({
          provider: group.provider,
          vendor: group.vendor,
          baseUrl: group.baseUrl,
          authType: group.authType,
          headers: parseRecord(group.headersJson),
          azureApiVersion: group.azureApiVersion,
          prefixId: group.prefixId,
          tags: parseTags(group.tagsJson),
          connectionType: group.connectionType,
          defaultCapabilities: parseDefaultCapabilities(group.defaultCapabilitiesJson),
        }),
        group,
      ]),
    )
  }

  private signatureFromPayload(payload: ImportConnectionPayload | ConnectionPayload) {
    return stringifySignature({
      provider: payload.provider,
      vendor: payload.vendor ?? null,
      baseUrl: payload.baseUrl,
      authType: payload.authType ?? 'bearer',
      headers: payload.headers ?? {},
      azureApiVersion: payload.azureApiVersion ?? null,
      prefixId: payload.prefixId ?? null,
      tags: normalizeTags(payload.tags),
      connectionType: payload.connectionType ?? 'external',
      defaultCapabilities: sortCapabilityFlags(normalizeCapabilityFlags(payload.defaultCapabilities)),
    })
  }
}
