/**
 * RAG 检索服务
 * 提供文档检索和上下文增强功能
 */

import { PrismaClient, Document } from '@prisma/client'
import { EmbeddingService } from './embedding-service'
import { type VectorDBClient, type SearchResult } from '../../modules/document/vector'

export interface RAGConfig {
  /**
   * 检索结果数量
   */
  topK: number

  /**
   * 相关性阈值 (0-1)
   */
  relevanceThreshold: number

  /**
   * 上下文最大 token 数
   */
  maxContextTokens: number
}

export interface RAGHit {
  documentId: number
  documentName: string
  chunkIndex: number
  content: string
  score: number
  metadata: Record<string, unknown>
}

export interface RAGResult {
  hits: RAGHit[]
  context: string
  totalHits: number
  queryTime: number
}

export class RAGService {
  private prisma: PrismaClient
  private vectorDB: VectorDBClient
  private embeddingService: EmbeddingService
  private config: RAGConfig

  constructor(
    prisma: PrismaClient,
    vectorDB: VectorDBClient,
    embeddingService: EmbeddingService,
    config: RAGConfig
  ) {
    this.prisma = prisma
    this.vectorDB = vectorDB
    this.embeddingService = embeddingService
    this.config = config
  }

  /**
   * 在会话文档中检索
   */
  async searchInSession(
    sessionId: number,
    query: string
  ): Promise<RAGResult> {
    const startTime = Date.now()

    // 获取会话关联的文档
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: {
        document: true,
      },
    })

    if (sessionDocs.length === 0) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: Date.now() - startTime,
      }
    }

    // 过滤出 ready 状态的文档
    const readyDocs = sessionDocs
      .filter((sd) => sd.document.status === 'ready')
      .map((sd) => sd.document)

    if (readyDocs.length === 0) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: Date.now() - startTime,
      }
    }

    // 生成查询 embedding
    const queryVector = await this.embeddingService.embed(query)

    // 在每个文档的 collection 中搜索
    const allHits: RAGHit[] = []

    for (const doc of readyDocs) {
      if (!doc.collectionName) continue

      const results = await this.vectorDB.search(
        doc.collectionName,
        queryVector,
        this.config.topK
      )

      for (const result of results) {
        // 过滤低相关性结果
        if (result.score < this.config.relevanceThreshold) continue

        allHits.push({
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex: (result.metadata.chunkIndex as number) || 0,
          content: result.text,
          score: result.score,
          metadata: result.metadata,
        })
      }
    }

    // 按相关性排序并取 top K
    allHits.sort((a, b) => b.score - a.score)
    const topHits = allHits.slice(0, this.config.topK)

    // 构建上下文
    const context = this.buildContext(topHits)

    return {
      hits: topHits,
      context,
      totalHits: allHits.length,
      queryTime: Date.now() - startTime,
    }
  }

  /**
   * 在指定文档中检索
   */
  async searchInDocuments(
    documentIds: number[],
    query: string
  ): Promise<RAGResult> {
    const startTime = Date.now()

    // 获取文档信息
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: documentIds },
        status: 'ready',
      },
    })

    if (documents.length === 0) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: Date.now() - startTime,
      }
    }

    // 生成查询 embedding
    const queryVector = await this.embeddingService.embed(query)

    // 搜索
    const allHits: RAGHit[] = []

    for (const doc of documents) {
      if (!doc.collectionName) continue

      const results = await this.vectorDB.search(
        doc.collectionName,
        queryVector,
        this.config.topK
      )

      for (const result of results) {
        if (result.score < this.config.relevanceThreshold) continue

        allHits.push({
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex: (result.metadata.chunkIndex as number) || 0,
          content: result.text,
          score: result.score,
          metadata: result.metadata,
        })
      }
    }

    allHits.sort((a, b) => b.score - a.score)
    const topHits = allHits.slice(0, this.config.topK)
    const context = this.buildContext(topHits)

    return {
      hits: topHits,
      context,
      totalHits: allHits.length,
      queryTime: Date.now() - startTime,
    }
  }

  /**
   * 构建 RAG 上下文
   */
  private buildContext(hits: RAGHit[]): string {
    if (hits.length === 0) return ''

    const contextParts: string[] = []
    let totalTokens = 0

    for (const hit of hits) {
      // 简单估算 token（中文1.5，英文0.25）
      const estimatedTokens = this.estimateTokens(hit.content)

      if (totalTokens + estimatedTokens > this.config.maxContextTokens) {
        break
      }

      contextParts.push(
        `[来源: ${hit.documentName}]\n${hit.content}`
      )
      totalTokens += estimatedTokens
    }

    return contextParts.join('\n\n---\n\n')
  }

  /**
   * 估算 token 数量
   */
  private estimateTokens(text: string): number {
    let count = 0
    for (const char of text) {
      if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
        count += 1.5
      } else {
        count += 0.25
      }
    }
    return Math.ceil(count)
  }

  /**
   * 生成 RAG 增强的系统提示
   */
  buildRAGSystemPrompt(context: string, basePrompt?: string): string {
    const ragInstruction = `你是一个有帮助的助手。在回答问题时，请参考以下文档内容：

<documents>
${context}
</documents>

请基于上述文档内容回答用户的问题。如果文档中没有相关信息，请说明这一点。`

    if (basePrompt) {
      return `${basePrompt}\n\n${ragInstruction}`
    }

    return ragInstruction
  }

  /**
   * 检查会话是否有可用文档
   */
  async hasSessionDocuments(sessionId: number): Promise<boolean> {
    const count = await this.prisma.sessionDocument.count({
      where: {
        sessionId,
        document: {
          status: 'ready',
        },
      },
    })
    return count > 0
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取会话文档的概要信息
   */
  async getSessionDocumentOutline(sessionId: number): Promise<{
    documents: Array<{
      id: number
      name: string
      pageCount: number
      chunkCount: number
      hasPageInfo: boolean
      status: string
    }>
  }> {
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    const documents = sessionDocs.map((sd) => {
      const doc = sd.document
      const metadata = doc.metadata ? JSON.parse(doc.metadata) : {}
      return {
        id: doc.id,
        name: doc.originalName,
        pageCount: metadata.pageCount || 1,
        chunkCount: doc.chunkCount || 0,
        hasPageInfo: metadata.hasPageInfo || false,
        status: doc.status,
      }
    })

    return { documents }
  }

  /**
   * 按页码获取文档内容
   * 返回指定页码的所有chunks
   */
  async getPageContent(
    sessionId: number,
    pageNumber: number
  ): Promise<{
    pageNumber: number
    content: string
    documentName: string
    documentId: number
    chunks: Array<{
      chunkIndex: number
      content: string
    }>
  } | null> {
    // 获取会话关联的文档
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    if (sessionDocs.length === 0) {
      return null
    }

    // 查找包含该页码的文档chunks
    for (const sd of sessionDocs) {
      const doc = sd.document
      if (doc.status !== 'ready') continue

      // 查询该文档中页码匹配的chunks
      const chunks = await this.prisma.documentChunk.findMany({
        where: { documentId: doc.id },
        orderBy: { chunkIndex: 'asc' },
      })

      // 过滤出指定页码的chunks
      const pageChunks = chunks.filter((chunk) => {
        try {
          const metadata = JSON.parse(chunk.metadata || '{}')
          return metadata.pageNumber === pageNumber
        } catch {
          return false
        }
      })

      if (pageChunks.length > 0) {
        return {
          pageNumber,
          content: pageChunks.map((c) => c.content).join('\n'),
          documentName: doc.originalName,
          documentId: doc.id,
          chunks: pageChunks.map((c) => ({
            chunkIndex: c.chunkIndex,
            content: c.content,
          })),
        }
      }
    }

    return null
  }

  /**
   * 按页码范围获取文档内容
   */
  async getPageRangeContent(
    sessionId: number,
    startPage: number,
    endPage: number
  ): Promise<{
    pages: Array<{
      pageNumber: number
      content: string
      documentName: string
    }>
    totalPages: number
  }> {
    const pages: Array<{
      pageNumber: number
      content: string
      documentName: string
    }> = []

    // 获取会话关联的文档
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    for (const sd of sessionDocs) {
      const doc = sd.document
      if (doc.status !== 'ready') continue

      // 查询该文档的所有chunks
      const chunks = await this.prisma.documentChunk.findMany({
        where: { documentId: doc.id },
        orderBy: { chunkIndex: 'asc' },
      })

      // 按页码分组
      const pageMap = new Map<number, string[]>()
      for (const chunk of chunks) {
        try {
          const metadata = JSON.parse(chunk.metadata || '{}')
          const pageNum = metadata.pageNumber as number
          if (pageNum >= startPage && pageNum <= endPage) {
            if (!pageMap.has(pageNum)) {
              pageMap.set(pageNum, [])
            }
            pageMap.get(pageNum)!.push(chunk.content)
          }
        } catch {
          // 忽略解析错误
        }
      }

      // 转换为数组
      for (const [pageNum, contents] of pageMap) {
        pages.push({
          pageNumber: pageNum,
          content: contents.join('\n'),
          documentName: doc.originalName,
        })
      }
    }

    // 按页码排序
    pages.sort((a, b) => a.pageNumber - b.pageNumber)

    return {
      pages,
      totalPages: pages.length,
    }
  }

  /**
   * 获取会话中所有文档的ID列表
   */
  async getSessionDocumentIds(sessionId: number): Promise<number[]> {
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      select: { documentId: true },
    })
    return sessionDocs.map((sd) => sd.documentId)
  }
}
