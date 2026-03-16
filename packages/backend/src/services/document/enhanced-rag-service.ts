/**
 * 增强版 RAG 检索服务
 * 支持相邻 chunk 聚合和按章节分组
 */

import type { PrismaClient } from '@prisma/client'
import type { RAGHit, RAGResult, RAGConfig } from './rag-service'
import type { EmbeddingService } from './embedding-service'
import type { VectorDBClient } from '../../modules/document/vector'

export interface EnhancedRAGHit extends RAGHit {
  // 章节信息
  section?: {
    id: number
    title: string
    path: string
    level: number
  }
  // 聚合信息
  aggregatedFrom?: number[]  // 合并的chunk索引
  contextBefore?: string
  contextAfter?: string
}

export interface EnhancedRAGResult extends RAGResult {
  hits: EnhancedRAGHit[]
  // 按章节分组的结果
  groupedBySection?: Map<string, EnhancedRAGHit[]>
  // 聚合统计
  aggregationStats?: {
    originalHits: number
    afterAggregation: number
    mergedGroups: number
  }
}

export interface EnhancedSearchOptions {
  mode: 'precise' | 'broad' | 'section' | 'overview'
  aggregateAdjacent: boolean     // 合并相邻chunk
  groupBySection: boolean        // 按章节分组
  includeContext: boolean        // 包含上下文
  contextSize: number            // 上下文大小（chunk数）
  topK?: number
  relevanceThreshold?: number
  ensureDocumentCoverage?: boolean
  perDocumentK?: number
}

const DEFAULT_OPTIONS: EnhancedSearchOptions = {
  mode: 'precise',
  aggregateAdjacent: true,
  groupBySection: true,
  includeContext: true,
  contextSize: 1,
  ensureDocumentCoverage: false,
}

/**
 * 相邻 chunk 聚合
 * 将相邻的搜索结果合并成连续内容
 */
function aggregateAdjacentChunks(
  hits: EnhancedRAGHit[],
  maxGap: number = 1
): EnhancedRAGHit[] {
  if (hits.length === 0) return []
  
  // 按文档分组
  const byDocument = new Map<number, EnhancedRAGHit[]>()
  for (const hit of hits) {
    const docHits = byDocument.get(hit.documentId) || []
    docHits.push(hit)
    byDocument.set(hit.documentId, docHits)
  }
  
  const result: EnhancedRAGHit[] = []
  
  for (const [docId, docHits] of byDocument) {
    // 按 chunkIndex 排序
    docHits.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    let current: EnhancedRAGHit | null = null
    
    for (const hit of docHits) {
      if (!current) {
        // 开始新的聚合组
        current = {
          ...hit,
          aggregatedFrom: [hit.chunkIndex],
        }
      } else {
        // 检查是否相邻
        const lastChunk = current.aggregatedFrom![current.aggregatedFrom!.length - 1]
        const gap = hit.chunkIndex - lastChunk
        
        if (gap <= maxGap) {
          // 相邻，合并内容
          current.content += '\n\n' + hit.content
          current.score = Math.max(current.score, hit.score)
          current.aggregatedFrom!.push(hit.chunkIndex)
          
          // 合并 section 信息（优先使用更高层级的）
          if (hit.section && (!current.section || hit.section.level < current.section.level)) {
            current.section = hit.section
          }
        } else {
          // 不相邻，保存当前聚合组，开始新的
          result.push(current)
          current = {
            ...hit,
            aggregatedFrom: [hit.chunkIndex],
          }
        }
      }
    }
    
    // 保存最后一个聚合组
    if (current) {
      result.push(current)
    }
  }
  
  // 按分数排序
  result.sort((a, b) => b.score - a.score)
  
  return result
}

export function aggregateAdjacentChunksForTest(
  hits: EnhancedRAGHit[],
  maxGap: number = 1
): EnhancedRAGHit[] {
  return aggregateAdjacentChunks(hits, maxGap)
}

/**
 * 按章节分组搜索结果
 */
function groupHitsBySection(
  hits: EnhancedRAGHit[]
): Map<string, EnhancedRAGHit[]> {
  const groups = new Map<string, EnhancedRAGHit[]>()
  
  for (const hit of hits) {
    const key = hit.section ? `${hit.documentId}:${hit.section.path}` : `${hit.documentId}:unknown`
    const group = groups.get(key) || []
    group.push(hit)
    groups.set(key, group)
  }
  
  return groups
}

/**
 * 概览采样：按文档位置采样
 */
