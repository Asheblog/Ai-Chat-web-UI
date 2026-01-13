/**
 * RAG 检索服务
 * 提供文档检索和上下文增强功能
 */

import { PrismaClient } from '@prisma/client'
import { EmbeddingService } from './embedding-service'
import { type VectorDBClient } from '../../modules/document/vector'
import { createLogger } from '../../utils/logger'

const log = createLogger('RAG')

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
    searchMode: 'precise' | 'broad' | 'overview' = 'precise',
    options: {
      ensureDocumentCoverage?: boolean
      perDocumentK?: number
    } = {}
  ): Promise<RAGResult> {
    const startTime = Date.now()

    const sessionDocs = await this.prisma.sessionDocument.findMany({
      where: { sessionId },
      include: { document: true },
    })

    const readyDocIds = sessionDocs
      .filter((sd) => sd.document.status === 'ready')
      .map((sd) => sd.documentId)

    if (readyDocIds.length === 0) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: Date.now() - startTime,
      }
    }

    return this.searchInDocuments(readyDocIds, query, searchMode, options)
  }

  /**
   * 在指定文档中检索（增强版）
   * 支持搜索模式
   */
  async searchInDocuments(
    documentIds: number[],
    query: string,
    searchMode: 'precise' | 'broad' | 'overview' = 'precise',
    options: {
      ensureDocumentCoverage?: boolean
      perDocumentK?: number
    } = {}
  ): Promise<RAGResult> {
    const startTime = Date.now()
    const timings: Record<string, number> = {}

    // 获取文档信息
    const dbQueryStart = Date.now()
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: documentIds },
        status: 'ready',
      },
    })
    timings.dbQuery = Date.now() - dbQueryStart

    if (documents.length === 0) {
      log.debug('searchInDocuments: no documents found', { documentIds, timings })
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
        topK = Math.max(this.config.topK, 8)
        break
    }

    // 生成查询 embedding
    const embeddingStart = Date.now()
    const queryVector = await this.embeddingService.embed(query)
    timings.embedding = Date.now() - embeddingStart

    // 并行搜索所有文档（性能优化：避免串行等待）
    const allHits: RAGHit[] = []
    const vectorSearchStart = Date.now()
    const docSearchTimings: Array<{ docId: number; collectionName: string; timeMs: number; resultCount: number }> = []

    // 过滤有效文档
    const validDocs = documents.filter((doc) => doc.collectionName)

    // 并行执行所有文档的向量搜索
    const fetchK =
      searchMode === 'overview' || options.ensureDocumentCoverage ? topK * 3 : topK * 2

    const searchPromises = validDocs.map(async (doc) => {
      const docSearchStart = Date.now()
      const results = await this.vectorDB.search(
        doc.collectionName!,
        queryVector,
        fetchK
      )
      const timeMs = Date.now() - docSearchStart

      return {
        doc,
        results,
        timeMs,
      }
    })

    // 等待所有搜索完成
    const searchResults = await Promise.all(searchPromises)

    // 处理搜索结果
    for (const { doc, results, timeMs } of searchResults) {
      docSearchTimings.push({
        docId: doc.id,
        collectionName: doc.collectionName!,
        timeMs,
        resultCount: results.length,
      })

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

    timings.vectorSearchTotal = Date.now() - vectorSearchStart

    allHits.sort((a, b) => b.score - a.score)

    const ensureCoverage =
      options.ensureDocumentCoverage ?? (searchMode === 'overview' && documents.length > 1)
    let topHits: RAGHit[] = []

    if (searchMode === 'overview') {
      const overviewHits = this.buildOverviewHitsByDocument(allHits)
      topHits = ensureCoverage
        ? this.balanceHitsByDocument(overviewHits, topK, options.perDocumentK)
        : overviewHits.slice(0, topK)
    } else if (ensureCoverage) {
      topHits = this.balanceHitsByDocument(allHits, topK, options.perDocumentK)
    } else {
      topHits = allHits.slice(0, topK)
    }

    const context = this.buildContext(topHits)
    timings.total = Date.now() - startTime

    // 性能诊断日志 (debug 级别，生产环境不输出)
    log.debug('searchInDocuments completed', {
      documentCount: documents.length,
      totalChunksSearched: docSearchTimings.reduce((sum, d) => sum + d.resultCount, 0),
      searchMode,
      timings: {
        dbQueryMs: timings.dbQuery,
        embeddingMs: timings.embedding,
        vectorSearchTotalMs: timings.vectorSearchTotal,
        totalMs: timings.total,
      },
      slowestDocs: docSearchTimings
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, 3)
        .map((d) => `${d.collectionName}: ${d.timeMs}ms`),
    })

    return {
      hits: topHits,
      context,
      totalHits: allHits.length,
      queryTime: Date.now() - startTime,
    }
  }

  /**
   * 概览模式：按文档位置采样
   */
  private buildOverviewHitsByDocument(hits: RAGHit[]): RAGHit[] {
    const byDocument = new Map<number, RAGHit[]>()
    for (const hit of hits) {
      const list = byDocument.get(hit.documentId) || []
      list.push(hit)
      byDocument.set(hit.documentId, list)
    }

    const sampled: RAGHit[] = []
    for (const docHits of byDocument.values()) {
      const topGroup = docHits.filter((h) => h.metadata.pagePosition === 'top').slice(0, 2)
      const middleGroup = docHits.filter((h) => h.metadata.pagePosition === 'middle').slice(0, 2)
      const bottomGroup = docHits.filter((h) => h.metadata.pagePosition === 'bottom').slice(0, 1)
      sampled.push(...topGroup, ...middleGroup, ...bottomGroup)
    }

    return sampled.sort((a, b) => b.score - a.score)
  }

  /**
   * 按文档均衡采样，保证覆盖多个文档
   */
  private balanceHitsByDocument(
    hits: RAGHit[],
    topK: number,
    perDocumentK?: number
  ): RAGHit[] {
    const byDocument = new Map<number, RAGHit[]>()
    for (const hit of hits) {
      const list = byDocument.get(hit.documentId) || []
      list.push(hit)
      byDocument.set(hit.documentId, list)
    }

    const docCount = byDocument.size
    if (docCount === 0) return []
    const perDoc = Math.max(
      1,
      perDocumentK || Math.min(2, Math.ceil(topK / docCount))
    )

    const selected: RAGHit[] = []
    const selectedKeys = new Set<string>()

    for (const docHits of byDocument.values()) {
      const sorted = [...docHits].sort((a, b) => b.score - a.score)
      for (const hit of sorted.slice(0, perDoc)) {
        const key = `${hit.documentId}:${hit.chunkIndex}`
        if (!selectedKeys.has(key)) {
          selected.push(hit)
          selectedKeys.add(key)
        }
      }
    }

    if (selected.length >= topK) {
      return selected.slice(0, topK)
    }

    for (const hit of hits) {
      const key = `${hit.documentId}:${hit.chunkIndex}`
      if (selectedKeys.has(key)) continue
      selected.push(hit)
      if (selected.length >= topK) break
    }

    return selected
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

      const pageNumber =
        typeof (hit.metadata as any)?.pageNumber === 'number'
          ? (hit.metadata as any).pageNumber
          : null
      const pageLabel = pageNumber ? `, 页码: ${pageNumber}` : ''
      contextParts.push(`[来源: ${hit.documentName}${pageLabel}]\n${hit.content}`)
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

}
