import type { Connection } from '@prisma/client'
import { prisma } from '../db'
import { AuthUtils } from './auth'
import { fetchModelsForConnection, type CatalogItem, type ConnectionConfig } from './providers'
import { BackendLogger as log } from './logger'

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
})

const DEFAULT_TTL_S = 600

const resolveTtlSeconds = () => {
  const raw = parseInt(process.env.MODELS_TTL_S || '', 10)
  if (Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_TTL_S
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
  const cfg = buildConfigFromConnection(conn)
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

  for (const item of items) {
    const key = item.id
    seen.add(key)
    const row = existingMap.get(key)
    const tagsJson = JSON.stringify(item.tags || [])

    if (!row) {
      await prisma.modelCatalog.create({
        data: {
          connectionId: conn.id,
          modelId: key,
          rawId: item.rawId,
          name: item.name,
          provider: item.provider,
          connectionType: item.connectionType,
          tagsJson,
          manualOverride: false,
          lastFetchedAt: now,
          expiresAt,
        },
      })
      continue
    }

    const updateData: Record<string, any> = {
      rawId: item.rawId,
      name: item.name,
      provider: item.provider,
      connectionType: item.connectionType,
      lastFetchedAt: now,
      expiresAt,
    }

    if (!row.manualOverride) {
      updateData.tagsJson = tagsJson
    }

    await prisma.modelCatalog.update({ where: { id: row.id }, data: updateData })
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
  const connections = await prisma.connection.findMany({ where: { enable: true } })
  await refreshModelCatalogForConnections(connections)
}

let catalogTimer: NodeJS.Timeout | null = null

export function scheduleModelCatalogAutoRefresh() {
  const intervalSecRaw = parseInt(process.env.MODELS_REFRESH_INTERVAL_S || '', 10)
  const intervalMs = Number.isFinite(intervalSecRaw) && intervalSecRaw > 0
    ? intervalSecRaw * 1000
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
