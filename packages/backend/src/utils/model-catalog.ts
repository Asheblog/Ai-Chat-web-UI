import type { Connection, ConnectionGroup } from '@prisma/client'
import { prisma } from '../db'
import {
  fetchModelsForConnection,
  type CatalogItem,
  type ConnectionConfig,
  assertSupportedProvider,
  isSupportedProvider,
  SUPPORTED_PROVIDERS,
  computeCapabilities,
  detectModelType,
} from './providers'
import type { SecretVaultService } from '../services/secret-vault'
import { BackendLogger as log } from './logger'
import {
  guessKnownContextWindow,
  guessKnownCompletionLimit,
  invalidateCompletionLimitCache,
  invalidateContextWindowCache,
} from '../services/context/legacy-utils'
import {
  createCapabilityEnvelope,
  mergeCapabilityLayers,
  serializeCapabilityEnvelope,
  normalizeCapabilityFlags,
  hasDefinedCapability,
  type CapabilityFlags,
  type CapabilityEnvelope,
} from './capabilities'

export type ConnectionGroupWithCredentials = ConnectionGroup & { credentials: Connection[] }

const parseJsonArray = <T>(raw: string | null | undefined, fallback: T[]): T[] => {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

const parseJsonRecord = (raw: string | null | undefined): Record<string, string> | undefined => {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return undefined
  } catch {
    return undefined
  }
}

const parseCapabilitiesFromJson = (raw: string | null | undefined): CapabilityFlags | undefined => {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    const flags = normalizeCapabilityFlags(parsed)
    return hasDefinedCapability(flags) ? flags : undefined
  } catch {
    return undefined
  }
}

export const buildConfigFromGroup = async (
  group: ConnectionGroup,
  credential: Connection,
  secretVault?: SecretVaultService,
): Promise<ConnectionConfig> => {
  assertSupportedProvider(group.provider)
  let apiKey: string | undefined
  if (group.authType === 'bearer' && credential.secretVaultId && secretVault) {
    apiKey = await secretVault.decryptById(credential.secretVaultId).catch(() => {
      throw new Error('无法解密 API Key：Secret Vault 解密失败')
    })
  }
  return {
    provider: group.provider as ConnectionConfig['provider'],
    baseUrl: group.baseUrl,
    enable: group.enable && credential.enable,
    authType: group.authType as ConnectionConfig['authType'],
    apiKey,
    headers: parseJsonRecord(group.headersJson),
    prefixId: group.prefixId || undefined,
    tags: parseJsonArray(group.tagsJson, []),
    modelIds: parseJsonArray(credential.modelIdsJson, []),
    connectionType: (group.connectionType as ConnectionConfig['connectionType']) || 'external',
    defaultCapabilities: parseCapabilitiesFromJson(group.defaultCapabilitiesJson),
  }
}

const DEFAULT_TTL_S = 600
let ttlOverrideSeconds: number | null = null

