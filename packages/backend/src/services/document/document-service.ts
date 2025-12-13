/**
 * 文档服务
 * 处理文档上传、解析、分块、embedding 存储的完整流程
 */

import { Prisma, PrismaClient, Document, DocumentChunk } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

import { loadDocument, isSupportedMimeType } from '../../modules/document/loaders'
import {
  iterateTextChunks,
  iteratePageAwareChunks,
  estimateTokenCount,
  type TextChunk,
  type PageContent,
  type PageAwareTextChunk,
} from './chunking-service'
import { EmbeddingService, type EmbeddingConfig } from './embedding-service'
import { type VectorDBClient, type VectorItem } from '../../modules/document/vector'

export interface DocumentServiceConfig {
  /**
   * 文档存储目录
   */
  storageDir: string

  /**
   * 最大文件大小（字节）
   */
  maxFileSize: number

  /**
   * 分块大小
   */
  chunkSize: number

  /**
   * 分块重叠
   */
  chunkOverlap: number

  /**
   * 文档过期天数（null 表示不过期）
   */
  retentionDays: number | null
}

export interface UploadResult {
  documentId: number
  filename: string
  originalName: string
  status: 'pending' | 'processing' | 'ready' | 'error'
}

export interface ProcessingProgress {
  stage: 'parsing' | 'chunking' | 'embedding' | 'storing' | 'done' | 'error'
  progress: number // 0-100
  message: string
  error?: string
}

export type ProgressCallback = (progress: ProcessingProgress) => void

export class DocumentService {
  private prisma: PrismaClient
  private vectorDB: VectorDBClient
  private embeddingService: EmbeddingService
  private config: DocumentServiceConfig

  constructor(
    prisma: PrismaClient,
    vectorDB: VectorDBClient,
    embeddingService: EmbeddingService,
    config: DocumentServiceConfig
  ) {
    this.prisma = prisma
    this.vectorDB = vectorDB
    this.embeddingService = embeddingService
    this.config = config
  }

