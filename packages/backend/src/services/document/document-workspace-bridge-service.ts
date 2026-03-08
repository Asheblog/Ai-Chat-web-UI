import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { createLogger } from '../../utils/logger'
import {
  WorkspaceService,
  workspaceService as defaultWorkspaceService,
} from '../workspace/workspace-service'

const log = createLogger('DocWorkspaceBridge')

const toPortablePath = (value: string) => value.split(path.sep).join('/')

const sanitizeFileName = (rawName: string, fallback: string) => {
  const candidate = path.basename((rawName || '').trim()) || fallback
  const normalized = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return normalized || fallback
}

const parseJsonObject = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // noop
  }
  return {}
}

export type DocumentWorkspaceBridgeStatus = 'ready' | 'pending' | 'error'

export interface DocumentWorkspaceBridgeDescriptor {
  sessionId: number
  documentId: number
  documentName: string
  documentStatus: string
  status: DocumentWorkspaceBridgeStatus
  rootRelativePath: string
  syncedAt: string
  original: {
    exists: boolean
    relativePath: string
    fileName: string
    mimeType: string
  }
  normalized: {
    exists: boolean
    relativePath: string
    contentPath: string
    pagesPath: string
    tocPath: string
    metadataPath: string
    chunkCount: number
    pageCount: number
  }
  error?: string
}

export interface DocumentWorkspaceBridgeServiceDeps {
  prisma?: PrismaClient
  workspaceService?: WorkspaceService
}

export interface SyncDocumentToWorkspaceInput {
  sessionId: number
  documentId: number
  force?: boolean
}

export interface RemoveDocumentBridgeInput {
  sessionId: number
  documentId: number
}

type DocumentRecord = {
  id: number
  originalName: string
  filename: string
  mimeType: string
  status: string
  filePath: string
  chunkCount: number
  metadata: string
  createdAt: Date
  updatedAt: Date
}

export class DocumentWorkspaceBridgeService {
  private readonly prisma: PrismaClient
  private readonly workspaceService: WorkspaceService

  constructor(deps: DocumentWorkspaceBridgeServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.workspaceService = deps.workspaceService ?? defaultWorkspaceService
  }

