/**
 * 文档 API 路由
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware, adminOnlyMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { getSupportedMimeTypes } from '../modules/document/loaders'
import type { DocumentService } from '../services/document/document-service'
import type { RAGService } from '../services/document/rag-service'
import { ChatServiceError, type ChatService } from '../services/chat'
import {
  documentWorkspaceBridgeService as defaultDocumentWorkspaceBridgeService,
  type DocumentWorkspaceBridgeService,
} from '../services/document/document-workspace-bridge-service'

const uploadSchema = z.object({
  sessionId: z.number().int().positive().optional(),
})

const attachSchema = z.object({
  sessionId: z.number().int().positive(),
})

const bridgeSyncSchema = z.object({
  sessionId: z.number().int().positive(),
  force: z.boolean().optional(),
})

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  sessionId: z.number().int().positive().optional(),
  documentIds: z.array(z.number().int().positive()).optional(),
})

export interface DocumentsApiServices {
  documentService: DocumentService
  ragService: RAGService
}

export interface DocumentsApiDeps {
  resolveServices: () => DocumentsApiServices | null
  bridgeService?: DocumentWorkspaceBridgeService
  /**
   * 聊天会话所有权校验。复用 ChatService.ensureSessionAccess，
   * 使会话文档的可见性边界与聊天会话合约保持一致。
   */
  chatService: Pick<ChatService, 'ensureSessionAccess'>
}

/**
 * 检查 RAG 服务是否可用的中间件
 */
const createRequireRAGEnabled = (deps: DocumentsApiDeps) => async (c: any, next: () => Promise<void>) => {
  const services = deps.resolveServices()
  if (!services) {
    return c.json(
      { success: false, error: 'RAG document services are not enabled. Please enable RAG in system settings.' },
      503
    )
  }
  c.set('docServices', services)
  await next()
}