const resolveTtlSeconds = () => {
  if (Number.isFinite(ttlOverrideSeconds) && (ttlOverrideSeconds as number) > 0) {
    return Math.floor(ttlOverrideSeconds as number)
  }
  const raw = parseInt(process.env.MODELS_TTL_S || '', 10)
  if (Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_TTL_S
}

export const setModelCatalogTtlSeconds = (value: number | null | undefined) => {
  if (Number.isFinite(value) && (value as number) > 0) {
    ttlOverrideSeconds = Math.floor(value as number)
  } else {
    ttlOverrideSeconds = null
  }
}

const expireManual = async (connectionGroupId: number) => {
  await prisma.modelCatalog.deleteMany({
    where: {
      connectionGroupId,
      manualOverride: false,
    },
  })
}

export const pickCredentialForCatalogFetch = (
  group: ConnectionGroup,
  credentials: Connection[],
): Connection | null => {
  const enabled = credentials.filter((item) => item.enable)
  const pool = enabled.length > 0 ? enabled : credentials
  if (pool.length === 0) return null
  if ((group.authType as ConnectionConfig['authType']) === 'none') {
    return pool[0] ?? null
  }
  return pool.find((item) => item.secretVaultId != null) ?? pool[0] ?? null
}

export async function refreshModelCatalogForConnectionGroup(
  group: ConnectionGroup,
  credentialForFetch: Connection,
  secretVault?: SecretVaultService,
): Promise<{ connectionGroupId: number; total: number }> {
  assertSupportedProvider(group.provider)
  if (group.ownerUserId != null) {
    log.debug('跳过个人连接组的模型刷新', {
      connectionGroupId: group.id,
      ownerUserId: group.ownerUserId,
    })
    return { connectionGroupId: group.id, total: 0 }
  }

  const cfg = await buildConfigFromGroup(group, credentialForFetch, secretVault)
  const connectionCapabilityLayer = createCapabilityEnvelope(cfg.defaultCapabilities, 'connection_default')
  if (!cfg.enable) {
    await expireManual(group.id)
    return { connectionGroupId: group.id, total: 0 }
  }

  let items: CatalogItem[] = []
  try {
    items = await fetchModelsForConnection(cfg)
  } catch (error) {
    const isAbortError = error instanceof Error && error.name === 'AbortError'
    const isNetworkError =
      error instanceof Error &&
      (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('fetch failed'))
    if (isAbortError || isNetworkError) {
      log.warn('刷新模型目录网络超时，跳过此连接组', {
        connectionGroupId: group.id,
        provider: group.provider,
      })
      return { connectionGroupId: group.id, total: 0 }
    }
    log.warn('刷新模型目录失败', { connectionGroupId: group.id, provider: group.provider, error })
    throw error
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + resolveTtlSeconds() * 1000)
  const existing = await prisma.modelCatalog.findMany({ where: { connectionGroupId: group.id } })
  const existingMap = new Map(existing.map((row) => [row.modelId, row]))

  const seen = new Set<string>()

  const metaCache = existing.reduce((acc, row) => {
    acc.set(row.modelId, row.metaJson || '{}')
    return acc
  }, new Map<string, string>())

  const memoContext = new Map<string, number | null>()
  const memoCompletion = new Map<string, number | null>()

  const resolveContextWindowForItem = async (item: CatalogItem): Promise<number | null> => {
    const cacheKey = `${item.rawId}`
    if (memoContext.has(cacheKey)) {
      return memoContext.get(cacheKey) ?? null
    }

    let contextWindow: number | null = null

    if (item.rawId) {
      const guessed = guessKnownContextWindow(cfg.provider, item.rawId)
      if (guessed) {
        contextWindow = guessed
      }
    }

    memoContext.set(cacheKey, contextWindow ?? null)
    return contextWindow
  }

  const resolveCompletionLimitForItem = (item: CatalogItem): number | null => {
    const cacheKey = `${item.rawId}`
    if (memoCompletion.has(cacheKey)) {
      return memoCompletion.get(cacheKey) ?? null
    }
    let completionLimit: number | null = null
    if (item.rawId) {
      const guessed = guessKnownCompletionLimit(cfg.provider, item.rawId)
      if (guessed) {
        completionLimit = guessed
      }
    }
    memoCompletion.set(cacheKey, completionLimit ?? null)
    return completionLimit
  }

  const parseMeta = (raw: string | null | undefined) => {
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === 'object' && parsed ? parsed : {}
    } catch {
      return {}
    }
  }

  const toCreate: Array<{
    connectionGroupId: number
    modelId: string
    rawId: string
    name: string
    provider: string
    connectionType: string
    modelType: string
    tagsJson: string
    metaJson: string
    capabilitiesJson: string
    manualOverride: boolean
    lastFetchedAt: Date
    expiresAt: Date
  }> = []
  const toUpdate: Array<{ id: number; data: Record<string, any>; rawId: string }> = []

  for (const item of items) {
    const key = item.id
    seen.add(key)
    const row = existingMap.get(key)
    const tagsJson = JSON.stringify(item.tags || [])
    const contextWindow = await resolveContextWindowForItem(item)
    const completionLimit = resolveCompletionLimitForItem(item)
    const metaInput = row ? parseMeta(metaCache.get(key)) : {}
    const capabilityLayers = ([
      connectionCapabilityLayer,
      createCapabilityEnvelope(item.capabilities, item.capabilitySource || 'provider'),
      createCapabilityEnvelope(computeCapabilities(item.rawId, item.tags), 'heuristic'),
    ].filter((layer): layer is CapabilityEnvelope => Boolean(layer)))
    const resolvedCapabilities = mergeCapabilityLayers(capabilityLayers)
    const capabilitiesJson = serializeCapabilityEnvelope(resolvedCapabilities)
    const modelType = detectModelType(item.rawId, item.tags)

    if (contextWindow && (!row?.manualOverride || metaInput.context_window == null)) {
      metaInput.context_window = contextWindow
    } else if (!('context_window' in metaInput)) {
      metaInput.context_window = null
    }
    if (completionLimit && (!row?.manualOverride || metaInput.max_output_tokens == null)) {
      metaInput.max_output_tokens = completionLimit
    } else if (!('max_output_tokens' in metaInput)) {
      metaInput.max_output_tokens = null
    }
    metaInput.fetched_at = now.toISOString()
    const metaJson = JSON.stringify(metaInput)

    if (!row) {
      toCreate.push({
        connectionGroupId: group.id,
        modelId: key,
        rawId: item.rawId,
        name: item.name,
        provider: item.provider,
        connectionType: item.connectionType,
        modelType,
        tagsJson,
        metaJson,
        capabilitiesJson,
        manualOverride: false,
        lastFetchedAt: now,
        expiresAt,
      })
    } else {
      const updateData: Record<string, any> = {
        rawId: item.rawId,
        name: item.name,
        provider: item.provider,
        connectionType: item.connectionType,
        modelType,
        lastFetchedAt: now,
        expiresAt,
        metaJson,
      }

      if (!row.manualOverride) {
        updateData.tagsJson = tagsJson
        updateData.capabilitiesJson = capabilitiesJson
      }

      toUpdate.push({ id: row.id, data: updateData, rawId: item.rawId })
    }
  }

  const staleIds = existing
    .filter((row) => !seen.has(row.modelId) && !row.manualOverride)
    .map((row) => row.id)

  await prisma.$transaction(
    async (tx) => {
      if (toCreate.length > 0) {
        await tx.modelCatalog.createMany({ data: toCreate })
      }

      for (const item of toUpdate) {
        await tx.modelCatalog.update({ where: { id: item.id }, data: item.data })
      }

      if (staleIds.length > 0) {
        await tx.modelCatalog.deleteMany({ where: { id: { in: staleIds } } })
      }
    },
    {
      timeout: 10000,
    },
  )

  for (const item of toCreate) {
    invalidateContextWindowCache(group.id, item.rawId)
    invalidateCompletionLimitCache(group.id, item.rawId)
  }
  for (const item of toUpdate) {
    invalidateContextWindowCache(group.id, item.rawId)
    invalidateCompletionLimitCache(group.id, item.rawId)
  }

  return { connectionGroupId: group.id, total: items.length }
}

