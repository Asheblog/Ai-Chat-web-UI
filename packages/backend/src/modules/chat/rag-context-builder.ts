/**
 * RAG 文档检索辅助模块
 * 用于在聊天流程中集成文档检索功能
 */

import type { RAGService, RAGResult, RAGHit } from '../../services/document/rag-service'
import { KnowledgeBaseService } from '../../services/knowledge-base'
import { prisma } from '../../db'

/**
 * 文档检索 Tool 事件类型
 */
export interface DocumentSearchToolEvent {
  type: 'tool'
  tool: 'document_search' | 'knowledge_base_search'
  stage: 'start' | 'result' | 'error'
  id: string
  query?: string
  hits?: Array<{
    documentId: number
    documentName: string
    content: string
    score: number
    chunkIndex: number
  }>
  totalHits?: number
  queryTime?: number
  error?: string
  knowledgeBaseNames?: string[]
}

/**
 * 创建文档检索工具事件
 */
export function createDocumentSearchStartEvent(
  id: string,
  query: string
): DocumentSearchToolEvent {
  return {
    type: 'tool',
    tool: 'document_search',
    stage: 'start',
    id,
    query,
  }
}

export function createDocumentSearchResultEvent(
  id: string,
  result: RAGResult
): DocumentSearchToolEvent {
  return {
    type: 'tool',
    tool: 'document_search',
    stage: 'result',
    id,
    hits: result.hits.map((hit) => ({
      documentId: hit.documentId,
      documentName: hit.documentName,
      content: hit.content.slice(0, 500), // 截断内容
      score: Math.round(hit.score * 100) / 100,
      chunkIndex: hit.chunkIndex,
    })),
    totalHits: result.totalHits,
    queryTime: result.queryTime,
  }
}

export function createDocumentSearchErrorEvent(
  id: string,
  error: string
): DocumentSearchToolEvent {
  return {
    type: 'tool',
    tool: 'document_search',
    stage: 'error',
    id,
    error,
  }
}

/**
 * 创建知识库检索工具事件
 */
export function createKnowledgeBaseSearchStartEvent(
  id: string,
  query: string,
  knowledgeBaseNames: string[]
): DocumentSearchToolEvent {
  return {
    type: 'tool',
    tool: 'knowledge_base_search',
    stage: 'start',
    id,
    query,
    knowledgeBaseNames,
  }
}

export function createKnowledgeBaseSearchResultEvent(
  id: string,
  result: RAGResult,
  knowledgeBaseNames: string[]
): DocumentSearchToolEvent {
  return {
    type: 'tool',
    tool: 'knowledge_base_search',
    stage: 'result',
    id,
    hits: result.hits.map((hit) => ({
      documentId: hit.documentId,
      documentName: hit.documentName,
      content: hit.content.slice(0, 500),
      score: Math.round(hit.score * 100) / 100,
      chunkIndex: hit.chunkIndex,
    })),
    totalHits: result.totalHits,
    queryTime: result.queryTime,
    knowledgeBaseNames,
  }
}

/**
 * RAG 增强上下文构建器
 */
export class RAGContextBuilder {
  private ragService: RAGService
  private kbService: KnowledgeBaseService

  constructor(ragService: RAGService) {
    this.ragService = ragService
    this.kbService = new KnowledgeBaseService(prisma)
  }

  /**
   * 检查会话是否需要 RAG 增强
   */
  async shouldEnhance(sessionId: number): Promise<boolean> {
    return this.ragService.hasSessionDocuments(sessionId)
  }

  /**
   * 检查是否有可用的知识库
   */
  async hasKnowledgeBases(knowledgeBaseIds: number[]): Promise<boolean> {
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return false
    // 验证至少有一个知识库存在且有文档
    for (const kbId of knowledgeBaseIds) {
      const kb = await this.kbService.get(kbId)
      // KnowledgeBaseWithDocuments 包含 documents 数组，检查其长度
      if (kb && kb.documents && kb.documents.length > 0) return true
    }
    return false
  }

