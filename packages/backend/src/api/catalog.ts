import { Hono } from 'hono'
import { prisma } from '../db'
import type { ApiResponse, Actor } from '../types'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import { computeCapabilities, deriveChannelName } from '../utils/providers'
import { refreshAllModelCatalog, refreshModelCatalogForConnections, refreshModelCatalogForConnectionId } from '../utils/model-catalog'
import { BackendLogger as log } from '../utils/logger'
import {
  parseCapabilityEnvelope,
  normalizeCapabilityFlags,
  hasDefinedCapability,
  serializeCapabilityEnvelope,
} from '../utils/capabilities'
import { invalidateCompletionLimitCache, invalidateContextWindowCache } from '../utils/context-window'

const extractContextWindow = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const raw = (parsed as any)?.context_window
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw)
    }
    const coerced = Number.parseInt(String(raw ?? ''), 10)
    if (Number.isFinite(coerced) && coerced > 0) {
      return Math.floor(coerced)
    }
  } catch {
    // ignore malformed payload
  }
  return null
}

const extractMaxOutputTokens = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const candidates = [
      (parsed as any)?.custom_max_output_tokens,
      (parsed as any)?.max_output_tokens,
      (parsed as any)?.max_completion_tokens,
      (parsed as any)?.completion_limit,
    ]
    for (const candidate of candidates) {
      const num = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate ?? ''), 10)
      if (Number.isFinite(num) && num > 0) {
        return num
      }
    }
  } catch {
    // ignore invalid metaJson
  }
  return null
}

const clampMaxOutputTokens = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 1) return 0
  if (value > 256_000) return 256_000
  return Math.floor(value)
}