export const createDocumentsApi = (deps: DocumentsApiDeps) => {
  const router = new Hono()
  const requireRAGEnabled = createRequireRAGEnabled(deps)
  const bridgeService = deps.bridgeService ?? defaultDocumentWorkspaceBridgeService
  const chatService = deps.chatService

  /**
   * 文档归属判定：与文档详情/删除路由现有的权限语义保持一致。
   */
  const actorOwnsDocument = (
    actor: Actor,
    document: { userId: number | null; anonymousKey: string | null }
  ): boolean =>
    actor.type === 'user' ? document.userId === actor.id : document.anonymousKey === actor.key

  /**
   * 会话所有权校验：通过返回 null；拒绝时直接生成响应，
   * 服务层抛出的 ChatServiceError（如会话不存在 404）按原状态码透传给调用方。
   */
  const ensureSessionAccess = async (
    c: Context,
    actor: Actor,
    sessionId: number
  ): Promise<Response | null> => {
    try {
      await chatService.ensureSessionAccess(actor, sessionId)
      return null
    } catch (error) {
      if (error instanceof ChatServiceError) {
        return c.json<ApiResponse>(
          { success: false, error: error.message },
          error.statusCode as any
        )
      }
      throw error
    }
  }

  /**
   * 文档所有权校验：不存在=404、非本人=403，与 GET/DELETE /:id 一致。
   */
  const requireOwnedDocument = async (c: Context, actor: Actor, documentId: number) => {
    const { documentService } = c.get('docServices') as NonNullable<
      ReturnType<DocumentsApiDeps['resolveServices']>
    >
    const document = await documentService.getDocument(documentId)
    if (!document) {
      return { denied: c.json<ApiResponse>({ success: false, error: 'Document not found' }, 404) }
    }
    if (!actorOwnsDocument(actor, document)) {
      return { denied: c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403) }
    }
    return { document }
  }

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
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      const formData = await c.req.formData()
      const file = formData.get('file') as File | null
      // 只接受文本部件；若伪造为文件部件，按未指定会话处理
      const rawSessionId = formData.get('sessionId')
      const sessionIdStr = typeof rawSessionId === 'string' ? rawSessionId : null

      if (!file) {
        return c.json<ApiResponse>({ success: false, error: 'No file provided' }, 400)
      }

      // 会话归属必须在落盘前确认，否则会把文档注入他人的会话上下文
      let sessionId: number | null = null
      if (sessionIdStr !== null && sessionIdStr.trim() !== '') {
        const parsedSessionId = Number.parseInt(sessionIdStr, 10)
        if (!Number.isFinite(parsedSessionId) || parsedSessionId <= 0) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
        }
        sessionId = parsedSessionId
        const denied = await ensureSessionAccess(c, actor, sessionId)
        if (denied) return denied
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
      if (sessionId !== null) {
        await documentService!.attachToSession(result.documentId, sessionId)
        try {
          await bridgeService.syncDocumentToWorkspace({
            sessionId,
            documentId: result.documentId,
          })
        } catch (bridgeError) {
          console.warn('[Documents] Upload bridge sync warning:', {
            sessionId,
            documentId: result.documentId,
            error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
          })
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
   * 获取文档列表（当前用户）
   */
  router.get('/', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      const documents =
        actor.type === 'user'
          ? await documentService!.getUserDocuments(actor.id)
          : await documentService!.getAnonymousDocuments(actor.key)

      return c.json<ApiResponse>({
        success: true,
        data: documents.map((doc: any) => ({
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
   * 获取所有文档列表（管理员）
   */
  router.get('/admin/all', actorMiddleware, adminOnlyMiddleware, requireRAGEnabled, async (c) => {
    try {
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>
      const documents = await documentService!.getAllDocuments()

      return c.json<ApiResponse>({
        success: true,
        data: documents.map((doc: any) => ({
          id: doc.id,
          filename: doc.filename,
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
          status: doc.status,
          errorMessage: doc.errorMessage,
          chunkCount: doc.chunkCount,
          createdAt: doc.createdAt,
          userId: doc.userId,
        })),
      })
    } catch (error) {
      console.error('[Documents] Admin list all error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to list all documents' }, 500)
    }
  })

  /**
   * 获取文档详情
   */
  router.get('/:id', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>
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
          processingStage: (document as any).processingStage,
          processingProgress: (document as any).processingProgress,
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
   * 取消文档处理
   */
  router.post('/:id/cancel', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>
      const document = await documentService!.getDocument(documentId)
      if (!document) {
        return c.json<ApiResponse>({ success: false, error: 'Document not found' }, 404)
      }

      const actor = c.get('actor') as Actor
      if (actor.type === 'user' && document.userId !== actor.id) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }
      if (actor.type === 'anonymous' && document.anonymousKey !== actor.key) {
        return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
      }

      await documentService!.cancelProcessing(documentId)

      return c.json<ApiResponse>({ success: true, data: { canceled: true } })
    } catch (error) {
      console.error('[Documents] Cancel error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to cancel document' }, 500)
    }
  })

  /**
   * 删除文档
   */
  router.delete('/:id', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>
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
   * 批量删除文档
   */
  router.post('/batch-delete', actorMiddleware, requireRAGEnabled, zValidator('json', z.object({
    documentIds: z.array(z.number().int().positive()).min(1).max(100),
  })), async (c) => {
    try {
      const { documentIds } = c.req.valid('json')
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      // 验证所有文档的权限
      const documents = await Promise.all(
        documentIds.map((id) => documentService!.getDocument(id))
      )

      const validIds: number[] = []
      for (let i = 0; i < documents.length; i++) {
        const document = documents[i]
        if (!document) continue

        // 检查权限
        if (actor.type === 'user' && document.userId !== actor.id) continue
        if (actor.type === 'anonymous' && document.anonymousKey !== actor.key) continue

        validIds.push(documentIds[i])
      }

      if (validIds.length === 0) {
        return c.json<ApiResponse>({ success: false, error: 'No valid documents to delete' }, 400)
      }

      const result = await documentService!.deleteDocuments(validIds)

      return c.json<ApiResponse>({
        success: true,
        data: {
          deleted: result.deleted,
          failed: result.failed,
          requested: documentIds.length,
        },
      })
    } catch (error) {
      console.error('[Documents] Batch delete error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to batch delete documents' }, 500)
    }
  })

  /**
   * 将文档附加到会话
   */
  router.post('/:id/attach', actorMiddleware, requireRAGEnabled, zValidator('json', attachSchema), async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { sessionId } = c.req.valid('json')
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      const ownership = await requireOwnedDocument(c, actor, documentId)
      if ('denied' in ownership) return ownership.denied

      await documentService!.attachToSession(documentId, sessionId)
      let bridgeSynced = true
      try {
        await bridgeService.syncDocumentToWorkspace({
          sessionId,
          documentId,
        })
      } catch (bridgeError) {
        bridgeSynced = false
        console.warn('[Documents] Attach bridge sync warning:', {
          sessionId,
          documentId,
          error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
        })
      }

      return c.json<ApiResponse>({ success: true, data: { attached: true, bridgeSynced } })
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
      const documentId = parseInt(c.req.param('id')!, 10)
      const sessionId = parseInt(c.req.param('sessionId')!, 10)

      if (isNaN(documentId) || isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid IDs' }, 400)
      }

      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      // 会话所有者可移除任何挂在自己会话上的文档（含历史误挂），无需文档归属
      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      await documentService!.detachFromSession(documentId, sessionId)
      try {
        await bridgeService.removeDocumentBridge({ sessionId, documentId })
      } catch (bridgeError) {
        console.warn('[Documents] Detach bridge cleanup warning:', {
          sessionId,
          documentId,
          error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
        })
      }

      return c.json<ApiResponse>({ success: true, data: { detached: true } })
    } catch (error) {
      console.error('[Documents] Detach error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to detach document' }, 500)
    }
  })

  /**
   * 手动触发文档桥接到 workspace
   */
  router.post('/:id/bridge', actorMiddleware, requireRAGEnabled, zValidator('json', bridgeSyncSchema), async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      if (isNaN(documentId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid document ID' }, 400)
      }

      const { sessionId, force } = c.req.valid('json')
      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      // 桥接会把文档内容写入会话 workspace，必须同时确认文档归属
      const ownership = await requireOwnedDocument(c, actor, documentId)
      if ('denied' in ownership) return ownership.denied

      const sessionDocIds = await documentService.getSessionDocumentIds(sessionId)
      if (!sessionDocIds.includes(documentId)) {
        return c.json<ApiResponse>(
          { success: false, error: `Document ${documentId} is not attached to session ${sessionId}` },
          400,
        )
      }

      const bridge = await bridgeService.syncDocumentToWorkspace({
        sessionId,
        documentId,
        force,
      })

      return c.json<ApiResponse>({
        success: true,
        data: bridge,
      })
    } catch (error) {
      console.error('[Documents] Bridge sync error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to sync bridge' }, 500)
    }
  })

  /**
   * 获取会话桥接状态列表
   */
  router.get('/session/:sessionId/bridges', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('sessionId')!, 10)
      if (isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      const actor = c.get('actor') as Actor
      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      const bridges = await bridgeService.listSessionBridges(sessionId)
      return c.json<ApiResponse>({
        success: true,
        data: bridges,
      })
    } catch (error) {
      console.error('[Documents] List bridges error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to list bridges' }, 500)
    }
  })

  /**
   * 仅删除文档 bridge（不影响会话附加关系）
   */
  router.delete('/:id/bridge/:sessionId', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const documentId = parseInt(c.req.param('id')!, 10)
      const sessionId = parseInt(c.req.param('sessionId')!, 10)
      if (isNaN(documentId) || isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid IDs' }, 400)
      }

      const actor = c.get('actor') as Actor
      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      await bridgeService.removeDocumentBridge({ sessionId, documentId })
      return c.json<ApiResponse>({ success: true, data: { removed: true } })
    } catch (error) {
      console.error('[Documents] Remove bridge error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to remove bridge' }, 500)
    }
  })

  /**
   * 获取会话的文档列表
   */
  router.get('/session/:sessionId', actorMiddleware, requireRAGEnabled, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('sessionId')!, 10)
      if (isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      const actor = c.get('actor') as Actor
      const { documentService } = c.get('docServices') as NonNullable<ReturnType<DocumentsApiDeps['resolveServices']>>

      const denied = await ensureSessionAccess(c, actor, sessionId)
      if (denied) return denied

      const documents = await documentService!.getSessionDocuments(sessionId)

      return c.json<ApiResponse>({
        success: true,
        data: documents.map((doc: any) => ({
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
      const actor = c.get('actor') as Actor
      const { documentService, ragService } = c.get('docServices') as NonNullable<
        ReturnType<DocumentsApiDeps['resolveServices']>
      >

      let result
      if (sessionId) {
        const denied = await ensureSessionAccess(c, actor, sessionId)
        if (denied) return denied

        result = await ragService!.searchInSession(sessionId, query)
      } else if (documentIds && documentIds.length > 0) {
        // 检索结果会返回文档正文片段，必须逐篇确认归属
        const documents = await Promise.all(
          documentIds.map((id) => documentService!.getDocument(id))
        )
        for (let i = 0; i < documents.length; i++) {
          const document = documents[i]
          if (!document) {
            return c.json<ApiResponse>(
              { success: false, error: `Document ${documentIds[i]} not found` },
              404
            )
          }
          if (!actorOwnsDocument(actor, document)) {
            return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403)
          }
        }

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