  /**
   * 执行检索并返回增强上下文
   */
  async enhance(
    sessionId: number,
    query: string,
    onEvent?: (event: DocumentSearchToolEvent) => void
  ): Promise<{
    context: string
    result: RAGResult
  }> {
    const searchId = `search_${Date.now()}`

    // 发送开始事件
    if (onEvent) {
      onEvent(createDocumentSearchStartEvent(searchId, query))
    }

    try {
      // 执行检索
      const result = await this.ragService.searchInSession(sessionId, query)

      // 发送结果事件
      if (onEvent) {
        onEvent(createDocumentSearchResultEvent(searchId, result))
      }

      // 构建上下文
      const context = result.context

      return { context, result }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Search failed'

      if (onEvent) {
        onEvent(createDocumentSearchErrorEvent(searchId, errorMessage))
      }

      throw error
    }
  }

  /**
   * 在知识库中执行检索
   */
  async enhanceFromKnowledgeBases(
    knowledgeBaseIds: number[],
    query: string,
    onEvent?: (event: DocumentSearchToolEvent) => void
  ): Promise<{
    context: string
    result: RAGResult
  }> {
    const searchId = `kb_search_${Date.now()}`

    // 获取知识库名称 (KnowledgeBase 类型包含 name 字段)
    const kbNames: string[] = []
    for (const kbId of knowledgeBaseIds) {
      const kb = await this.kbService.get(kbId)
      if (kb) kbNames.push((kb as any).name)
    }

    // 发送开始事件
    if (onEvent) {
      onEvent(createKnowledgeBaseSearchStartEvent(searchId, query, kbNames))
    }

    try {
      // 执行知识库检索
      const result = await this.kbService.search(knowledgeBaseIds, query)

      // 发送结果事件
      if (onEvent) {
        onEvent(createKnowledgeBaseSearchResultEvent(searchId, result, kbNames))
      }

      // 构建上下文
      const context = result.context

      return { context, result }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Knowledge base search failed'

      if (onEvent) {
        onEvent(createDocumentSearchErrorEvent(searchId, errorMessage))
      }

      throw error
    }
  }

  /**
   * 组合检索：同时检索会话文档和知识库
   */
  async enhanceCombined(
    sessionId: number,
    knowledgeBaseIds: number[],
    query: string,
    onEvent?: (event: DocumentSearchToolEvent) => void
  ): Promise<{
    context: string
    sessionResult?: RAGResult
    kbResult?: RAGResult
  }> {
    let sessionContext = ''
    let kbContext = ''
    let sessionResult: RAGResult | undefined
    let kbResult: RAGResult | undefined

    // 检索会话文档
    const hasSessionDocs = await this.shouldEnhance(sessionId)
    if (hasSessionDocs) {
      try {
        const result = await this.enhance(sessionId, query, onEvent)
        sessionContext = result.context
        sessionResult = result.result
      } catch (error) {
        // 忽略会话文档检索错误，继续知识库检索
      }
    }

    // 检索知识库
    const hasKbs = await this.hasKnowledgeBases(knowledgeBaseIds)
    if (hasKbs) {
      try {
        const result = await this.enhanceFromKnowledgeBases(knowledgeBaseIds, query, onEvent)
        kbContext = result.context
        kbResult = result.result
      } catch (error) {
        // 忽略知识库检索错误
      }
    }

    // 组合上下文
    let combinedContext = ''
    if (sessionContext && kbContext) {
      combinedContext = `${sessionContext}\n\n---\n\n${kbContext}`
    } else {
      combinedContext = sessionContext || kbContext
    }

    return {
      context: combinedContext,
      sessionResult,
      kbResult,
    }
  }

  /**
   * 构建 RAG 系统提示
   */
  buildSystemPrompt(context: string, basePrompt?: string): string {
    return this.ragService.buildRAGSystemPrompt(context, basePrompt || undefined)
  }
}

/**
 * 将 RAG 结果转换为 tool logs JSON 格式
 * 用于保存到消息记录中
 */
export function ragResultToToolLogs(result: RAGResult): string {
  const toolLog = {
    type: 'document_search',
    timestamp: new Date().toISOString(),
    result: {
      hits: result.hits.map((hit) => ({
        documentId: hit.documentId,
        documentName: hit.documentName,
        chunkIndex: hit.chunkIndex,
        score: hit.score,
        contentPreview: hit.content.slice(0, 200),
      })),
      totalHits: result.totalHits,
      queryTimeMs: result.queryTime,
    },
  }

  return JSON.stringify([toolLog])
}

