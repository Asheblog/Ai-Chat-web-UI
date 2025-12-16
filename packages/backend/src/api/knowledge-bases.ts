/**
 * 知识库 API 路由
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { actorMiddleware, adminOnlyMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { KnowledgeBaseService } from '../services/knowledge-base'
import { getDocumentServices } from '../services/document-services-factory'

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

const addDocumentSchema = z.object({
  documentId: z.number().int().positive(),
})

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  knowledgeBaseIds: z.array(z.number().int().positive()).min(1),
})

export const createKnowledgeBasesApi = (prisma: PrismaClient) => {
  const router = new Hono()
  const kbService = new KnowledgeBaseService(prisma)

  /**
   * 获取知识库列表（管理员视图）
   * 会自动刷新所有知识库的统计信息
   */
  router.get('/admin', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      // 先刷新所有知识库的统计信息
      const allKbs = await kbService.list({ adminView: true })
      for (const kb of allKbs) {
        await kbService.updateStats(kb.id)
      }
      // 重新获取列表以获得最新统计
      const knowledgeBases = await kbService.list({ adminView: true })
      return c.json<ApiResponse>({
        success: true,
        data: knowledgeBases,
      })
    } catch (error) {
      console.error('[KnowledgeBase] List admin error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to list knowledge bases' }, 500)
    }
  })

  /**
   * 获取用户可用的知识库列表
   */
  router.get('/', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const userId = actor.type === 'user' ? actor.id : null

      const knowledgeBases = await kbService.list({
        ownerId: userId,
        includePublic: true,
      })

      return c.json<ApiResponse>({
        success: true,
        data: knowledgeBases,
      })
    } catch (error) {
      console.error('[KnowledgeBase] List error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to list knowledge bases' }, 500)
    }
  })

  /**
   * 创建知识库（管理员）
   */
  router.post('/', actorMiddleware, adminOnlyMiddleware, zValidator('json', createSchema), async (c) => {
    try {
      const { name, description, isPublic } = c.req.valid('json')

      const kb = await kbService.create({
        name,
        description,
        ownerId: null, // 系统级知识库
        isPublic: isPublic ?? true,
      })

      return c.json<ApiResponse>({
        success: true,
        data: kb,
      })
    } catch (error) {
      console.error('[KnowledgeBase] Create error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to create knowledge base' }, 500)
    }
  })

  /**
   * 获取知识库详情
   */
  router.get('/:id', actorMiddleware, async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      if (isNaN(id)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid ID' }, 400)
      }

      const actor = c.get('actor') as Actor
      const userId = actor.type === 'user' ? actor.id : null
      const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'

      const canAccess = await kbService.canAccess(id, userId, isAdmin)
      if (!canAccess) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }

      const kb = await kbService.get(id)
      if (!kb) {
        return c.json<ApiResponse>({ success: false, error: 'Not found' }, 404)
      }

      return c.json<ApiResponse>({
        success: true,
        data: {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          ownerId: kb.ownerId,
          isPublic: kb.isPublic,
          status: kb.status,
          documentCount: kb.documentCount,
          totalChunks: kb.totalChunks,
          createdAt: kb.createdAt,
          updatedAt: kb.updatedAt,
          documents: kb.documents.map((d) => ({
            id: d.document.id,
            originalName: d.document.originalName,
            mimeType: d.document.mimeType,
            fileSize: d.document.fileSize,
            status: d.document.status,
            chunkCount: d.document.chunkCount,
            addedAt: d.addedAt,
          })),
        },
      })
    } catch (error) {
      console.error('[KnowledgeBase] Get error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to get knowledge base' }, 500)
    }
  })

  /**
   * 更新知识库
   */
  router.patch('/:id', actorMiddleware, adminOnlyMiddleware, zValidator('json', updateSchema), async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      if (isNaN(id)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid ID' }, 400)
      }

      const input = c.req.valid('json')
      const kb = await kbService.update(id, input)

      return c.json<ApiResponse>({
        success: true,
        data: kb,
      })
    } catch (error) {
      console.error('[KnowledgeBase] Update error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to update knowledge base' }, 500)
    }
  })

  /**
   * 删除知识库
   */
  router.delete('/:id', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      if (isNaN(id)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid ID' }, 400)
      }

      await kbService.delete(id)

      return c.json<ApiResponse>({
        success: true,
        data: { deleted: true },
      })
    } catch (error) {
      console.error('[KnowledgeBase] Delete error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete knowledge base' }, 500)
    }
  })

  /**
   * 刷新知识库统计信息（手动触发）
   */
  router.post('/:id/refresh-stats', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      if (isNaN(id)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid ID' }, 400)
      }

      await kbService.updateStats(id)
      const kb = await kbService.get(id)

      return c.json<ApiResponse>({
        success: true,
        data: {
          id: kb?.id,
          documentCount: kb?.documentCount,
          totalChunks: kb?.totalChunks,
        },
        message: 'Stats refreshed successfully',
      })
    } catch (error) {
      console.error('[KnowledgeBase] Refresh stats error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to refresh stats' }, 500)
    }
  })

  /**
   * 上传文档到知识库
   */
  router.post('/:id/documents/upload', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      const kbId = parseInt(c.req.param('id'), 10)
      if (isNaN(kbId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid knowledge base ID' }, 400)
      }

      const services = getDocumentServices()
      if (!services) {
        return c.json<ApiResponse>({ success: false, error: 'RAG services not enabled' }, 503)
      }

      const actor = c.get('actor') as Actor
      const formData = await c.req.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return c.json<ApiResponse>({ success: false, error: 'No file provided' }, 400)
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      // 上传文档（属于系统，不关联用户）
      const result = await services.documentService.uploadDocument(
        {
          buffer,
          originalName: file.name,
          mimeType: file.type,
        },
        actor.type === 'user' ? actor.id : undefined,
        undefined
      )

      // 添加到知识库
      await kbService.addDocument(kbId, result.documentId)

      return c.json<ApiResponse>({
        success: true,
        data: {
          documentId: result.documentId,
          status: result.status,
        },
      })
    } catch (error) {
      console.error('[KnowledgeBase] Upload document error:', error)
      const message = error instanceof Error ? error.message : 'Upload failed'
      return c.json<ApiResponse>({ success: false, error: message }, 400)
    }
  })

  /**
   * 添加已有文档到知识库
   */
  router.post('/:id/documents', actorMiddleware, adminOnlyMiddleware, zValidator('json', addDocumentSchema), async (c) => {
    try {
      const kbId = parseInt(c.req.param('id'), 10)
      if (isNaN(kbId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid knowledge base ID' }, 400)
      }

      const { documentId } = c.req.valid('json')
      await kbService.addDocument(kbId, documentId)

      return c.json<ApiResponse>({
        success: true,
        data: { added: true },
      })
    } catch (error) {
      console.error('[KnowledgeBase] Add document error:', error)
      const message = error instanceof Error ? error.message : 'Failed to add document'
      return c.json<ApiResponse>({ success: false, error: message }, 400)
    }
  })

  /**
   * 从知识库移除文档
   */
  router.delete('/:id/documents/:docId', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      const kbId = parseInt(c.req.param('id'), 10)
      const docId = parseInt(c.req.param('docId'), 10)

      if (isNaN(kbId) || isNaN(docId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid IDs' }, 400)
      }

      await kbService.removeDocument(kbId, docId)

      return c.json<ApiResponse>({
        success: true,
        data: { removed: true },
      })
    } catch (error) {
      console.error('[KnowledgeBase] Remove document error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to remove document' }, 500)
    }
  })

  /**
   * 在知识库中检索
   */
  router.post('/search', actorMiddleware, zValidator('json', searchSchema), async (c) => {
    try {
      const { query, knowledgeBaseIds } = c.req.valid('json')
      const actor = c.get('actor') as Actor
      const userId = actor.type === 'user' ? actor.id : null
      const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'

      // 验证访问权限
      for (const kbId of knowledgeBaseIds) {
        const canAccess = await kbService.canAccess(kbId, userId, isAdmin)
        if (!canAccess) {
          return c.json<ApiResponse>({ success: false, error: `Access denied to knowledge base ${kbId}` }, 403)
        }
      }

      const result = await kbService.search(knowledgeBaseIds, query)

      return c.json<ApiResponse>({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('[KnowledgeBase] Search error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Search failed' }, 500)
    }
  })

  return router
}
