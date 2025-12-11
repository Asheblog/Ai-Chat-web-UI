/**
 * RAG 文档检索辅助模块
 * 用于在聊天流程中集成文档检索功能
 */

import type { RAGService, RAGResult, RAGHit } from '../../services/document/rag-service'

/**
 * 文档检索 Tool 事件类型
 */
export interface DocumentSearchToolEvent {
  type: 'tool'
  tool: 'document_search'
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
 * RAG 增强上下文构建器
 */
export class RAGContextBuilder {
  private ragService: RAGService

  constructor(ragService: RAGService) {
    this.ragService = ragService
  }

  /**
   * 检查会话是否需要 RAG 增强
   */
  async shouldEnhance(sessionId: number): Promise<boolean> {
    return this.ragService.hasSessionDocuments(sessionId)
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