  async syncDocumentToWorkspace(
    input: SyncDocumentToWorkspaceInput,
  ): Promise<DocumentWorkspaceBridgeDescriptor> {
    const { sessionId, documentId } = input
    const now = new Date().toISOString()
    const workspace = await this.workspaceService.ensureWorkspace(sessionId)

    const relation = await this.prisma.sessionDocument.findFirst({
      where: { sessionId, documentId },
      select: { id: true },
    })
    if (!relation) {
      throw new Error(`文档 ${documentId} 未附加到会话 ${sessionId}`)
    }

    const document = (await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        originalName: true,
        filename: true,
        mimeType: true,
        status: true,
        filePath: true,
        chunkCount: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as DocumentRecord | null

    if (!document) {
      throw new Error(`文档 ${documentId} 不存在`)
    }

    const bridgeRootAbs = path.resolve(workspace.inputPath, 'documents', String(documentId))
    const originalDirAbs = path.resolve(bridgeRootAbs, 'original')
    const normalizedDirAbs = path.resolve(bridgeRootAbs, 'normalized')
    await fs.mkdir(originalDirAbs, { recursive: true })
    await fs.mkdir(normalizedDirAbs, { recursive: true })

    const preferredOriginalName = sanitizeFileName(
      document.originalName || document.filename,
      `document-${documentId}`,
    )
    const originalTargetAbs = path.resolve(originalDirAbs, preferredOriginalName)
    await fs.copyFile(document.filePath, originalTargetAbs)

    const rootRelativePath = toPortablePath(path.relative(workspace.rootPath, bridgeRootAbs))
    const originalRelativePath = toPortablePath(path.relative(workspace.rootPath, originalTargetAbs))
    const normalizedRelativePath = toPortablePath(path.relative(workspace.rootPath, normalizedDirAbs))
    const contentRelativePath = `${normalizedRelativePath}/content.md`
    const pagesRelativePath = `${normalizedRelativePath}/pages.jsonl`
    const tocRelativePath = `${normalizedRelativePath}/toc.json`
    const metadataRelativePath = `${normalizedRelativePath}/metadata.json`

    const parsedDocMeta = parseJsonObject(document.metadata)
    const expectedPageCount =
      typeof parsedDocMeta.pageCount === 'number' && parsedDocMeta.pageCount > 0
        ? parsedDocMeta.pageCount
        : 0

    if (document.status !== 'ready') {
      return {
        sessionId,
        documentId,
        documentName: document.originalName,
        documentStatus: document.status,
        status: 'pending',
        rootRelativePath,
        syncedAt: now,
        original: {
          exists: true,
          relativePath: originalRelativePath,
          fileName: preferredOriginalName,
          mimeType: document.mimeType,
        },
        normalized: {
          exists: false,
          relativePath: normalizedRelativePath,
          contentPath: contentRelativePath,
          pagesPath: pagesRelativePath,
          tocPath: tocRelativePath,
          metadataPath: metadataRelativePath,
          chunkCount: document.chunkCount || 0,
          pageCount: expectedPageCount,
        },
      }
    }

    try {
      const [chunks, sections] = await Promise.all([
        this.prisma.documentChunk.findMany({
          where: { documentId },
          select: {
            chunkIndex: true,
            content: true,
            pageNumber: true,
            pageStart: true,
            pageEnd: true,
            metadata: true,
            tokenCount: true,
          },
          orderBy: { chunkIndex: 'asc' },
        }),
        this.prisma.documentSection.findMany({
          where: { documentId },
          select: {
            id: true,
            parentId: true,
            level: true,
            title: true,
            path: true,
            startPage: true,
            endPage: true,
            startChunk: true,
            endChunk: true,
            confidence: true,
          },
          orderBy: [{ level: 'asc' }, { path: 'asc' }],
        }),
      ])

      const contentLines: string[] = [
        `# ${document.originalName}`,
        '',
        `- documentId: ${document.id}`,
        `- mimeType: ${document.mimeType}`,
        `- chunkCount: ${chunks.length}`,
        '',
      ]

      const pages = new Map<number, Array<{ chunkIndex: number; content: string }>>()
      for (const chunk of chunks) {
        const pageKey =
          typeof chunk.pageNumber === 'number'
            ? chunk.pageNumber
            : typeof chunk.pageStart === 'number'
              ? chunk.pageStart
              : 0
        const pageList = pages.get(pageKey) ?? []
        pageList.push({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
        })
        pages.set(pageKey, pageList)

        const pageLabel =
          typeof chunk.pageNumber === 'number'
            ? `${chunk.pageNumber}`
            : typeof chunk.pageStart === 'number' || typeof chunk.pageEnd === 'number'
              ? `${chunk.pageStart ?? '?'}-${chunk.pageEnd ?? '?'}`
              : 'unknown'
        contentLines.push(`## Chunk ${chunk.chunkIndex} (page: ${pageLabel})`)
        contentLines.push('')
        contentLines.push(chunk.content)
        contentLines.push('')
      }

      const sortedPageKeys = Array.from(pages.keys()).sort((a, b) => a - b)
      const pageLines = sortedPageKeys.map((pageKey) =>
        JSON.stringify({
          pageNumber: pageKey > 0 ? pageKey : null,
          chunks: pages.get(pageKey),
        }),
      )

      const contentAbs = path.resolve(normalizedDirAbs, 'content.md')
      const pagesAbs = path.resolve(normalizedDirAbs, 'pages.jsonl')
      const tocAbs = path.resolve(normalizedDirAbs, 'toc.json')
      const metadataAbs = path.resolve(normalizedDirAbs, 'metadata.json')

      await Promise.all([
        fs.writeFile(contentAbs, `${contentLines.join('\n').trim()}\n`, 'utf8'),
        fs.writeFile(pagesAbs, pageLines.join('\n'), 'utf8'),
        fs.writeFile(tocAbs, JSON.stringify(sections, null, 2), 'utf8'),
        fs.writeFile(
          metadataAbs,
          JSON.stringify(
            {
              syncedAt: now,
              source: {
                documentId: document.id,
                status: document.status,
                originalName: document.originalName,
                mimeType: document.mimeType,
                metadata: parseJsonObject(document.metadata),
              },
              normalized: {
                chunkCount: chunks.length,
                pageCount:
                  expectedPageCount > 0
                    ? expectedPageCount
                    : sortedPageKeys.filter((key) => key > 0).length,
                sectionCount: sections.length,
              },
            },
            null,
            2,
          ),
          'utf8',
        ),
      ])

      return {
        sessionId,
        documentId,
        documentName: document.originalName,
        documentStatus: document.status,
        status: 'ready',
        rootRelativePath,
        syncedAt: now,
        original: {
          exists: true,
          relativePath: originalRelativePath,
          fileName: preferredOriginalName,
          mimeType: document.mimeType,
        },
        normalized: {
          exists: true,
          relativePath: normalizedRelativePath,
          contentPath: contentRelativePath,
          pagesPath: pagesRelativePath,
          tocPath: tocRelativePath,
          metadataPath: metadataRelativePath,
          chunkCount: chunks.length,
          pageCount:
            expectedPageCount > 0
              ? expectedPageCount
              : sortedPageKeys.filter((key) => key > 0).length,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('syncDocumentToWorkspace failed', {
        sessionId,
        documentId,
        error: message,
      })
      return {
        sessionId,
        documentId,
        documentName: document.originalName,
        documentStatus: document.status,
        status: 'error',
        rootRelativePath,
        syncedAt: now,
        original: {
          exists: true,
          relativePath: originalRelativePath,
          fileName: preferredOriginalName,
          mimeType: document.mimeType,
        },
        normalized: {
          exists: false,
          relativePath: normalizedRelativePath,
          contentPath: contentRelativePath,
          pagesPath: pagesRelativePath,
          tocPath: tocRelativePath,
          metadataPath: metadataRelativePath,
          chunkCount: document.chunkCount || 0,
          pageCount: expectedPageCount,
        },
        error: message,
      }
    }
  }

  async syncSessionDocumentsToWorkspace(sessionId: number): Promise<DocumentWorkspaceBridgeDescriptor[]> {
    const docs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      select: { documentId: true },
      orderBy: { documentId: 'asc' },
    })

    const results: DocumentWorkspaceBridgeDescriptor[] = []
    for (const doc of docs) {
      try {
        const bridged = await this.syncDocumentToWorkspace({
          sessionId,
          documentId: doc.documentId,
        })
        results.push(bridged)
      } catch (error) {
        results.push({
          sessionId,
          documentId: doc.documentId,
          documentName: `document-${doc.documentId}`,
          documentStatus: 'unknown',
          status: 'error',
          rootRelativePath: `input/documents/${doc.documentId}`,
          syncedAt: new Date().toISOString(),
          original: {
            exists: false,
            relativePath: `input/documents/${doc.documentId}/original`,
            fileName: '',
            mimeType: 'application/octet-stream',
          },
          normalized: {
            exists: false,
            relativePath: `input/documents/${doc.documentId}/normalized`,
            contentPath: `input/documents/${doc.documentId}/normalized/content.md`,
            pagesPath: `input/documents/${doc.documentId}/normalized/pages.jsonl`,
            tocPath: `input/documents/${doc.documentId}/normalized/toc.json`,
            metadataPath: `input/documents/${doc.documentId}/normalized/metadata.json`,
            chunkCount: 0,
            pageCount: 0,
          },
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }

  async listSessionBridges(sessionId: number): Promise<DocumentWorkspaceBridgeDescriptor[]> {
    const docs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: {
        document: {
          select: {
            id: true,
            originalName: true,
            filename: true,
            mimeType: true,
            status: true,
            chunkCount: true,
            metadata: true,
          },
        },
      },
      orderBy: { documentId: 'asc' },
    })

    const workspace = await this.workspaceService.ensureWorkspace(sessionId)
    const descriptors: DocumentWorkspaceBridgeDescriptor[] = []

    for (const item of docs) {
      const documentId = item.documentId
      const bridgeRootAbs = path.resolve(workspace.inputPath, 'documents', String(documentId))
      const originalDirAbs = path.resolve(bridgeRootAbs, 'original')
      const normalizedDirAbs = path.resolve(bridgeRootAbs, 'normalized')

      const originalFiles = await fs.readdir(originalDirAbs).catch(() => [] as string[])
      const fileName =
        originalFiles.find((name) => name && name !== '.' && name !== '..') ||
        sanitizeFileName(item.document.originalName || item.document.filename, `document-${documentId}`)

      const originalRel = toPortablePath(
        path.relative(workspace.rootPath, path.resolve(originalDirAbs, fileName)),
      )
      const normalizedRel = toPortablePath(path.relative(workspace.rootPath, normalizedDirAbs))
      const contentPath = `${normalizedRel}/content.md`
      const pagesPath = `${normalizedRel}/pages.jsonl`
      const tocPath = `${normalizedRel}/toc.json`
      const metadataPath = `${normalizedRel}/metadata.json`

      const [originalExists, contentExists] = await Promise.all([
        fs
          .access(path.resolve(originalDirAbs, fileName))
          .then(() => true)
          .catch(() => false),
        fs
          .access(path.resolve(normalizedDirAbs, 'content.md'))
          .then(() => true)
          .catch(() => false),
      ])

      const parsedMeta = parseJsonObject(item.document.metadata)
      const pageCount =
        typeof parsedMeta.pageCount === 'number' && parsedMeta.pageCount > 0
          ? parsedMeta.pageCount
          : 0

      let status: DocumentWorkspaceBridgeStatus = 'pending'
      if (item.document.status === 'ready' && contentExists) {
        status = 'ready'
      } else if (item.document.status === 'error') {
        status = 'error'
      }

      descriptors.push({
        sessionId,
        documentId,
        documentName: item.document.originalName,
        documentStatus: item.document.status,
        status,
        rootRelativePath: toPortablePath(path.relative(workspace.rootPath, bridgeRootAbs)),
        syncedAt: new Date().toISOString(),
        original: {
          exists: originalExists,
          relativePath: originalRel,
          fileName,
          mimeType: item.document.mimeType,
        },
        normalized: {
          exists: contentExists,
          relativePath: normalizedRel,
          contentPath,
          pagesPath,
          tocPath,
          metadataPath,
          chunkCount: item.document.chunkCount || 0,
          pageCount,
        },
      })
    }

    return descriptors
  }

  async removeDocumentBridge(input: RemoveDocumentBridgeInput): Promise<void> {
    const workspace = await this.workspaceService.ensureWorkspace(input.sessionId)
    const bridgeRootAbs = path.resolve(
      workspace.inputPath,
      'documents',
      String(input.documentId),
    )
    await fs.rm(bridgeRootAbs, { recursive: true, force: true }).catch(() => {})
  }
}

let documentWorkspaceBridgeService = new DocumentWorkspaceBridgeService()

export const setDocumentWorkspaceBridgeService = (service: DocumentWorkspaceBridgeService) => {
  documentWorkspaceBridgeService = service
}

export { documentWorkspaceBridgeService }