  /**
   * 上传文档
   */
  async uploadDocument(
    file: {
      buffer: Buffer
      originalName: string
      mimeType: string
    },
    userId?: number,
    anonymousKey?: string
  ): Promise<UploadResult> {
    // 验证文件大小
    if (file.buffer.length > this.config.maxFileSize) {
      throw new Error(
        `File too large. Maximum size is ${Math.round(this.config.maxFileSize / 1024 / 1024)}MB`
      )
    }

    // 明确不支持旧版 Word .doc
    const extLower = path.extname(file.originalName || '').toLowerCase()
    if (extLower === '.doc') {
      throw new Error('仅支持 DOCX，请先将 .doc 转为 .docx 再上传')
    }

    // 验证文件类型
    if (!isSupportedMimeType(file.mimeType)) {
      throw new Error(`Unsupported file type: ${file.mimeType}`)
    }

    // 生成文件名和路径
    const ext = path.extname(file.originalName) || ''
    const filename = `${uuidv4()}${ext}`
    const filePath = path.join(this.config.storageDir, filename)

    // 计算文件哈希
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex')

    // 确保存储目录存在
    await fs.mkdir(this.config.storageDir, { recursive: true })

    // 保存文件
    await fs.writeFile(filePath, file.buffer)

    // 计算过期时间
    const expiresAt = this.config.retentionDays
      ? new Date(Date.now() + this.config.retentionDays * 24 * 60 * 60 * 1000)
      : null

    // 创建数据库记录
    const document = await this.prisma.document.create({
      data: {
        userId,
        anonymousKey,
        filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.buffer.length,
        filePath,
        status: 'pending',
        processingStage: 'pending',
        processingProgress: 0,
        contentHash,
        collectionName: `doc_${uuidv4().replace(/-/g, '')}`,
        expiresAt,
      },
    })

    // 创建处理任务（由 worker 消费）
    try {
      await this.prisma.documentProcessingJob.create({
        data: {
          documentId: document.id,
          status: 'pending',
        },
      })
    } catch (e) {
      // 若创建任务失败，标记文档为 error，避免前端一直 pending
      const msg = e instanceof Error ? e.message : 'Failed to enqueue document'
      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'error', errorMessage: msg, processingStage: 'error', processingProgress: 0 },
      })
      throw e
    }

    return {
      documentId: document.id,
      filename: document.filename,
      originalName: document.originalName,
      status: document.status as UploadResult['status'],
    }
  }

  /**
   * 处理文档（解析、分块、embedding）
   */
  async processDocument(
    documentId: number,
    onProgress?: ProgressCallback,
    jobId?: number
  ): Promise<void> {
    const report = (progress: ProcessingProgress) => {
      if (onProgress) {
        onProgress(progress)
      }
      // 持久化进度（worker 可据此展示/自愈）
      this.prisma.document.update({
        where: { id: documentId },
        data: {
          processingStage: progress.stage,
          processingProgress: Math.max(0, Math.min(100, progress.progress)),
          processingHeartbeatAt: new Date(),
        },
      }).catch(() => {})
    }

    try {
      const checkCanceled = async () => {
        if (!jobId) return
        const job = await this.prisma.documentProcessingJob.findUnique({ where: { id: jobId } })
        if (job?.status === 'canceled') {
          throw new Error('Document processing canceled')
        }
      }

      // 更新状态为处理中
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'processing',
          processingStage: 'parsing',
          processingProgress: 0,
          processingStartedAt: new Date(),
          processingHeartbeatAt: new Date(),
          processingFinishedAt: null,
        },
      })

      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
      })

      if (!document) {
        throw new Error('Document not found')
      }

      // 1. 解析文档
      report({ stage: 'parsing', progress: 10, message: '正在解析文档...' })
      const contents = await loadDocument(document.filePath, document.mimeType)

      if (contents.length === 0) {
        throw new Error('No content extracted from document')
      }

      // 检测是否有页码信息（PDF等按页解析的文档）
      const hasPageInfo = contents.some((c) => typeof c.metadata.pageNumber === 'number')

      // 计算总字符数（用于进度显示）
      const fullText = contents.map((c) => c.pageContent).join('\n\n')
      const totalChars = fullText.length

      // 2. 流式分块 + 增量 embedding/写库
      report({ stage: 'chunking', progress: 25, message: '正在分块并生成 embedding...' })

      // 断点续跑：跳过已存在的 chunks
      const existingChunkCount = await this.prisma.documentChunk.count({ where: { documentId } })
      const startIndex = existingChunkCount

      const embeddingConfig = this.embeddingService.getConfig()
      const batchSize = Math.max(1, Math.floor(embeddingConfig.batchSize || 1))

      let batchChunks: (TextChunk | PageAwareTextChunk)[] = []
      let batchTexts: string[] = []
      let processedChars = 0
      let totalChunksProcessed = startIndex

      const flushBatch = async () => {
        if (batchTexts.length === 0) return
        await checkCanceled()

        report({
          stage: 'embedding',
          progress: 30 + Math.floor(60 * (processedChars / Math.max(1, totalChars))),
          message: `正在生成 embedding (${totalChunksProcessed + batchTexts.length} 块)...`,
        })

        const embeddings = await this.embeddingService.embedBatch(batchTexts)

        if (!embeddings || embeddings.length !== batchTexts.length) {
          throw new Error(`Embedding count mismatch: expected ${batchTexts.length}, got ${embeddings?.length ?? 0}`)
        }

        for (let i = 0; i < embeddings.length; i++) {
          if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
            console.error(`[Document] Invalid embedding at index ${i}:`, embeddings[i])
            throw new Error(`Invalid embedding at chunk ${batchChunks[i].index}: embedding is missing or empty`)
          }
        }

        const vectorItems: VectorItem[] = batchChunks.map((chunk, i) => ({
          id: `${documentId}_${chunk.index}`,
          text: chunk.content,
          vector: embeddings[i],
          metadata: {
            documentId,
            chunkIndex: chunk.index,
            ...chunk.metadata,
          },
        }))

        await this.vectorDB.insert(document.collectionName!, vectorItems)

        const chunkRecords = batchChunks.map((chunk) => ({
          documentId,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: estimateTokenCount(chunk.content),
          metadata: JSON.stringify(chunk.metadata),
          vectorId: `${documentId}_${chunk.index}`,
        }))

        try {
          await this.prisma.documentChunk.createMany({ data: chunkRecords })
        } catch (e) {
          // SQLite 下 createMany 不支持 skipDuplicates；并发/断点续跑时也可能触发唯一键冲突
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            for (const record of chunkRecords) {
              await this.prisma.documentChunk.upsert({
                where: {
                  documentId_chunkIndex: { documentId: record.documentId, chunkIndex: record.chunkIndex },
                },
                create: record,
                update: {
                  content: record.content,
                  tokenCount: record.tokenCount,
                  metadata: record.metadata,
                  vectorId: record.vectorId,
                },
              })
            }
          } else {
            throw e
          }
        }

        totalChunksProcessed += batchChunks.length
        batchChunks = []
        batchTexts = []

        report({
          stage: 'storing',
          progress: 30 + Math.floor(60 * (processedChars / Math.max(1, totalChars))),
          message: '正在存储到向量数据库...',
        })
      }

      // 根据是否有页码信息选择不同的分块策略
      if (hasPageInfo) {
        // 使用按页分块：保留页码元数据
        const pages: PageContent[] = contents
          .filter((c) => typeof c.metadata.pageNumber === 'number')
          .map((c) => ({
            pageContent: c.pageContent,
            pageNumber: c.metadata.pageNumber as number,
            metadata: c.metadata,
          }))

        for (const chunk of iteratePageAwareChunks(pages, {
          chunkSize: this.config.chunkSize,
          chunkOverlap: this.config.chunkOverlap,
        })) {
          if (chunk.index < startIndex) {
            processedChars += chunk.content.length
            continue
          }

          await checkCanceled()

          batchChunks.push(chunk)
          batchTexts.push(chunk.content)
          processedChars += chunk.content.length

          if (batchTexts.length >= batchSize) {
            await flushBatch()
          }
        }
      } else {
        // 使用传统分块：无页码信息
        for (const chunk of iterateTextChunks(fullText, {
          chunkSize: this.config.chunkSize,
          chunkOverlap: this.config.chunkOverlap,
        })) {
          if (chunk.index < startIndex) {
            processedChars = (chunk.metadata.endChar as number) || processedChars
            continue
          }

          await checkCanceled()

          batchChunks.push(chunk)
          batchTexts.push(chunk.content)
          processedChars = (chunk.metadata.endChar as number) || processedChars

          if (batchTexts.length >= batchSize) {
            await flushBatch()
          }
        }
      }

      await flushBatch()

      if (totalChunksProcessed === 0) {
        throw new Error('No chunks created from document')
      }

      // 6. 更新文档状态
      // 计算页数：有页码信息时取最大页码，否则取第一个content的totalPages
      const pageCount = hasPageInfo
        ? Math.max(...contents.map((c) => (c.metadata.pageNumber as number) || 0))
        : (contents[0]?.metadata.totalPages as number) || 1

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'ready',
          processingStage: 'done',
          processingProgress: 100,
          processingFinishedAt: new Date(),
          chunkCount: totalChunksProcessed,
          metadata: JSON.stringify({
            pageCount,
            charCount: fullText.length,
            wordCount: fullText.split(/\s+/).length,
            hasPageInfo, // 记录是否有页码信息，便于后续查询
          }),
        },
      })

      report({ stage: 'done', progress: 100, message: '处理完成' })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'error',
          errorMessage,
          processingStage: 'error',
          processingProgress: 0,
          processingFinishedAt: new Date(),
        },
      })

      report({ stage: 'error', progress: 0, message: '处理失败', error: errorMessage })
      throw error
    }
  }

  /**
   * 将文档附加到会话
   */
  async attachToSession(documentId: number, sessionId: number): Promise<void> {
    await this.prisma.sessionDocument.upsert({
      where: {
        sessionId_documentId: { sessionId, documentId },
      },
      create: { sessionId, documentId },
      update: {},
    })

    // 更新文档访问时间
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    })
  }

  /**
   * 从会话移除文档
   */
  async detachFromSession(documentId: number, sessionId: number): Promise<void> {
    await this.prisma.sessionDocument.deleteMany({
      where: { sessionId, documentId },
    })
  }

  /**
   * 获取会话的所有文档
   */
  async getSessionDocuments(sessionId: number): Promise<Document[]> {
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    return sessionDocs.map((sd) => sd.document)
  }

  /**
   * 获取文档详情
   */
  async getDocument(documentId: number): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { id: documentId },
    })
  }

  /**
   * 获取文档的所有 chunks
   */
  async getDocumentChunks(documentId: number): Promise<DocumentChunk[]> {
    return this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    })
  }

  /**
   * 取消文档处理任务
   */
  async cancelProcessing(documentId: number): Promise<void> {
    await this.prisma.documentProcessingJob.updateMany({
      where: {
        documentId,
        status: { in: ['pending', 'running', 'retrying'] },
      },
      data: {
        status: 'canceled',
        lockedAt: null,
        nextRunAt: null,
      },
    })

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'error',
        errorMessage: '用户已取消处理',
        processingStage: 'error',
        processingProgress: 0,
        processingFinishedAt: new Date(),
      },
    })
  }

  /**
   * 删除文档
   */
  async deleteDocument(documentId: number): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    })

    if (!document) return

    // 删除向量数据
    if (document.collectionName) {
      try {
        await this.vectorDB.deleteCollection(document.collectionName)
      } catch {
        // 忽略向量数据库删除错误
      }
    }

    // 删除物理文件
    try {
      await fs.unlink(document.filePath)
      console.log(`[DocumentService] Deleted file: ${document.filePath}`)
    } catch (err) {
      // 文件可能已被删除或不存在，记录但不抛出错误
      console.warn(`[DocumentService] Failed to delete file ${document.filePath}:`, err instanceof Error ? err.message : err)
    }

    // 删除数据库记录（级联删除 chunks 和 session_documents）
    await this.prisma.document.delete({
      where: { id: documentId },
    })
  }

  /**
   * 获取用户的所有文档
   */
  async getUserDocuments(userId: number): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * 获取匿名用户的所有文档
   */
  async getAnonymousDocuments(anonymousKey: string): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { anonymousKey },
      orderBy: { createdAt: 'desc' },
    })
  }
}