export async function refreshModelCatalogForConnectionGroupId(
  connectionGroupId: number,
  secretVault?: SecretVaultService,
) {
  const group = await prisma.connectionGroup.findUnique({
    where: { id: connectionGroupId },
    include: { credentials: true },
  })
  if (!group) return
  const credential = pickCredentialForCatalogFetch(group, group.credentials)
  if (!credential) return
  await refreshModelCatalogForConnectionGroup(group, credential, secretVault)
}

export async function refreshModelCatalogForConnectionGroups(
  groups: ConnectionGroupWithCredentials[],
  secretVault?: SecretVaultService,
) {
  for (const group of groups) {
    if (!isSupportedProvider(group.provider)) continue
    try {
      const credential = pickCredentialForCatalogFetch(group, group.credentials)
      if (!credential) continue
      await refreshModelCatalogForConnectionGroup(group, credential, secretVault)
    } catch (error) {
      log.warn('刷新模型目录出错，继续下一个', { connectionGroupId: group.id, error })
    }
  }
}

export async function refreshAllModelCatalog(secretVault?: SecretVaultService) {
  const groups = await prisma.connectionGroup.findMany({
    where: { enable: true, ownerUserId: null, provider: { in: [...SUPPORTED_PROVIDERS] } },
    include: { credentials: true },
  })
  await refreshModelCatalogForConnectionGroups(groups, secretVault)
}

let catalogTimer: NodeJS.Timeout | null = null

export function scheduleModelCatalogAutoRefresh(
  options: { refreshIntervalMs?: number; secretVault?: SecretVaultService } = {},
) {
  const intervalMs =
    Number.isFinite(options.refreshIntervalMs) && (options.refreshIntervalMs as number) > 0
      ? Math.floor(options.refreshIntervalMs as number)
      : resolveTtlSeconds() * 1000

  if (catalogTimer) {
    clearInterval(catalogTimer)
  }

  const run = async () => {
    try {
      await refreshAllModelCatalog(options.secretVault)
    } catch (error) {
      log.error('定时刷新模型目录失败', error)
    }
  }

  run().catch(() => {})

  catalogTimer = setInterval(() => {
    run().catch(() => {})
  }, intervalMs)

  log.info('已开启模型目录定时刷新', { intervalMs })

  return () => {
    if (catalogTimer) {
      clearInterval(catalogTimer)
      catalogTimer = null
      log.info('已关闭模型目录定时刷新')
    }
  }
}
