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
  mode: 'precise' | 'broad' | 'section'
  aggregateAdjacent: boolean     // 合并相邻chunk
  groupBySection: boolean        // 按章节分组
  includeContext: boolean        // 包含上下文
  contextSize: number            // 上下文大小（chunk数）
  topK?: number
  relevanceThreshold?: number
}

const DEFAULT_OPTIONS: EnhancedSearchOptions = {
  mode: 'precise',
  aggregateAdjacent: true,
  groupBySection: true,
  includeContext: true,
  contextSize: 1,
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
        
        if (gap <= maxGap + 1) {
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
        
        // 获取 chunk 的章节信息
        let sectionInfo: EnhancedRAGHit['section'] | undefined
        
        if (opts.groupBySection) {
          try {
            const chunk = await this.prisma.documentChunk.findFirst({
              where: {
                documentId: doc.id,
                chunkIndex,
              },
              include: {
                section: true,
              },
            })
            
            if (chunk?.section) {
              sectionInfo = {
                id: chunk.section.id,
                title: chunk.section.title,
                path: chunk.section.path,
                level: chunk.section.level,
              }
            }
          } catch {
            // section 表可能尚未创建
          }
        }
        
        allHits.push({
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex,
          content: result.text,
          score: result.score,
          metadata: result.metadata,
          section: sectionInfo,
        })
      }
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
    
    // 取 topK
    processedHits = processedHits.slice(0, topK)
    
    // 添加上下文
    if (opts.includeContext && opts.contextSize > 0) {
      processedHits = await this.addContext(processedHits, opts.contextSize)
    }
    
    // 按章节分组
    let groupedBySection: Map<string, EnhancedRAGHit[]> | undefined
    if (opts.groupBySection) {
      groupedBySection = groupHitsBySection(processedHits)
    }
    
    // 构建上下文
    const context = this.buildEnhancedContext(processedHits, groupedBySection)
    
    return {
      hits: processedHits,
      context,
      totalHits: originalHits,
      queryTime: Date.now() - startTime,
      groupedBySection,
      aggregationStats: {
        originalHits,
        afterAggregation: processedHits.length,
        mergedGroups,
      },
    }
  }
  
  /**
   * 添加上下文 chunks
   */
  private async addContext(
    hits: EnhancedRAGHit[],
    contextSize: number
  ): Promise<EnhancedRAGHit[]> {
    const result: EnhancedRAGHit[] = []
    
    for (const hit of hits) {
      const minChunk = Math.min(...(hit.aggregatedFrom || [hit.chunkIndex]))
      const maxChunk = Math.max(...(hit.aggregatedFrom || [hit.chunkIndex]))
      
      // 获取前后 context
      const [beforeChunks, afterChunks] = await Promise.all([
        this.prisma.documentChunk.findMany({
          where: {
            documentId: hit.documentId,
            chunkIndex: {
              gte: Math.max(0, minChunk - contextSize),
              lt: minChunk,
            },
          },
          orderBy: { chunkIndex: 'asc' },
        }),
        this.prisma.documentChunk.findMany({
          where: {
            documentId: hit.documentId,
            chunkIndex: {
              gt: maxChunk,
              lte: maxChunk + contextSize,
            },
          },
          orderBy: { chunkIndex: 'asc' },
        }),
      ])
      
      result.push({
        ...hit,
        contextBefore: beforeChunks.map((c: any) => c.content).join('\n'),
        contextAfter: afterChunks.map((c: any) => c.content).join('\n'),
      })
    }
    
    return result
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
        
        const sectionInfo = hit.section ? ` (${hit.section.title})` : ''
        parts.push(`[来源: ${hit.documentName}${sectionInfo}]\n${content}`)
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