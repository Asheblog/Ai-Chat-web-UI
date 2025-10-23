import { Hono } from 'hono'
import { prisma } from '../db'
import type { ApiResponse } from '../types'
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth'
import { fetchModelsForConnection, type CatalogItem } from '../utils/providers'
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

  // 扁平化
  const flat = results.flatMap(({ connectionId, items }) =>
    items.map((m) => ({ ...m, connectionId }))
  )

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

