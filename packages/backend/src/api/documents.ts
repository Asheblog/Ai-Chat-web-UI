/**
 * 文档 API 路由
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { getSupportedMimeTypes } from '../modules/document/loaders'
import { getDocumentServices } from '../services/document-services-factory'

const uploadSchema = z.object({
  sessionId: z.number().int().positive().optional(),
})

const attachSchema = z.object({
  sessionId: z.number().int().positive(),
})

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  sessionId: z.number().int().positive().optional(),
  documentIds: z.array(z.number().int().positive()).optional(),
})

/**
 * 获取文档服务，如果不可用返回 null
 */
const getServices = () => {
  const services = getDocumentServices()
  if (!services) return null
  return {
    documentService: services.documentService,
    ragService: services.ragService,
  }
}

/**
 * 检查 RAG 服务是否可用的中间件
 */
const requireRAGEnabled = async (c: any, next: () => Promise<void>) => {
  const services = getServices()
  if (!services) {
    return c.json<ApiResponse>(
      { success: false, error: 'RAG document services are not enabled. Please enable RAG in system settings.' },
      503
    )
  }
  c.set('docServices', services)
  await next()
}

export const createDocumentsApi = () => {
  const router = new Hono()

  /**
   * 获取支持的文件类型
   */
  router.get('/supported-types', (c) => {
    return c.json<ApiResponse>({
      success: true,
      data: getSupportedMimeTypes(),
    })
  })

  /**
   * 上传文档
   */
  router.post('/upload', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>

      const formData = await c.req.formData()
      const file = formData.get('file') as File | null
      const sessionIdStr = formData.get('sessionId') as string | null

      if (!file) {
        return c.json<ApiResponse>({ success: false, error: 'No file provided' }, 400)
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      const result = await documentService!.uploadDocument(
        {
          buffer,
          originalName: file.name,
          mimeType: file.type,
        },
        actor.type === 'user' ? actor.id : undefined,
        actor.type === 'anonymous' ? actor.key : undefined
      )

      // 如果指定了 sessionId，自动附加到会话
      if (sessionIdStr) {
        const sessionId = parseInt(sessionIdStr, 10)
        if (!isNaN(sessionId)) {
          await documentService!.attachToSession(result.documentId, sessionId)
        }
      }

      return c.json<ApiResponse>({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('[Documents] Upload error:', error)
      const message = error instanceof Error ? error.message : 'Upload failed'
      return c.json<ApiResponse>({ success: false, error: message }, 400)
    }
  })

  /**
   * 获取文档列表
   */
  router.get('/', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>

      const documents =
        actor.type === 'user'
          ? await documentService!.getUserDocuments(actor.id)
          : await documentService!.getAnonymousDocuments(actor.key)

      return c.json<ApiResponse>({
        success: true,
        data: documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
          status: doc.status,
          errorMessage: doc.errorMessage,
          chunkCount: doc.chunkCount,
          createdAt: doc.createdAt,
        })),
      })
    } catch (error) {
      console.error('[Documents] List error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to list documents' }, 500)
    }
  })

  /**
   * 获取文档详情
   */
  router.get('/:id', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id'), 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>
      const document = await documentService!.getDocument(documentId)
      if (!document) {
        return c.json<ApiResponse>({ success: false, error: 'Document not found' }, 404)
      }

      // 验证权限
      const actor = c.get('actor') as Actor
      if (actor.type === 'user' && document.userId !== actor.id) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }
      if (actor.type === 'anonymous' && document.anonymousKey !== actor.key) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }

      return c.json<ApiResponse>({
        success: true,
        data: {
          id: document.id,
          filename: document.filename,
          originalName: document.originalName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          status: document.status,
          errorMessage: document.errorMessage,
          chunkCount: document.chunkCount,
          metadata: document.metadata,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      })
    } catch (error) {
      console.error('[Documents] Get error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to get document' }, 500)
    }
  })

  /**
   * 删除文档
   */
  router.delete('/:id', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id'), 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>
      const document = await documentService!.getDocument(documentId)
      if (!document) {
        return c.json<ApiResponse>({ success: false, error: 'Document not found' }, 404)
      }

      // 验证权限
      const actor = c.get('actor') as Actor
      if (actor.type === 'user' && document.userId !== actor.id) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }
      if (actor.type === 'anonymous' && document.anonymousKey !== actor.key) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }

      await documentService!.deleteDocument(documentId)

      return c.json<ApiResponse>({ success: true, data: { deleted: true } })
    } catch (error) {
      console.error('[Documents] Delete error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete document' }, 500)
    }
  })

  /**
   * 将文档附加到会话
   */
  router.post('/:id/attach', actorMiddleware, requireRAGEnabled, zValidator('json', attachSchema), async (c) => {
    try {
      const documentId = parseInt(c.req.param('id'), 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { sessionId } = c.req.valid('json')
      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>

      await documentService!.attachToSession(documentId, sessionId)

      return c.json<ApiResponse>({ success: true, data: { attached: true } })
    } catch (error) {
      console.error('[Documents] Attach error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to attach document' }, 500)
    }
  })

  /**
   * 从会话移除文档
   */
  router.delete('/:id/detach/:sessionId', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id'), 10)
      const sessionId = parseInt(c.req.param('sessionId'), 10)

      if (isNaN(documentId) || isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid IDs' }, 400)
      }

      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>
      await documentService!.detachFromSession(documentId, sessionId)

      return c.json<ApiResponse>({ success: true, data: { detached: true } })
    } catch (error) {
      console.error('[Documents] Detach error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to detach document' }, 500)
    }
  })

  /**
   * 获取会话的文档列表
   */
  router.get('/session/:sessionId', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('sessionId'), 10)
      if (isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      const { documentService } = c.get('docServices') as ReturnType<typeof getServices>
      const documents = await documentService!.getSessionDocuments(sessionId)

      return c.json<ApiResponse>({
        success: true,
        data: documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
          status: doc.status,
          chunkCount: doc.chunkCount,
        })),
      })
    } catch (error) {
      console.error('[Documents] Session documents error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to get session documents' }, 500)
    }
  })

  /**
   * RAG 搜索
   */
  router.post('/search', actorMiddleware, requireRAGEnabled, zValidator('json', searchSchema), async (c) => {
    try {
      const { query, sessionId, documentIds } = c.req.valid('json')
      const { ragService } = c.get('docServices') as ReturnType<typeof getServices>

      let result
      if (sessionId) {
        result = await ragService!.searchInSession(sessionId, query)
      } else if (documentIds && documentIds.length > 0) {
        result = await ragService!.searchInDocuments(documentIds, query)
      } else {
        return c.json<ApiResponse>(
          { success: false, error: 'Either sessionId or documentIds is required' },
          400
        )
      }

      return c.json<ApiResponse>({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('[Documents] Search error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Search failed' }, 500)
    }
  })

  return router
}
