import { Hono } from 'hono'
import { prisma } from '../db'
import type { ApiResponse } from '../types'
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth'
import { fetchModelsForConnection, type CatalogItem, computeCapabilities } from '../utils/providers'
import { AuthUtils } from '../utils/auth'

const catalog = new Hono()

// GET /api/catalog/models - 当前用户可见（系统连接 + 本人直连）聚合后的模型列表
catalog.get('/models', authMiddleware, async (c) => {
  const user = c.get('user')
  // 系统连接
  const systemConns = await prisma.connection.findMany({ where: { ownerUserId: null, enable: true } })
  // 用户直连
  const userConns = await prisma.connection.findMany({ where: { ownerUserId: user.id, enable: true } })

  const all = [...systemConns, ...userConns]
  const results: Array<{ connectionId: number; items: CatalogItem[] }> = []

  for (const conn of all) {
    const cfg = {
      provider: conn.provider as any,
      baseUrl: conn.baseUrl,
      enable: conn.enable,
      authType: conn.authType as any,
      apiKey: conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : undefined,
      headers: conn.headersJson ? JSON.parse(conn.headersJson) : undefined,
      azureApiVersion: conn.azureApiVersion || undefined,
      prefixId: conn.prefixId || undefined,
      tags: conn.tagsJson ? JSON.parse(conn.tagsJson) : [],
      modelIds: conn.modelIdsJson ? JSON.parse(conn.modelIdsJson) : [],
      connectionType: (conn.connectionType as any) || 'external',
    }

    try {
      const items = await fetchModelsForConnection(cfg)
      results.push({ connectionId: conn.id, items })
    } catch (e) {
      // 某个连接失败不影响整体
    }
  }

  // 读取覆盖标签（管理员可在模型管理中编辑）；若存在则覆盖动态抓取的 tags
  const overrides = await prisma.modelCatalog.findMany({ select: { connectionId: true, modelId: true, tagsJson: true } })
  const overrideMap = new Map<string, Array<{ name: string }>>()
  for (const r of overrides) {
    try {
      const key = `${r.connectionId}:${r.modelId}`
      overrideMap.set(key, JSON.parse(r.tagsJson || '[]') || [])
    } catch {}
  }

  // 扁平化并覆盖 tags/capabilities
  const flat = results.flatMap(({ connectionId, items }) => {
    return items.map((m) => {
      const key = `${connectionId}:${m.id}`
      const tags = overrideMap.get(key) || m.tags || []
      return { ...m, connectionId, tags, capabilities: computeCapabilities(m.rawId, tags), overridden: overrideMap.has(key) }
    })
  })

  return c.json<ApiResponse>({ success: true, data: flat })
})

// 管理员手动刷新（将列表写入缓存表）
catalog.post('/models/refresh', authMiddleware, adminOnlyMiddleware, async (c) => {
  const now = new Date()
  const ttlSec = parseInt(process.env.MODELS_TTL_S || '120')
  const expiresAt = new Date(now.getTime() + ttlSec * 1000)

  const conns = await prisma.connection.findMany({ where: { enable: true } })
  for (const conn of conns) {
    const cfg = {
      provider: conn.provider as any,
      baseUrl: conn.baseUrl,
      enable: conn.enable,
      authType: conn.authType as any,
      apiKey: conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : undefined,
      headers: conn.headersJson ? JSON.parse(conn.headersJson) : undefined,
      azureApiVersion: conn.azureApiVersion || undefined,
      prefixId: conn.prefixId || undefined,
      tags: conn.tagsJson ? JSON.parse(conn.tagsJson) : [],
      modelIds: conn.modelIdsJson ? JSON.parse(conn.modelIdsJson) : [],
      connectionType: (conn.connectionType as any) || 'external',
    }
    try {
      const items = await fetchModelsForConnection(cfg)
      // 清理旧条目
      await prisma.modelCatalog.deleteMany({ where: { connectionId: conn.id } })
      // 写入新条目
      for (const it of items) {
        await prisma.modelCatalog.create({
          data: {
            connectionId: conn.id,
            modelId: it.id,
            rawId: it.rawId,
            name: it.name,
            provider: it.provider,
            connectionType: it.connectionType,
            tagsJson: JSON.stringify(it.tags || []),
            lastFetchedAt: now,
            expiresAt,
          },
        })
      }
    } catch (e) {}
  }

  return c.json<ApiResponse>({ success: true, message: 'Refreshed' })
})

export default catalog

// 管理端：为某个聚合模型（连接+原始ID）设置标签（覆盖）
catalog.put('/models/tags', authMiddleware, adminOnlyMiddleware, async (c) => {
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
          lastFetchedAt: now,
          expiresAt: new Date(now.getTime() + ttlSec * 1000),
        },
      })
    } else {
      await prisma.modelCatalog.update({ where: { id: exists.id }, data: { tagsJson: JSON.stringify(tags || []), lastFetchedAt: now } })
    }

    return c.json<ApiResponse>({ success: true, message: 'Saved' })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to save tags' }, 500)
  }
})

// 管理端：批量或全部删除模型覆写（model_catalog 中的条目）
catalog.delete('/models/tags', authMiddleware, adminOnlyMiddleware, async (c) => {
  try {
    let body: any = {}
    try { body = await c.req.json() } catch {}
    const all = Boolean(body?.all)
    if (all) {
      const r = await prisma.modelCatalog.deleteMany({})
      return c.json<ApiResponse>({ success: true, message: `Deleted ${r.count} overrides` })
    }
    const items = Array.isArray(body?.items) ? body.items : []
    if (!items.length) return c.json<ApiResponse>({ success: false, error: 'items required' }, 400)

    const connectionIds = Array.from(new Set(items.map((i: any) => Number(i.connectionId)).filter(Boolean)))
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
    const r = await prisma.modelCatalog.deleteMany({ where: { OR: orKeys } })
    return c.json<ApiResponse>({ success: true, message: `Deleted ${r.count} overrides` })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete overrides' }, 500)
  }
})

// 管理端：导出当前覆写（覆盖记录）
catalog.get('/models/overrides', authMiddleware, adminOnlyMiddleware, async (c) => {
  try {
    const rows = await prisma.modelCatalog.findMany({ select: { connectionId: true, rawId: true, modelId: true, tagsJson: true } })
    const items = rows.map((r) => ({ connectionId: r.connectionId, rawId: r.rawId, modelId: r.modelId, tags: JSON.parse(r.tagsJson || '[]') }))
    return c.json<ApiResponse>({ success: true, data: items })
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Failed to export overrides' }, 500)
  }
})
