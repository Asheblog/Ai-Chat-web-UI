import { Hono } from 'hono'
import { prisma } from '../db'
import type { ApiResponse, Actor } from '../types'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import { computeCapabilities, deriveChannelName } from '../utils/providers'
import { refreshAllModelCatalog, refreshModelCatalogForConnections, refreshModelCatalogForConnectionId } from '../utils/model-catalog'
import { BackendLogger as log } from '../utils/logger'

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
        capabilities: computeCapabilities(row.rawId, tags),
        overridden: row.manualOverride,
        contextWindow,
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
    const tags: Array<{ name: string }> = Array.isArray(body.tags) ? body.tags : []
    if (!connectionId || !rawId) return c.json<ApiResponse>({ success: false, error: 'connectionId/rawId required' }, 400)

    const conn = await prisma.connection.findUnique({ where: { id: connectionId } })
    if (!conn) return c.json<ApiResponse>({ success: false, error: 'Connection not found' }, 404)
    const modelId = (conn.prefixId ? `${conn.prefixId}.` : '') + rawId

    const now = new Date()
    const ttlSec = parseInt(process.env.MODELS_TTL_S || '120')
    const exists = await prisma.modelCatalog.findFirst({ where: { connectionId, modelId } })
    const expiresAt = new Date(now.getTime() + ttlSec * 1000)
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
          manualOverride: true,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    } else {
      await prisma.modelCatalog.update({
        where: { id: exists.id },
        data: {
          tagsJson: JSON.stringify(tags || []),
          manualOverride: true,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    }

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
    const rows = await prisma.modelCatalog.findMany({ where: { manualOverride: true }, select: { connectionId: true, rawId: true, modelId: true, tagsJson: true } })
    const items = rows.map((r) => ({ connectionId: r.connectionId, rawId: r.rawId, modelId: r.modelId, tags: JSON.parse(r.tagsJson || '[]') }))
    return c.json<ApiResponse>({ success: true, data: items })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to export overrides' }, 500)
  }
})
