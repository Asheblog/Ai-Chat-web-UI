import { DocumentService } from './document-service'

describe('DocumentService bridge cleanup on delete', () => {
  const buildService = () => {
    const prisma = {
      document: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      documentProcessingJob: {
        updateMany: jest.fn(),
      },
      sessionDocument: {
        findMany: jest.fn(),
      },
    }

    const vectorDB = {
      deleteCollection: jest.fn(),
      vacuum: jest.fn(),
    }

    const bridgeService = {
      removeDocumentBridge: jest.fn().mockResolvedValue(undefined),
    }

    const service = new DocumentService(
      prisma as any,
      vectorDB as any,
      {} as any,
      {
        storageDir: '/tmp',
        maxFileSize: 10 * 1024 * 1024,
        chunkSize: 1000,
        chunkOverlap: 100,
        retentionDays: null,
      },
      bridgeService as any,
    )

    return { service, prisma, vectorDB, bridgeService }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('deleteDocument removes bridge directories of all attached sessions', async () => {
    const { service, prisma, bridgeService } = buildService()
    prisma.document.findUnique.mockResolvedValue({
      id: 10,
      filePath: '/path/not-exist.pdf',
      collectionName: 'doc_10',
    })
    prisma.sessionDocument.findMany.mockResolvedValue([
      { documentId: 10, sessionId: 1 },
      { documentId: 10, sessionId: 1 },
      { documentId: 10, sessionId: 2 },
    ])
    prisma.document.delete.mockResolvedValue({ id: 10 })

    await service.deleteDocument(10)

    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledTimes(2)
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 1,
      documentId: 10,
    })
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 2,
      documentId: 10,
    })
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: 10 },
    })
  })

  it('deleteDocuments removes bridge directories for unique document-session pairs', async () => {
    const { service, prisma, bridgeService, vectorDB } = buildService()
    prisma.document.findMany.mockResolvedValue([
      { id: 10, filePath: '/path/not-exist-10.pdf', collectionName: 'doc_10' },
      { id: 11, filePath: '/path/not-exist-11.pdf', collectionName: 'doc_11' },
    ])
    prisma.sessionDocument.findMany.mockResolvedValue([
      { documentId: 10, sessionId: 1 },
      { documentId: 10, sessionId: 1 },
      { documentId: 10, sessionId: 2 },
      { documentId: 11, sessionId: 1 },
    ])
    prisma.document.deleteMany.mockResolvedValue({ count: 2 })

    const result = await service.deleteDocuments([10, 11])

    expect(result).toEqual({ deleted: 2, failed: 0 })
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledTimes(3)
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 1,
      documentId: 10,
    })
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 2,
      documentId: 10,
    })
    expect(bridgeService.removeDocumentBridge).toHaveBeenCalledWith({
      sessionId: 1,
      documentId: 11,
    })
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
    })
    expect(vectorDB.vacuum).toHaveBeenCalledTimes(1)
  })
})
