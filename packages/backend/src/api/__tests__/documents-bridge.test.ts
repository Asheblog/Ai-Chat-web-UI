jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'USER',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    await next()
  },
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import { createDocumentsApi } from '../documents'

describe('documents api bridge routes', () => {
  const buildApp = (options?: {
    sessionDocIds?: number[]
    bridgeSyncThrows?: boolean
  }) => {
    const documentService = {
      attachToSession: jest.fn().mockResolvedValue(undefined),
      detachFromSession: jest.fn().mockResolvedValue(undefined),
      getSessionDocumentIds: jest
        .fn()
        .mockResolvedValue(options?.sessionDocIds ?? [10]),
    }

    const bridgeService = {
      syncDocumentToWorkspace: options?.bridgeSyncThrows
        ? jest.fn().mockRejectedValue(new Error('sync failed'))
        : jest.fn().mockResolvedValue({
            sessionId: 7,
            documentId: 10,
            documentName: 'spec.pdf',
            documentStatus: 'ready',
            status: 'ready',
            rootRelativePath: 'input/documents/10',
            syncedAt: new Date().toISOString(),
            original: {
              exists: true,
              relativePath: 'input/documents/10/original/spec.pdf',
              fileName: 'spec.pdf',
              mimeType: 'application/pdf',
            },
            normalized: {
              exists: true,
              relativePath: 'input/documents/10/normalized',
              contentPath: 'input/documents/10/normalized/content.md',
              pagesPath: 'input/documents/10/normalized/pages.jsonl',
              tocPath: 'input/documents/10/normalized/toc.json',
              metadataPath: 'input/documents/10/normalized/metadata.json',
              chunkCount: 20,
              pageCount: 8,
            },
          }),
      listSessionBridges: jest.fn().mockResolvedValue([
        {
          sessionId: 7,
          documentId: 10,
          status: 'ready',
        },
      ]),
      removeDocumentBridge: jest.fn().mockResolvedValue(undefined),
    }

    const app = createDocumentsApi({
      resolveServices: () =>
        ({
          documentService,
          ragService: {} as any,
        }) as any,
      bridgeService: bridgeService as any,
    })

    return { app, documentService, bridgeService }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('attach route triggers bridge sync and returns bridgeSynced=true', async () => {
    const { app, documentService, bridgeService } = buildApp()
    const res = await app.request('http://localhost/10/attach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 7 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.bridgeSynced).toBe(true)
    expect(documentService.attachToSession).toHaveBeenCalledWith(10, 7)
    expect(bridgeService.syncDocumentToWorkspace).toHaveBeenCalledWith({
      sessionId: 7,
      documentId: 10,
    })
  })

  it('attach route still succeeds when bridge sync fails', async () => {
    const { app, bridgeService } = buildApp({ bridgeSyncThrows: true })
    const res = await app.request('http://localhost/10/attach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 7 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.bridgeSynced).toBe(false)
    expect(bridgeService.syncDocumentToWorkspace).toHaveBeenCalledTimes(1)
  })

  it('supports manual bridge/list/remove routes', async () => {
    const { app, documentService, bridgeService } = buildApp({ sessionDocIds: [10] })

    const syncRes = await app.request('http://localhost/10/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 7, force: true }),
    })
    expect(syncRes.status).toBe(200)
    const syncBody = await syncRes.json()
    expect(syncBody.success).toBe(true)
    expect(documentService.getSessionDocumentIds).toHaveBeenCalledWith(7)
    expect(bridgeService.syncDocumentToWorkspace).toHaveBeenCalledWith({
      sessionId: 7,
      documentId: 10,
      force: true,
    })

    const listRes = await app.request('http://localhost/session/7/bridges')
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.success).toBe(true)
    expect(bridgeService.listSessionBridges).toHaveBeenCalledWith(7)

    const removeRes = await app.request('http://localhost/10/bridge/7', {
      method: 'DELETE',
    })
    expect(removeRes.status).toBe(200)
    const removeBody = await removeRes.json()
    expect(removeBody.success).toBe(true)
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 7,
      documentId: 10,
    })
  })

  it('detach route removes bridge directory in best-effort mode', async () => {
    const { app, documentService, bridgeService } = buildApp()
    const res = await app.request('http://localhost/10/detach/7', {
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(documentService.detachFromSession).toHaveBeenCalledWith(10, 7)
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 7,
      documentId: 10,
    })
  })

  it('rejects manual bridge when document is not attached to session', async () => {
    const { app, bridgeService } = buildApp({ sessionDocIds: [] })
    const res = await app.request('http://localhost/10/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 7 }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(bridgeService.syncDocumentToWorkspace).not.toHaveBeenCalled()
  })
})
