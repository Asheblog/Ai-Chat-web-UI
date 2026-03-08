import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentWorkspaceBridgeService } from './document-workspace-bridge-service'

describe('DocumentWorkspaceBridgeService', () => {
  const buildDeps = (rootPath: string) => {
    const prisma = {
      sessionDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      document: {
        findUnique: jest.fn(),
      },
      documentChunk: {
        findMany: jest.fn(),
      },
      documentSection: {
        findMany: jest.fn(),
      },
    }

    const workspaceService = {
      ensureWorkspace: jest.fn().mockResolvedValue({
        sessionId: 1,
        rootPath,
        inputPath: path.resolve(rootPath, 'input'),
        reposPath: path.resolve(rootPath, 'repos'),
        artifactsPath: path.resolve(rootPath, 'artifacts'),
        venvPath: path.resolve(rootPath, '.venv'),
        metaPath: path.resolve(rootPath, '.meta'),
        record: {
          id: 100,
          sessionId: 1,
          rootPath,
          status: 'active',
          sandboxProvider: 'docker',
          lastUsedAt: new Date(),
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    }

    return { prisma, workspaceService }
  }

  it('syncs original + normalized files for ready documents', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-bridge-ready-'))
    const sourceFile = path.resolve(tmpRoot, 'source.pdf')
    await fs.writeFile(sourceFile, 'pdf-bytes', 'utf8')

    const { prisma, workspaceService } = buildDeps(tmpRoot)
    prisma.sessionDocument.findFirst.mockResolvedValue({ id: 1, sessionId: 1, documentId: 10 })
    prisma.document.findUnique.mockResolvedValue({
      id: 10,
      originalName: 'spec.pdf',
      filename: 'uuid.pdf',
      mimeType: 'application/pdf',
      status: 'ready',
      chunkCount: 2,
      filePath: sourceFile,
      metadata: JSON.stringify({ pageCount: 2 }),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    prisma.documentChunk.findMany.mockResolvedValue([
      {
        id: 1,
        documentId: 10,
        chunkIndex: 0,
        content: '第一页内容',
        pageNumber: 1,
        pageStart: 1,
        pageEnd: 1,
        metadata: JSON.stringify({ pageNumber: 1 }),
      },
      {
        id: 2,
        documentId: 10,
        chunkIndex: 1,
        content: '第二页内容',
        pageNumber: 2,
        pageStart: 2,
        pageEnd: 2,
        metadata: JSON.stringify({ pageNumber: 2 }),
      },
    ])
    prisma.documentSection.findMany.mockResolvedValue([
      {
        id: 1,
        documentId: 10,
        title: '第一章',
        path: '1',
        level: 1,
        startPage: 1,
        endPage: 2,
      },
    ])

    const service = new DocumentWorkspaceBridgeService({
      prisma: prisma as any,
      workspaceService: workspaceService as any,
    })
    const result = await service.syncDocumentToWorkspace({
      sessionId: 1,
      documentId: 10,
    })

    expect(result.status).toBe('ready')
    expect(result.original.exists).toBe(true)
    expect(result.normalized.exists).toBe(true)
    expect(result.normalized.contentPath).toBe('input/documents/10/normalized/content.md')

    const exported = await fs.readFile(path.resolve(tmpRoot, result.normalized.contentPath), 'utf8')
    expect(exported).toContain('第一页内容')
    expect(exported).toContain('第二页内容')
  })

  it('returns pending when document is not ready but still mirrors original file', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-bridge-pending-'))
    const sourceFile = path.resolve(tmpRoot, 'draft.docx')
    await fs.writeFile(sourceFile, 'docx-bytes', 'utf8')

    const { prisma, workspaceService } = buildDeps(tmpRoot)
    prisma.sessionDocument.findFirst.mockResolvedValue({ id: 2, sessionId: 1, documentId: 11 })
    prisma.document.findUnique.mockResolvedValue({
      id: 11,
      originalName: 'draft.docx',
      filename: 'uuid.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'processing',
      chunkCount: 0,
      filePath: sourceFile,
      metadata: '{}',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const service = new DocumentWorkspaceBridgeService({
      prisma: prisma as any,
      workspaceService: workspaceService as any,
    })
    const result = await service.syncDocumentToWorkspace({
      sessionId: 1,
      documentId: 11,
    })

    expect(result.status).toBe('pending')
    expect(result.original.exists).toBe(true)
    expect(result.normalized.exists).toBe(false)
  })

  it('removes bridged directory for a document', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-bridge-remove-'))
    const bridgeRoot = path.resolve(tmpRoot, 'input', 'documents', '12')
    await fs.mkdir(path.resolve(bridgeRoot, 'normalized'), { recursive: true })
    await fs.writeFile(path.resolve(bridgeRoot, 'normalized', 'content.md'), 'hello', 'utf8')

    const { prisma, workspaceService } = buildDeps(tmpRoot)
    const service = new DocumentWorkspaceBridgeService({
      prisma: prisma as any,
      workspaceService: workspaceService as any,
    })

    await service.removeDocumentBridge({ sessionId: 1, documentId: 12 })

    const exists = await fs
      .access(bridgeRoot)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })
})
