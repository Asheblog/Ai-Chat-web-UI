const mockState: { actor: any } = {
  actor: {
    type: 'user',
    id: 1,
    role: 'USER',
    status: 'ACTIVE',
    username: 'tester',
    identifier: 'user:1',
  },
}

jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', mockState.actor)
    await next()
  },
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import { createDocumentsApi } from '../documents'
import { ChatServiceError } from '../../services/chat'

const buildDocument = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  userId: 1,
  anonymousKey: null,
  filename: 'uuid-10.pdf',
  originalName: 'spec.pdf',
  mimeType: 'application/pdf',
  fileSize: 256,
  status: 'ready',
  chunkCount: 4,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

const uploadForm = (sessionId?: string) => {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'spec.pdf', { type: 'application/pdf' }))
  if (sessionId !== undefined) form.append('sessionId', sessionId)
  return form
}

describe('documents api access boundaries', () => {
  const buildApp = (
    options: {
      sessionDenied?: boolean
      documents?: Record<number, any>
      sessionDocuments?: any[]
    } = {}
  ) => {
    const chatService = {
      ensureSessionAccess: options.sessionDenied
        ? jest.fn().mockRejectedValue(new ChatServiceError('Chat session not found', 404))
        : jest.fn().mockResolvedValue({ id: 7 }),
    }

    const documentService = {
      uploadDocument: jest.fn().mockResolvedValue({
        documentId: 10,
        filename: 'uuid-10.pdf',
        originalName: 'spec.pdf',
        status: 'pending',
      }),
      attachToSession: jest.fn().mockResolvedValue(undefined),
      detachFromSession: jest.fn().mockResolvedValue(undefined),
      getDocument: jest.fn(async (id: number) => options.documents?.[id] ?? null),
      getSessionDocuments: jest.fn().mockResolvedValue(options.sessionDocuments ?? []),
      getSessionDocumentIds: jest.fn().mockResolvedValue([10]),
    }

    const ragService = {
      searchInSession: jest.fn().mockResolvedValue({ hits: [], context: '', totalHits: 0, queryTime: 1 }),
      searchInDocuments: jest.fn().mockResolvedValue({ hits: [], context: '', totalHits: 0, queryTime: 1 }),
    }

    const bridgeService = {
      syncDocumentToWorkspace: jest.fn().mockResolvedValue({ sessionId: 7, documentId: 10 }),
      listSessionBridges: jest
        .fn()
        .mockResolvedValue([{ sessionId: 7, documentId: 10, status: 'ready' }]),
      removeDocumentBridge: jest.fn().mockResolvedValue(undefined),
    }

    const app = createDocumentsApi({
      chatService: chatService as any,
      resolveServices: () => ({ documentService, ragService } as any),
      bridgeService: bridgeService as any,
    })

    return { app, chatService, documentService, ragService, bridgeService }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockState.actor = {
      type: 'user',
      id: 1,
      role: 'USER',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    }
  })

  describe('upload', () => {
    it('rejects uploading into a session owned by another actor before storing the file', async () => {
      const { app, chatService, documentService, bridgeService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/upload', {
        method: 'POST',
        body: uploadForm('7'),
      })

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ success: false, error: 'Chat session not found' })
      expect(chatService.ensureSessionAccess).toHaveBeenCalledWith(mockState.actor, 7)
      expect(documentService.uploadDocument).not.toHaveBeenCalled()
      expect(documentService.attachToSession).not.toHaveBeenCalled()
      expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
    })

    it('uploads and attaches when the actor owns the session', async () => {
      const { app, documentService, bridgeService } = buildApp()

      const res = await app.request('http://localhost/upload', {
        method: 'POST',
        body: uploadForm('7'),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.documentId).toBe(10)
      expect(documentService.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ originalName: 'spec.pdf', mimeType: 'application/pdf' }),
        1,
        undefined
      )
      expect(documentService.attachToSession).toHaveBeenCalledWith(10, 7)
      expect(bridgeService.syncDocumentToWorkspace).toHaveBeenCalledWith({
        sessionId: 7,
        documentId: 10,
      })
    })

    it('keeps session-less uploads working without a session lookup', async () => {
      const { app, chatService, documentService } = buildApp()

      const res = await app.request('http://localhost/upload', {
        method: 'POST',
        body: uploadForm(),
      })

      expect(res.status).toBe(200)
      expect(chatService.ensureSessionAccess).not.toHaveBeenCalled()
      expect(documentService.attachToSession).not.toHaveBeenCalled()
    })

    it('rejects a malformed session id instead of silently dropping the attach', async () => {
      const { app, documentService } = buildApp()

      const res = await app.request('http://localhost/upload', {
        method: 'POST',
        body: uploadForm('not-a-number'),
      })

      expect(res.status).toBe(400)
      expect(documentService.uploadDocument).not.toHaveBeenCalled()
    })
  })

  describe('session document listing', () => {
    it('rejects listing documents of a session owned by another actor', async () => {
      const { app, chatService, documentService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/session/7')

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ success: false, error: 'Chat session not found' })
      expect(chatService.ensureSessionAccess).toHaveBeenCalledWith(mockState.actor, 7)
      expect(documentService.getSessionDocuments).not.toHaveBeenCalled()
    })

    it('lists documents of an owned session', async () => {
      const { app, documentService } = buildApp({
        sessionDocuments: [buildDocument({ id: 10, userId: 1 })],
      })

      const res = await app.request('http://localhost/session/7')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(10)
      expect(documentService.getSessionDocuments).toHaveBeenCalledWith(7)
    })
  })

  describe('attach', () => {
    it('rejects attaching a document owned by another actor', async () => {
      const { app, documentService, bridgeService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: 2 }) },
      })

      const res = await app.request('http://localhost/10/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ success: false, error: 'Access denied' })
      expect(documentService.attachToSession).not.toHaveBeenCalled()
      expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
    })

    it('rejects attaching into a session owned by another actor', async () => {
      const { app, documentService, bridgeService } = buildApp({
        sessionDenied: true,
        documents: { 10: buildDocument({ id: 10, userId: 1 }) },
      })

      const res = await app.request('http://localhost/10/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(404)
      expect(documentService.attachToSession).not.toHaveBeenCalled()
      expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
    })

    it('attaches an owned document into an owned session', async () => {
      const { app, documentService, bridgeService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: 1 }) },
      })

      const res = await app.request('http://localhost/10/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(200)
      expect(documentService.attachToSession).toHaveBeenCalledWith(10, 7)
      expect(bridgeService.syncDocumentToWorkspace).toHaveBeenCalledWith({
        sessionId: 7,
        documentId: 10,
      })
    })
  })

  describe('detach', () => {
    it('rejects detaching from a session owned by another actor', async () => {
      const { app, documentService, bridgeService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/10/detach/7', { method: 'DELETE' })

      expect(res.status).toBe(404)
      expect(documentService.detachFromSession).not.toHaveBeenCalled()
      expect(bridgeService.removeDocumentBridge).not.toHaveBeenCalled()
    })

    it('lets the session owner detach without requiring document ownership', async () => {
      const { app, documentService, bridgeService } = buildApp()

      const res = await app.request('http://localhost/10/detach/7', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(documentService.getDocument).not.toHaveBeenCalled()
      expect(documentService.detachFromSession).toHaveBeenCalledWith(10, 7)
      expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
        sessionId: 7,
        documentId: 10,
      })
    })
  })

  describe('workspace bridge', () => {
    it('rejects manual bridge sync for a session owned by another actor', async () => {
      const { app, documentService, bridgeService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/10/bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(404)
      expect(documentService.getSessionDocumentIds).not.toHaveBeenCalled()
      expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
    })

    it('rejects bridge sync for a document owned by another actor', async () => {
      const { app, documentService, bridgeService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: 2 }) },
      })

      const res = await app.request('http://localhost/10/bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(403)
      expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
    })

    it('rejects listing bridges of a session owned by another actor', async () => {
      const { app, bridgeService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/session/7/bridges')

      expect(res.status).toBe(404)
      expect(bridgeService.listSessionBridges).not.toHaveBeenCalled()
    })

    it('rejects removing a bridge of a session owned by another actor', async () => {
      const { app, bridgeService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/10/bridge/7', { method: 'DELETE' })

      expect(res.status).toBe(404)
      expect(bridgeService.removeDocumentBridge).not.toHaveBeenCalled()
    })
  })

  describe('search', () => {
    it('rejects session scoped search for a session owned by another actor', async () => {
      const { app, ragService } = buildApp({ sessionDenied: true })

      const res = await app.request('http://localhost/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'quarterly budget', sessionId: 7 }),
      })

      expect(res.status).toBe(404)
      expect(ragService.searchInSession).not.toHaveBeenCalled()
      expect(ragService.searchInDocuments).not.toHaveBeenCalled()
    })

    it('rejects searching document ids owned by another actor', async () => {
      const { app, ragService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: 2 }) },
      })

      const res = await app.request('http://localhost/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'quarterly budget', documentIds: [10] }),
      })

      expect(res.status).toBe(403)
      expect(ragService.searchInDocuments).not.toHaveBeenCalled()
    })

    it('rejects searching a document id that does not exist', async () => {
      const { app, ragService } = buildApp({ documents: {} })

      const res = await app.request('http://localhost/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'quarterly budget', documentIds: [99] }),
      })

      expect(res.status).toBe(404)
      expect(ragService.searchInDocuments).not.toHaveBeenCalled()
    })

    it('searches documents owned by the actor', async () => {
      const { app, ragService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: 1 }) },
      })

      const res = await app.request('http://localhost/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'quarterly budget', documentIds: [10] }),
      })

      expect(res.status).toBe(200)
      expect(ragService.searchInDocuments).toHaveBeenCalledWith([10], 'quarterly budget')
    })
  })

  describe('anonymous actor', () => {
    beforeEach(() => {
      mockState.actor = {
        type: 'anonymous',
        key: 'anon-1',
        identifier: 'anon:anon-1',
        expiresAt: null,
      }
    })

    it('keeps the existing session contract for anonymous actors and their own documents', async () => {
      const { app, chatService, documentService } = buildApp({
        documents: {
          10: buildDocument({ id: 10, userId: null, anonymousKey: 'anon-1' }),
        },
        sessionDocuments: [buildDocument({ id: 10, userId: null, anonymousKey: 'anon-1' })],
      })

      const listRes = await app.request('http://localhost/session/7')
      expect(listRes.status).toBe(200)
      expect(chatService.ensureSessionAccess).toHaveBeenCalledWith(mockState.actor, 7)

      const attachRes = await app.request('http://localhost/10/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })
      expect(attachRes.status).toBe(200)
      expect(documentService.attachToSession).toHaveBeenCalledWith(10, 7)
    })

    it('denies documents owned by a different anonymous actor', async () => {
      const { app, documentService } = buildApp({
        documents: { 10: buildDocument({ id: 10, userId: null, anonymousKey: 'anon-2' }) },
      })

      const res = await app.request('http://localhost/10/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 7 }),
      })

      expect(res.status).toBe(403)
      expect(documentService.attachToSession).not.toHaveBeenCalled()
    })
  })
})
