/**
 * 文档服务
 * 处理文档上传、解析、分块、embedding 存储的完整流程
 */

import { Prisma, PrismaClient, Document, DocumentChunk } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

import { loadDocument, loadDocumentStream, isSupportedMimeType } from '../../modules/document/loaders'
import type { DocumentContent } from '../../modules/document/loaders'
import {
  iterateTextChunks,
  iteratePageAwareChunks,
  estimateTokenCount,
  getSmartChunkingConfig,
  extractAnchor,
  calculatePagePosition,
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

  /**
   * 最大页数限制（0 表示不限制，默认 200）
   * 用于防止超大 PDF 导致服务器崩溃
   */
  maxPages?: number
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
   * 使用流式处理减少内存占用，支持大型 PDF
   */
  async processDocument(
    documentId: number,
    onProgress?: ProgressCallback,
    jobId?: number
  ): Promise<void> {
    const report = async (progress: ProcessingProgress) => {
      if (onProgress) {
        onProgress(progress)
      }
      // 持久化进度（worker 可据此展示/自愈）
      try {
        await this.prisma.document.update({
          where: { id: documentId },
          data: {
            processingStage: progress.stage,
            processingProgress: Math.max(0, Math.min(100, progress.progress)),
            processingHeartbeatAt: new Date(),
          },
        })
      } catch {
        // 忽略进度更新错误，不影响主流程
      }
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

      // 获取配置
      const maxPages = this.config.maxPages ?? 200
      const embeddingConfig = this.embeddingService.getConfig()
      // 每次传给 embedding 服务的文本数量 = batchSize × concurrency，以充分利用并发
      const batchSize = Math.max(1, Math.floor((embeddingConfig.batchSize || 1) * (embeddingConfig.concurrency || 1)))

      // 断点续跑：跳过已存在的 chunks
      const existingChunkCount = await this.prisma.documentChunk.count({ where: { documentId } })
      const startIndex = existingChunkCount

      // 统计变量
      let totalChunksProcessed = startIndex
      let totalChars = 0
      let processedChars = 0
      let totalPages = 0
      let processedPages = 0
      let wasTruncated = false

      // 批处理缓冲区
      let batchChunks: (TextChunk | PageAwareTextChunk)[] = []
      let batchTexts: string[] = []
      let chunkIndex = startIndex

      // 刷新批次
      const flushBatch = async () => {
        if (batchTexts.length === 0) return
        await checkCanceled()

        await report({
          stage: 'embedding',
          progress: 30 + Math.floor(60 * (processedPages / Math.max(1, maxPages))),
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

        await report({
          stage: 'storing',
          progress: 30 + Math.floor(60 * (processedPages / Math.max(1, maxPages))),
          message: '正在存储到向量数据库...',
        })
      }

      // 检查文档类型是否支持流式处理（目前只有 PDF 支持）
      const isPdf = document.mimeType === 'application/pdf'

      if (isPdf) {
        // 使用流式处理 PDF
        await report({ stage: 'parsing', progress: 10, message: '正在流式解析文档...' })

        const streamResult = await loadDocumentStream(
          document.filePath,
          document.mimeType,
          {
            maxPages,
            onPage: async (content: DocumentContent, pageIndex: number) => {
              await checkCanceled()
              processedPages++

              // 对每页内容进行分块
              const pageText = content.pageContent
              if (!pageText.trim()) return

              totalChars += pageText.length

              // 使用按页分块策略
              const pageContent: PageContent = {
                pageContent: pageText,
                pageNumber: content.metadata.pageNumber || pageIndex + 1,
                metadata: content.metadata,
              }

              for (const chunk of iteratePageAwareChunks([pageContent], {
                chunkSize: this.config.chunkSize,
                chunkOverlap: this.config.chunkOverlap,
              })) {
                // 重新编排 chunk index
                const adjustedChunk: PageAwareTextChunk = {
                  ...chunk,
                  index: chunkIndex++,
                }

                if (adjustedChunk.index < startIndex) {
                  processedChars += adjustedChunk.content.length
                  continue
                }

                batchChunks.push(adjustedChunk)
                batchTexts.push(adjustedChunk.content)
                processedChars += adjustedChunk.content.length

                if (batchTexts.length >= batchSize) {
                  await flushBatch()
                }
              }

              // 更新进度
              await report({
                stage: 'chunking',
                progress: 20 + Math.floor(10 * (processedPages / Math.max(1, maxPages))),
                message: `正在处理第 ${processedPages} 页...`,
              })
            },
          }
        )

        totalPages = streamResult.totalPages
        wasTruncated = streamResult.skipped
      } else {
        // 非 PDF 使用传统全量加载
        await report({ stage: 'parsing', progress: 10, message: '正在解析文档...' })
        const contents = await loadDocument(document.filePath, document.mimeType)

        if (contents.length === 0) {
          throw new Error('No content extracted from document')
        }

        totalPages = contents.length
        const hasPageInfo = contents.some((c) => typeof c.metadata.pageNumber === 'number')
        const fullText = contents.map((c) => c.pageContent).join('\n\n')
        totalChars = fullText.length

        await report({ stage: 'chunking', progress: 25, message: '正在分块并生成 embedding...' })

        if (hasPageInfo) {
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
        processedPages = contents.length
      }

      await flushBatch()

      if (totalChunksProcessed === 0) {
        throw new Error('No chunks created from document')
      }

      // 更新文档状态
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'ready',
          processingStage: 'done',
          processingProgress: 100,
          processingFinishedAt: new Date(),
          chunkCount: totalChunksProcessed,
          metadata: JSON.stringify({
            pageCount: totalPages,
            processedPages,
            charCount: totalChars,
            wordCount: Math.floor(totalChars / 5), // 估算
            truncated: wasTruncated,
            maxPagesLimit: wasTruncated ? maxPages : undefined,
          }),
        },
      })

      const truncateMsg = wasTruncated
        ? ` (已截断，仅处理前 ${maxPages} 页，共 ${totalPages} 页)`
        : ''
      await report({ stage: 'done', progress: 100, message: `处理完成${truncateMsg}` })
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

      await report({ stage: 'error', progress: 0, message: '处理失败', error: errorMessage })
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
