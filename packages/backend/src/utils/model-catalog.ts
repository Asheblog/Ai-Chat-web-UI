import type { Connection } from '@prisma/client'
import { prisma } from '../db'
import fetch from 'node-fetch'
import { AuthUtils } from './auth'
import {
  fetchModelsForConnection,
  type CatalogItem,
  type ConnectionConfig,
  buildHeaders,
  computeCapabilities,
  detectModelType,
} from './providers'
import { BackendLogger as log } from './logger'
import { guessKnownContextWindow, guessKnownCompletionLimit, invalidateCompletionLimitCache, invalidateContextWindowCache } from './context-window'
import {
  createCapabilityEnvelope,
  mergeCapabilityLayers,
  parseCapabilityEnvelope,
  serializeCapabilityEnvelope,
  normalizeCapabilityFlags,
  hasDefinedCapability,
  type CapabilityFlags,
  type CapabilityEnvelope,
} from './capabilities'

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

const buildConfigFromConnection = (conn: Connection): ConnectionConfig => ({
  provider: conn.provider as ConnectionConfig['provider'],
  baseUrl: conn.baseUrl,
  enable: conn.enable,
  authType: conn.authType as ConnectionConfig['authType'],
  apiKey: conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : undefined,
  headers: parseJsonRecord(conn.headersJson),
  azureApiVersion: conn.azureApiVersion || undefined,
  prefixId: conn.prefixId || undefined,
  tags: parseJsonArray(conn.tagsJson, []),
  modelIds: parseJsonArray(conn.modelIdsJson, []),
  connectionType: (conn.connectionType as any) || 'external',
  defaultCapabilities: parseCapabilitiesFromJson(conn.defaultCapabilitiesJson),
})

const DEFAULT_TTL_S = 600
let ttlOverrideSeconds: number | null = null

const OLLAMA_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const ollamaShowCache = new Map<string, { value: number | null; expiresAt: number }>()

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

const normalizeConnectionsToSystem = async () => {
  const result = await prisma.connection.updateMany({
    where: { ownerUserId: { not: null } },
    data: { ownerUserId: null },
  })
  if (result.count > 0) {
    log.info('已自动将个人直连转为系统连接', { affected: result.count })
  }
}

const expireManual = async (connectionId: number) => {
  await prisma.modelCatalog.deleteMany({
    where: {
      connectionId,
      manualOverride: false,
    },
  })
}

export async function refreshModelCatalogForConnection(conn: Connection): Promise<{ connectionId: number; total: number }> {
  if (conn.ownerUserId != null) {
    log.debug('跳过个人连接的模型刷新', { connectionId: conn.id, ownerUserId: conn.ownerUserId })
    return { connectionId: conn.id, total: 0 }
  }
  const cfg = buildConfigFromConnection(conn)
  const connectionCapabilityLayer = createCapabilityEnvelope(cfg.defaultCapabilities, 'connection_default')
  if (!cfg.enable) {
    await expireManual(conn.id)
    return { connectionId: conn.id, total: 0 }
  }

  let items: CatalogItem[] = []
  try {
    items = await fetchModelsForConnection(cfg)
  } catch (error) {
    log.warn('刷新模型目录失败', { connectionId: conn.id, provider: conn.provider, error })
    throw error
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + resolveTtlSeconds() * 1000)
  const existing = await prisma.modelCatalog.findMany({ where: { connectionId: conn.id } })
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

    if (cfg.provider === 'ollama' && item.rawId) {
      const ollamaKey = `${cfg.baseUrl.replace(/\/$/, '')}:${item.rawId}`
      const now = Date.now()
      const cached = ollamaShowCache.get(ollamaKey)
      if (cached && cached.expiresAt > now) {
        contextWindow = cached.value
      } else {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        try {
          const headers = await buildHeaders(cfg.provider, cfg.authType, cfg.apiKey, cfg.headers)
          const response = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/show`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: item.rawId, name: item.rawId }),
            signal: controller.signal,
          })
          if (response.ok) {
            const json: any = await response.json()
            const numCtx = json?.details?.parameters?.num_ctx
            if (Number.isFinite(numCtx)) {
              contextWindow = Number(numCtx)
            }
          }
        } catch (error) {
          log.debug('获取 Ollama 模型 context_window 失败', { model: item.rawId, error: (error as Error)?.message })
        } finally {
          clearTimeout(timer)
          if (!controller.signal.aborted) {
            controller.abort()
          }
        }

        const cacheValue = {
          value: contextWindow ?? null,
          expiresAt: now + OLLAMA_CONTEXT_CACHE_TTL_MS,
        }
        ollamaShowCache.set(ollamaKey, cacheValue)
      }
    } else if (item.rawId) {
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
      await prisma.modelCatalog.create({
        data: {
          connectionId: conn.id,
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
    },
  })
      invalidateContextWindowCache(conn.id, item.rawId)
      invalidateCompletionLimitCache(conn.id, item.rawId)
      continue
    }

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

    await prisma.modelCatalog.update({ where: { id: row.id }, data: updateData })
    invalidateContextWindowCache(conn.id, item.rawId)
    invalidateCompletionLimitCache(conn.id, item.rawId)
  }

  const staleIds = existing
    .filter((row) => !seen.has(row.modelId) && !row.manualOverride)
    .map((row) => row.id)

  if (staleIds.length) {
    await prisma.modelCatalog.deleteMany({ where: { id: { in: staleIds } } })
  }

  return { connectionId: conn.id, total: items.length }
}

export async function refreshModelCatalogForConnectionId(connectionId: number) {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId } })
  if (!conn) return
  await refreshModelCatalogForConnection(conn)
}

export async function refreshModelCatalogForConnections(connections: Connection[]) {
  for (const conn of connections) {
    try {
      await refreshModelCatalogForConnection(conn)
    } catch (error) {
      log.warn('刷新模型目录出错，继续下一个', { connectionId: conn.id, error })
    }
  }
}

export async function refreshAllModelCatalog() {
  const connections = await prisma.connection.findMany({ where: { enable: true, ownerUserId: null } })
  await refreshModelCatalogForConnections(connections)
}

let catalogTimer: NodeJS.Timeout | null = null

export function scheduleModelCatalogAutoRefresh(options: { refreshIntervalMs?: number } = {}) {
  const intervalMs = Number.isFinite(options.refreshIntervalMs) && (options.refreshIntervalMs as number) > 0
    ? Math.floor(options.refreshIntervalMs as number)
    : resolveTtlSeconds() * 1000

  if (catalogTimer) {
    clearInterval(catalogTimer)
  }

  const run = async () => {
    try {
      await refreshAllModelCatalog()
    } catch (error) {
      log.error('定时刷新模型目录失败', error)
    }
  }

  normalizeConnectionsToSystem()
    .catch((err) => log.warn('归并个人直连失败', err))
    .finally(() => {
      run().catch(() => {})
    })

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