function buildOverviewEnhancedHitsByDocument(
  hits: EnhancedRAGHit[]
): EnhancedRAGHit[] {
  const byDocument = new Map<number, EnhancedRAGHit[]>()
  for (const hit of hits) {
    const list = byDocument.get(hit.documentId) || []
    list.push(hit)
    byDocument.set(hit.documentId, list)
  }

  const sampled: EnhancedRAGHit[] = []
  for (const docHits of byDocument.values()) {
    const topGroup = docHits.filter((h) => h.metadata.pagePosition === 'top').slice(0, 2)
    const middleGroup = docHits.filter((h) => h.metadata.pagePosition === 'middle').slice(0, 2)
    const bottomGroup = docHits.filter((h) => h.metadata.pagePosition === 'bottom').slice(0, 1)
    sampled.push(...topGroup, ...middleGroup, ...bottomGroup)
  }

  return sampled.sort((a, b) => b.score - a.score)
}

/**
 * 按文档均衡采样
 */
function balanceEnhancedHitsByDocument(
  hits: EnhancedRAGHit[],
  topK: number,
  perDocumentK?: number
): EnhancedRAGHit[] {
  const byDocument = new Map<number, EnhancedRAGHit[]>()
  for (const hit of hits) {
    const list = byDocument.get(hit.documentId) || []
    list.push(hit)
    byDocument.set(hit.documentId, list)
  }

  const docCount = byDocument.size
  if (docCount === 0) return []
  const perDoc = Math.max(1, perDocumentK || Math.min(2, Math.ceil(topK / docCount)))

  const selected: EnhancedRAGHit[] = []
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

export class EnhancedRAGService {
  private prisma: any  // 使用 any 以兼容 Prisma 生成前后
  private vectorDB: VectorDBClient
  private embeddingService: EmbeddingService
  private config: RAGConfig
  
  constructor(
    prisma: PrismaClient,
    vectorDB: VectorDBClient,
    embeddingService: EmbeddingService,
    config: RAGConfig
  ) {
    this.prisma = prisma as any
    this.vectorDB = vectorDB
    this.embeddingService = embeddingService
    this.config = config
  }
  
  /**
   * 增强版语义搜索
   * 支持相邻 chunk 聚合和章节分组
   */
  async search(
    documentIds: number[],
    query: string,
    options: Partial<EnhancedSearchOptions> = {}
  ): Promise<EnhancedRAGResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options }
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
    let relevanceThreshold = opts.relevanceThreshold ?? this.config.relevanceThreshold
    let topK = opts.topK ?? this.config.topK
    
    switch (opts.mode) {
      case 'precise':
        relevanceThreshold = Math.max(relevanceThreshold, 0.5)
        topK = Math.min(topK, 5)
        break
      case 'broad':
        relevanceThreshold = Math.min(relevanceThreshold, 0.3)
        topK = Math.max(topK, 10)
        break
      case 'section':
        relevanceThreshold = Math.min(relevanceThreshold, 0.4)
        topK = Math.max(topK, 15)
        break
      case 'overview':
        relevanceThreshold = Math.min(relevanceThreshold, 0.25)
        topK = Math.max(topK, 10)
        break
    }
    
    // 生成查询 embedding
    const queryVector = await this.embeddingService.embed(query)
    
    // 并行搜索所有文档
    const validDocs = documents.filter((doc: any) => doc.collectionName)
    const allHits: EnhancedRAGHit[] = []
    
    const searchPromises = validDocs.map(async (doc: any) => {
      const results = await this.vectorDB.search(
        doc.collectionName!,
        queryVector,
        topK * 3  // 多取一些用于聚合
      )
      return { doc, results }
    })
    
    const searchResults = await Promise.all(searchPromises)
    
    // 处理搜索结果
    for (const { doc, results } of searchResults) {
      for (const result of results) {
        if (result.score < relevanceThreshold) continue
        
        const chunkIndex = (result.metadata.chunkIndex as number) || 0
        
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
          chunkIndex,
          content: result.text,
          score: result.score,
          metadata: {
            ...result.metadata,
            pagePosition,
          },
        })
      }
    }

    if (opts.groupBySection && allHits.length > 0) {
      await this.attachSectionInfo(allHits)
    }
    
    // 记录原始命中数
    const originalHits = allHits.length
    
    // 相邻 chunk 聚合
    let processedHits = allHits
    let mergedGroups = 0
    
    if (opts.aggregateAdjacent) {
      processedHits = aggregateAdjacentChunks(allHits)
      mergedGroups = originalHits - processedHits.length
    }

    const ensureCoverage =
      opts.ensureDocumentCoverage ?? (opts.mode === 'overview' && documentIds.length > 1)
    let selectedHits = processedHits

    if (opts.mode === 'overview') {
      const overviewHits = buildOverviewEnhancedHitsByDocument(processedHits)
      selectedHits = ensureCoverage
        ? balanceEnhancedHitsByDocument(overviewHits, topK, opts.perDocumentK)
        : overviewHits.slice(0, topK)
    } else if (ensureCoverage) {
      selectedHits = balanceEnhancedHitsByDocument(processedHits, topK, opts.perDocumentK)
    } else {
      selectedHits = processedHits.slice(0, topK)
    }

    // 添加上下文
    if (opts.includeContext && opts.contextSize > 0) {
      selectedHits = await this.addContext(selectedHits, opts.contextSize)
    }
    
    // 按章节分组
    let groupedBySection: Map<string, EnhancedRAGHit[]> | undefined
    if (opts.groupBySection) {
      groupedBySection = groupHitsBySection(selectedHits)
    }
    
    // 构建上下文
    const context = this.buildEnhancedContext(selectedHits, groupedBySection)
    
    return {
      hits: selectedHits,
      context,
      totalHits: originalHits,
      queryTime: Date.now() - startTime,
      groupedBySection,
      aggregationStats: {
        originalHits,
        afterAggregation: selectedHits.length,
        mergedGroups,
      },
    }
  }
  
  /**
   * 为命中结果批量补充章节信息，避免 N+1 查询。
   */
  private async attachSectionInfo(hits: EnhancedRAGHit[]): Promise<void> {
    const byDocument = new Map<number, Set<number>>()
    for (const hit of hits) {
      if (!byDocument.has(hit.documentId)) {
        byDocument.set(hit.documentId, new Set<number>())
      }
      byDocument.get(hit.documentId)!.add(hit.chunkIndex)
    }

    const whereOr = Array.from(byDocument.entries()).map(([documentId, chunkSet]) => ({
      documentId,
      chunkIndex: { in: Array.from(chunkSet.values()) },
    }))

    if (whereOr.length === 0) return

    try {
      const rows = await this.prisma.documentChunk.findMany({
        where: { OR: whereOr },
        select: {
          documentId: true,
          chunkIndex: true,
          section: {
            select: {
              id: true,
              title: true,
              path: true,
              level: true,
            },
          },
        },
      })

      const sectionMap = new Map<string, EnhancedRAGHit['section']>()
      for (const row of rows as Array<any>) {
        const key = `${row.documentId}:${row.chunkIndex}`
        const section = row.section
          ? {
              id: row.section.id,
              title: row.section.title,
              path: row.section.path,
              level: row.section.level,
            }
          : undefined
        sectionMap.set(key, section)
      }

      for (const hit of hits) {
        hit.section = sectionMap.get(`${hit.documentId}:${hit.chunkIndex}`)
      }
    } catch {
      // section 表可能尚未创建
    }
  }

  /**
   * 添加上下文 chunks（批量）
   */
  private async addContext(
    hits: EnhancedRAGHit[],
    contextSize: number
  ): Promise<EnhancedRAGHit[]> {
    if (hits.length === 0 || contextSize <= 0) {
      return hits
    }

    const neededByDocument = new Map<number, Set<number>>()

    for (const hit of hits) {
      const indices = hit.aggregatedFrom && hit.aggregatedFrom.length > 0
        ? [...hit.aggregatedFrom].sort((a, b) => a - b)
        : [hit.chunkIndex]
      const minChunk = indices[0]
      const maxChunk = indices[indices.length - 1]
      if (!neededByDocument.has(hit.documentId)) {
        neededByDocument.set(hit.documentId, new Set<number>())
      }
      const set = neededByDocument.get(hit.documentId)!
      for (let i = Math.max(0, minChunk - contextSize); i < minChunk; i++) {
        set.add(i)
      }
      for (let i = maxChunk + 1; i <= maxChunk + contextSize; i++) {
        set.add(i)
      }
    }

    const rowsList = await Promise.all(
      Array.from(neededByDocument.entries()).map(async ([documentId, indexSet]) => {
        const chunkIndexes = Array.from(indexSet.values())
        if (chunkIndexes.length === 0) return []
        return this.prisma.documentChunk.findMany({
          where: {
            documentId,
            chunkIndex: { in: chunkIndexes },
          },
          select: {
            documentId: true,
            chunkIndex: true,
            content: true,
          },
        })
      })
    )

    const chunkMap = new Map<string, string>()
    for (const rows of rowsList) {
      for (const row of rows as Array<any>) {
        chunkMap.set(`${row.documentId}:${row.chunkIndex}`, row.content || '')
      }
    }

    return hits.map((hit) => {
      const indices = hit.aggregatedFrom && hit.aggregatedFrom.length > 0
        ? [...hit.aggregatedFrom].sort((a, b) => a - b)
        : [hit.chunkIndex]
      const minChunk = indices[0]
      const maxChunk = indices[indices.length - 1]

      const beforeParts: string[] = []
      for (let i = Math.max(0, minChunk - contextSize); i < minChunk; i++) {
        const content = chunkMap.get(`${hit.documentId}:${i}`)
        if (content) beforeParts.push(content)
      }

      const afterParts: string[] = []
      for (let i = maxChunk + 1; i <= maxChunk + contextSize; i++) {
        const content = chunkMap.get(`${hit.documentId}:${i}`)
        if (content) afterParts.push(content)
      }

      return {
        ...hit,
        contextBefore: beforeParts.join('\n'),
        contextAfter: afterParts.join('\n'),
      }
    })
  }
  
  /**
   * 构建增强的上下文
   * 按章节组织内容
   */
  private buildEnhancedContext(
    hits: EnhancedRAGHit[],
    groupedBySection?: Map<string, EnhancedRAGHit[]>
  ): string {
    if (hits.length === 0) return ''
    
    const parts: string[] = []
    let totalTokens = 0
    
    if (groupedBySection && groupedBySection.size > 0) {
      // 按章节组织
      for (const [key, sectionHits] of groupedBySection) {
        const firstHit = sectionHits[0]
        const sectionTitle = firstHit.section?.title || '未知章节'
        const docName = firstHit.documentName
        
        const sectionContent = sectionHits
          .map(h => {
            let content = h.content
            if (h.contextBefore) content = h.contextBefore + '\n\n' + content
            if (h.contextAfter) content = content + '\n\n' + h.contextAfter
            return content
          })
          .join('\n\n')
        
        const tokens = this.estimateTokens(sectionContent)
        if (totalTokens + tokens > this.config.maxContextTokens) break
        
        parts.push(`## ${sectionTitle}\n**来源: ${docName}**\n\n${sectionContent}`)
        totalTokens += tokens
      }
    } else {
      // 普通模式
      for (const hit of hits) {
        let content = hit.content
        if (hit.contextBefore) content = hit.contextBefore + '\n\n' + content
        if (hit.contextAfter) content = content + '\n\n' + hit.contextAfter
        
        const tokens = this.estimateTokens(content)
        if (totalTokens + tokens > this.config.maxContextTokens) break
        
        const pageNumber =
          typeof (hit.metadata as any)?.pageNumber === 'number'
            ? (hit.metadata as any).pageNumber
            : null
        const pageLabel = pageNumber ? `, 页码: ${pageNumber}` : ''
        const sectionInfo = hit.section ? ` (${hit.section.title})` : ''
        parts.push(`[来源: ${hit.documentName}${sectionInfo}${pageLabel}]\n${content}`)
        totalTokens += tokens
      }
    }
    
    return parts.join('\n\n---\n\n')
  }
  
  /**
   * 按章节搜索
   * 返回匹配的章节列表
   */
  async searchSections(
    documentIds: number[],
    query: string,
    topK: number = 5
  ): Promise<Array<{
    sectionId: number
    sectionTitle: string
    sectionPath: string
    documentId: number
    documentName: string
    relevanceScore: number
    matchedChunks: number
    preview: string
  }>> {
    // 先进行常规搜索
    const result = await this.search(documentIds, query, {
      mode: 'section',
      aggregateAdjacent: true,
      groupBySection: true,
      topK: topK * 3,
    })
    
    if (!result.groupedBySection) return []
    
    // 转换为章节级结果
    const sectionResults: Array<{
      sectionId: number
      sectionTitle: string
      sectionPath: string
      documentId: number
      documentName: string
      relevanceScore: number
      matchedChunks: number
      preview: string
    }> = []
    
    for (const [key, hits] of result.groupedBySection) {
      const firstHit = hits[0]
      if (!firstHit.section) continue
      
      const avgScore = hits.reduce((sum, h) => sum + h.score, 0) / hits.length
      const preview = hits[0].content.substring(0, 200) + '...'
      
      sectionResults.push({
        sectionId: firstHit.section.id,
        sectionTitle: firstHit.section.title,
        sectionPath: firstHit.section.path,
        documentId: firstHit.documentId,
        documentName: firstHit.documentName,
        relevanceScore: avgScore,
        matchedChunks: hits.length,
        preview,
      })
    }
    
    // 按相关性排序
    sectionResults.sort((a, b) => b.relevanceScore - a.relevanceScore)
    
    return sectionResults.slice(0, topK)
  }
  
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
}