const parseMetaObject = (metaJson: string | null | undefined): Record<string, any> => {
  if (!metaJson) return {}
  try {
    const parsed = JSON.parse(metaJson)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const catalog = new Hono()

catalog.use('*', actorMiddleware)

// GET /api/catalog/models - 当前用户可见的系统连接聚合模型列表
catalog.get('/models', async (c) => {
  const actor = c.get('actor') as Actor

  const connections = await prisma.connection.findMany({ where: { ownerUserId: null, enable: true } })
  if (connections.length === 0) {
    return c.json<ApiResponse>({ success: true, data: [] })
  }

  const connMap = new Map(connections.map((item) => [item.id, item]))
  const connectionIds = connections.map((item) => item.id)

  const loadRows = async () => prisma.modelCatalog.findMany({ where: { connectionId: { in: connectionIds } } })

  let rows = await loadRows()
  const now = new Date()
  const needsRefresh: number[] = []

  for (const conn of connections) {
    const related = rows.filter((row) => row.connectionId === conn.id)
    if (related.length === 0) {
      needsRefresh.push(conn.id)
      continue
    }
    const expired = related.every((row) => row.expiresAt <= now)
    if (expired) {
      needsRefresh.push(conn.id)
    }
  }

  if (needsRefresh.length) {
    const refreshTargets = connections.filter((conn) => needsRefresh.includes(conn.id))
    await refreshModelCatalogForConnections(refreshTargets)
    rows = await loadRows()
  }

  const list = rows
    .filter((row) => connMap.has(row.connectionId))
    .map((row) => {
      const conn = connMap.get(row.connectionId)!
      let tags: Array<{ name: string }> = []
      try {
        const parsed = JSON.parse(row.tagsJson || '[]')
        tags = Array.isArray(parsed) ? parsed : []
      } catch {
        tags = []
      }
      const contextWindow = extractContextWindow(row.metaJson)
      const maxOutputTokens = extractMaxOutputTokens(row.metaJson)
      const storedCaps = parseCapabilityEnvelope(row.capabilitiesJson)
      let capabilities = storedCaps?.flags
      let capabilitySource = storedCaps?.source ?? null
      if (!storedCaps || !hasDefinedCapability(capabilities)) {
        const fallback = computeCapabilities(row.rawId, tags)
        if (hasDefinedCapability(fallback)) {
          capabilities = fallback
          capabilitySource = 'legacy'
        } else {
          capabilities = undefined
          capabilitySource = null
        }
      }

      return {
        id: row.modelId,
        rawId: row.rawId,
        name: row.name,
        provider: row.provider,
        channelName: deriveChannelName(conn.provider as any, conn.baseUrl),
        connectionBaseUrl: conn.baseUrl,
        connectionId: row.connectionId,
        connectionType: row.connectionType,
        tags,
        capabilities,
        capabilitySource: capabilitySource || undefined,
        overridden: row.manualOverride,
        contextWindow,
        maxOutputTokens,
      }
    })

  return c.json<ApiResponse>({ success: true, data: list })
})

// 管理员手动刷新（将列表写入缓存表）
catalog.post('/models/refresh', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    await refreshAllModelCatalog()
    return c.json<ApiResponse>({ success: true, message: 'Refreshed' })
  } catch (error: any) {
    log.error('手动刷新模型目录失败', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to refresh models' }, 500)
  }
})

export default catalog

// 管理端：为某个聚合模型（连接+原始ID）设置标签（覆盖）
catalog.put('/models/tags', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    const connectionId = parseInt(String(body.connectionId || '0'))
    const rawId = String(body.rawId || '')
    const hasTagsPayload = Array.isArray(body.tags)
    const tags: Array<{ name: string }> | undefined = hasTagsPayload ? body.tags : undefined
    const hasCapabilitiesPayload = body.capabilities != null
    const capabilityFlags = hasCapabilitiesPayload ? normalizeCapabilityFlags(body.capabilities) : undefined
    const capabilitiesJson = hasCapabilitiesPayload ? serializeCapabilityEnvelope({ flags: capabilityFlags || {}, source: 'manual' }) : undefined
    const hasMaxTokensPayload = Object.prototype.hasOwnProperty.call(body, 'max_output_tokens')
    let maxOutputTokens: number | null | undefined = undefined
    if (hasMaxTokensPayload) {
      const rawTokens = body.max_output_tokens
      if (rawTokens === null) {
        maxOutputTokens = null
      } else {
        const numeric = typeof rawTokens === 'number'
          ? rawTokens
          : typeof rawTokens === 'string'
          ? Number.parseInt(rawTokens.trim(), 10)
          : NaN
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return c.json<ApiResponse>({ success: false, error: 'max_output_tokens must be a positive integer or null' }, 400)
        }
        maxOutputTokens = clampMaxOutputTokens(numeric)
      }
    }
    const hasContextWindowPayload = Object.prototype.hasOwnProperty.call(body, 'context_window')
    let contextWindow: number | null | undefined = undefined
    if (hasContextWindowPayload) {
      const rawCtx = body.context_window
      if (rawCtx === null) {
        contextWindow = null
      } else {
        const numeric = typeof rawCtx === 'number'
          ? rawCtx
          : typeof rawCtx === 'string'
          ? Number.parseInt(rawCtx.trim(), 10)
          : NaN
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return c.json<ApiResponse>({ success: false, error: 'context_window must be a positive integer or null' }, 400)
        }
        contextWindow = Math.floor(numeric)
      }
    }
    if (!connectionId || !rawId) return c.json<ApiResponse>({ success: false, error: 'connectionId/rawId required' }, 400)

    const conn = await prisma.connection.findUnique({ where: { id: connectionId } })
    if (!conn) return c.json<ApiResponse>({ success: false, error: 'Connection not found' }, 404)
    const modelId = (conn.prefixId ? `${conn.prefixId}.` : '') + rawId

    const now = new Date()
    const ttlSec = parseInt(process.env.MODELS_TTL_S || '120')
    const exists = await prisma.modelCatalog.findFirst({ where: { connectionId, modelId } })
    const expiresAt = new Date(now.getTime() + ttlSec * 1000)
    const metaPayload = parseMetaObject(exists?.metaJson)
    if (hasMaxTokensPayload) {
      if (maxOutputTokens === null) {
        delete metaPayload.custom_max_output_tokens
      } else {
        metaPayload.custom_max_output_tokens = maxOutputTokens
      }
    }
    if (hasContextWindowPayload) {
      if (contextWindow === null) {
        delete metaPayload.context_window
      } else {
        metaPayload.context_window = contextWindow
      }
    }
    const metaJson = JSON.stringify(metaPayload)
    if (!exists) {
      await prisma.modelCatalog.create({
        data: {
          connectionId,
          modelId,
          rawId,
          name: rawId,
          provider: conn.provider,
          connectionType: (conn.connectionType as any) || 'external',
          tagsJson: JSON.stringify(tags || []),
          capabilitiesJson: capabilitiesJson || '{}',
          metaJson,
          manualOverride: true,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    } else {
      await prisma.modelCatalog.update({
        where: { id: exists.id },
        data: {
          ...(hasTagsPayload ? { tagsJson: JSON.stringify(tags || []) } : {}),
          ...(capabilitiesJson ? { capabilitiesJson } : {}),
          metaJson,
          manualOverride: true,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    }

    invalidateCompletionLimitCache(connectionId, rawId)
    invalidateContextWindowCache(connectionId, rawId)
    return c.json<ApiResponse>({ success: true, message: 'Saved' })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to save tags' }, 500)
  }
})

// 管理端：批量或全部删除模型覆写（model_catalog 中的条目）
catalog.delete('/models/tags', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    let body: any = {}
    try { body = await c.req.json() } catch {}
    const all = Boolean(body?.all)
    if (all) {
      const r = await prisma.modelCatalog.deleteMany({ where: { manualOverride: true } })
      await refreshAllModelCatalog()
      return c.json<ApiResponse>({ success: true, message: `Deleted ${r.count} overrides` })
    }
    const items = Array.isArray(body?.items) ? body.items : []
    if (!items.length) return c.json<ApiResponse>({ success: false, error: 'items required' }, 400)

    const rawConnectionIds = items
      .map((i: any): number => Number(i.connectionId))
      .filter((id: number): id is number => Number.isFinite(id) && id > 0)
    const connectionIds: number[] = Array.from(new Set<number>(rawConnectionIds))
    const conns = await prisma.connection.findMany({ where: { id: { in: connectionIds } }, select: { id: true, prefixId: true } })
    const pxMap = new Map<number, string | null>()
    conns.forEach((c2) => pxMap.set(c2.id, c2.prefixId))
    const orKeys = items.map((i: any) => {
      const cid = Number(i.connectionId)
      const raw = String(i.rawId || '')
      const px = (pxMap.get(cid) || '') || ''
      const modelId = (px ? `${px}.` : '') + raw
      return { connectionId: cid, modelId }
    })
    const r = await prisma.modelCatalog.deleteMany({ where: { OR: orKeys, manualOverride: true } })
    for (const cid of connectionIds) {
      await refreshModelCatalogForConnectionId(cid)
    }
    return c.json<ApiResponse>({ success: true, message: `Deleted ${r.count} overrides` })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete overrides' }, 500)
  }
})

// 管理端：导出当前覆写（覆盖记录）
catalog.get('/models/overrides', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const rows = await prisma.modelCatalog.findMany({ where: { manualOverride: true }, select: { connectionId: true, rawId: true, modelId: true, tagsJson: true, capabilitiesJson: true } })
    const items = rows.map((r) => {
      const parsedCaps = parseCapabilityEnvelope(r.capabilitiesJson)
      return {
        connectionId: r.connectionId,
        rawId: r.rawId,
        modelId: r.modelId,
        tags: JSON.parse(r.tagsJson || '[]'),
        capabilities: parsedCaps?.flags || undefined,
        capabilitySource: parsedCaps?.source || null,
      }
    })
    return c.json<ApiResponse>({ success: true, data: items })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to export overrides' }, 500)
  }
})
