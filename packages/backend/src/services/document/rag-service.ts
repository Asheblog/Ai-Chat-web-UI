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
   * 在会话文档中检索（增强版）
   * 支持不同的搜索模式
   */
  async searchInSession(
    sessionId: number,
    query: string,
    searchMode: 'precise' | 'broad' | 'overview' = 'precise'
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

    // 根据搜索模式调整参数
    let relevanceThreshold = this.config.relevanceThreshold
    let topK = this.config.topK

    switch (searchMode) {
      case 'precise':
        // 精确模式：高阈值，少结果
        relevanceThreshold = Math.max(this.config.relevanceThreshold, 0.5)
        topK = Math.min(this.config.topK, 5)
        break
      case 'broad':
        // 广泛模式：低阈值，多结果
        relevanceThreshold = Math.min(this.config.relevanceThreshold, 0.3)
        topK = Math.max(this.config.topK, 10)
        break
      case 'overview':
        // 概览模式：从不同位置采样
        relevanceThreshold = 0.2
        topK = this.config.topK
        break
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
        topK * 2 // 多取一些用于后续过滤
      )

      for (const result of results) {
        // 根据模式调整过滤
        if (result.score < relevanceThreshold) continue

        // 增强 metadata 添加页面位置信息
        const pageNumber = (result.metadata.pageNumber as number) || 0
        const totalPages = (result.metadata.totalPages as number) || 1
        let pagePosition: 'top' | 'middle' | 'bottom' = 'middle'
        if (pageNumber <= Math.ceil(totalPages * 0.2)) {
          pagePosition = 'top'
        } else if (pageNumber >= Math.ceil(totalPages * 0.8)) {
          pagePosition = 'bottom'
        }

        allHits.push({
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex: (result.metadata.chunkIndex as number) || 0,
          content: result.text,
          score: result.score,
          metadata: {
            ...result.metadata,
            pagePosition,
          },
        })
      }
    }

    // 按相关性排序
    allHits.sort((a, b) => b.score - a.score)

    let topHits: RAGHit[]

    if (searchMode === 'overview') {
      // 概览模式：从不同页面位置采样
      const topGroup = allHits.filter((h) => h.metadata.pagePosition === 'top').slice(0, 3)
      const middleGroup = allHits.filter((h) => h.metadata.pagePosition === 'middle').slice(0, 3)
      const bottomGroup = allHits.filter((h) => h.metadata.pagePosition === 'bottom').slice(0, 2)
      topHits = [...topGroup, ...middleGroup, ...bottomGroup]
    } else {
      topHits = allHits.slice(0, topK)
    }

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
   * 在指定文档中检索（增强版）
   * 支持搜索模式
   */
  async searchInDocuments(
    documentIds: number[],
    query: string,
    searchMode: 'precise' | 'broad' | 'overview' = 'precise'
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

    // 根据搜索模式调整参数
    let relevanceThreshold = this.config.relevanceThreshold
    let topK = this.config.topK

    switch (searchMode) {
      case 'precise':
        relevanceThreshold = Math.max(this.config.relevanceThreshold, 0.5)
        topK = Math.min(this.config.topK, 5)
        break
      case 'broad':
        relevanceThreshold = Math.min(this.config.relevanceThreshold, 0.3)
        topK = Math.max(this.config.topK, 10)
        break
      case 'overview':
        relevanceThreshold = 0.2
        topK = this.config.topK
        break
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
        topK * 2
      )

      for (const result of results) {
        if (result.score < relevanceThreshold) continue

        // 添加页面位置信息
        const pageNumber = (result.metadata.pageNumber as number) || 0
        const totalPages = (result.metadata.totalPages as number) || 1
        let pagePosition: 'top' | 'middle' | 'bottom' = 'middle'
        if (pageNumber <= Math.ceil(totalPages * 0.2)) {
          pagePosition = 'top'
        } else if (pageNumber >= Math.ceil(totalPages * 0.8)) {
          pagePosition = 'bottom'
        }

        allHits.push({
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex: (result.metadata.chunkIndex as number) || 0,
          content: result.text,
          score: result.score,
          metadata: {
            ...result.metadata,
            pagePosition,
          },
        })
      }
    }

    allHits.sort((a, b) => b.score - a.score)

    let topHits: RAGHit[]
    if (searchMode === 'overview') {
      // 概览模式：从不同位置采样
      const topGroup = allHits.filter((h) => h.metadata.pagePosition === 'top').slice(0, 3)
      const middleGroup = allHits.filter((h) => h.metadata.pagePosition === 'middle').slice(0, 3)
      const bottomGroup = allHits.filter((h) => h.metadata.pagePosition === 'bottom').slice(0, 2)
      topHits = [...topGroup, ...middleGroup, ...bottomGroup]
    } else {
      topHits = allHits.slice(0, topK)
    }

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
   * 获取会话文档的概要信息（增强版）
   * 包含摘要、目录结构和文档类型
   */
  async getSessionDocumentOutline(sessionId: number): Promise<{
    documents: Array<{
      id: number
      name: string
      pageCount: number
      chunkCount: number
      hasPageInfo: boolean
      status: string
      // 新增字段
      summary: string | null
      toc: Array<{ title: string; pageStart: number; pageEnd?: number }> | null
      documentType: 'code' | 'table' | 'report' | 'contract' | 'general'
    }>
  }> {
    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    const documentsWithOutline = await Promise.all(
      sessionDocs.map(async (sd) => {
        const doc = sd.document
        const metadata = doc.metadata ? JSON.parse(doc.metadata) : {}

        // 获取文档类型（基于 mimeType 和文件扩展名）
        let documentType: 'code' | 'table' | 'report' | 'contract' | 'general' = 'general'
        const ext = doc.originalName.split('.').pop()?.toLowerCase() || ''
        if (['js', 'ts', 'py', 'java', 'css', 'html', 'json', 'jsx', 'tsx'].includes(ext)) {
          documentType = 'code'
        } else if (['csv'].includes(ext)) {
          documentType = 'table'
        } else if (doc.mimeType === 'application/pdf') {
          // 尝试检测合同关键词
          documentType = 'report'
        }

        // 生成摘要：使用首个和最后一个 chunk 的内容
        let summary: string | null = null
        if (doc.status === 'ready' && doc.chunkCount && doc.chunkCount > 0) {
          try {
            const chunks = await this.prisma.documentChunk.findMany({
              where: { documentId: doc.id },
              orderBy: { chunkIndex: 'asc' },
              take: 2,
            })
            if (chunks.length > 0) {
              const firstContent = chunks[0].content.substring(0, 200)
              summary = `${firstContent}${chunks[0].content.length > 200 ? '...' : ''}`
            }
          } catch {
            // 忽略获取 chunk 的错误
          }
        }

        // 提取目录结构（从 metadata 或分析 chunk 标题）
        let toc: Array<{ title: string; pageStart: number; pageEnd?: number }> | null = null
        if (metadata.toc) {
          toc = metadata.toc
        }

        return {
          id: doc.id,
          name: doc.originalName,
          pageCount: metadata.pageCount || 1,
          chunkCount: doc.chunkCount || 0,
          hasPageInfo: metadata.hasPageInfo || false,
          status: doc.status,
          summary,
          toc,
          documentType,
        }
      })
    )

    return { documents: documentsWithOutline }
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
