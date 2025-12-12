/**
 * 文档服务
 * 处理文档上传、解析、分块、embedding 存储的完整流程
 */

import { PrismaClient, Document, DocumentChunk } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

import { loadDocument, isSupportedMimeType } from '../../modules/document/loaders'
import { splitText, estimateTokenCount, type TextChunk } from './chunking-service'
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
        contentHash,
        collectionName: `doc_${uuidv4().replace(/-/g, '')}`,
        expiresAt,
      },
    })

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
    onProgress?: ProgressCallback
  ): Promise<void> {
    const report = (progress: ProcessingProgress) => {
      if (onProgress) {
        onProgress(progress)
      }
    }

    try {
      // 更新状态为处理中
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' },
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

      // 合并所有内容
      const fullText = contents.map((c) => c.pageContent).join('\n\n')

      // 2. 分块
      report({ stage: 'chunking', progress: 30, message: '正在分块...' })
      const chunks = splitText(fullText, {
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
      })

      if (chunks.length === 0) {
        throw new Error('No chunks created from document')
      }

      // 3. 生成 embedding
      report({ stage: 'embedding', progress: 50, message: `正在生成 embedding (${chunks.length} 块)...` })
      const texts = chunks.map((c) => c.content)
      const embeddings = await this.embeddingService.embedBatch(texts)

      // 验证 embeddings 完整性
      if (!embeddings || embeddings.length !== texts.length) {
        throw new Error(`Embedding count mismatch: expected ${texts.length}, got ${embeddings?.length ?? 0}`)
      }

      for (let i = 0; i < embeddings.length; i++) {
        if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
          console.error(`[Document] Invalid embedding at index ${i}:`, embeddings[i])
          throw new Error(`Invalid embedding at chunk ${i}: embedding is missing or empty`)
        }
      }

      // 4. 存储到向量数据库
      report({ stage: 'storing', progress: 80, message: '正在存储到向量数据库...' })

      const vectorItems: VectorItem[] = chunks.map((chunk, index) => ({
        id: `${documentId}_${chunk.index}`,
        text: chunk.content,
        vector: embeddings[index],
        metadata: {
          documentId,
          chunkIndex: chunk.index,
          ...chunk.metadata,
        },
      }))

      await this.vectorDB.insert(document.collectionName!, vectorItems)

      // 5. 保存 chunks 到数据库
      const chunkRecords = chunks.map((chunk, index) => ({
        documentId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: estimateTokenCount(chunk.content),
        metadata: JSON.stringify(chunk.metadata),
        vectorId: `${documentId}_${chunk.index}`,
      }))

      await this.prisma.documentChunk.createMany({
        data: chunkRecords,
      })

      // 6. 更新文档状态
      const pageCount = contents.reduce((acc, c) => {
        return acc + (c.metadata.totalPages || 1)
      }, 0)

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'ready',
          chunkCount: chunks.length,
          metadata: JSON.stringify({
            pageCount,
            charCount: fullText.length,
            wordCount: fullText.split(/\s+/).length,
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
    } catch {
      // 忽略文件删除错误
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
