/**
 * 文档工具模块
 * 提供AI可调用的文档检索和查看工具
 */

import type { RAGService } from '../../services/document/rag-service'

/**
 * 文档工具定义（OpenAI function calling 格式）
 */
export const documentToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'document_get_outline',
      description:
        '获取当前会话上传文档的概要信息，包括文档名称、总页数、分块数量等。在回答文档相关问题前，应先调用此工具了解文档结构。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_get_page',
      description:
        '获取文档指定页码的完整内容。当用户询问"第X页是什么内容"或需要查看特定页面时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          page_number: {
            type: 'integer',
            description: '要获取的页码（从1开始）',
          },
        },
        required: ['page_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_search',
      description:
        '在文档中语义搜索与问题相关的内容片段。用于查找"关于XXX的内容"、"文档中提到的YYY"等问题。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询，使用自然语言描述要查找的内容',
          },
          top_k: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '返回的结果数量，默认5',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_get_page_range',
      description:
        '获取文档指定页码范围的内容。当需要查看连续多页内容时使用，如"第5-10页的内容"。',
      parameters: {
        type: 'object',
        properties: {
          start_page: {
            type: 'integer',
            description: '起始页码（从1开始）',
          },
          end_page: {
            type: 'integer',
            description: '结束页码',
          },
        },
        required: ['start_page', 'end_page'],
      },
    },
  },
]

/**
 * 工具名称集合（用于检查是否为文档工具）
 */
export const documentToolNames = new Set([
  'document_get_outline',
  'document_get_page',
  'document_search',
  'document_get_page_range',
])

/**
 * 文档工具处理器
 */
export class DocumentToolHandler {
  private ragService: RAGService
  private sessionId: number

  constructor(ragService: RAGService, sessionId: number) {
    this.ragService = ragService
    this.sessionId = sessionId
  }

  /**
   * 处理文档工具调用
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    try {
      switch (toolName) {
        case 'document_get_outline':
          return await this.handleGetOutline()

        case 'document_get_page':
          return await this.handleGetPage(args.page_number as number)

        case 'document_search':
          return await this.handleSearch(
            args.query as string,
            (args.top_k as number) || 5
          )

        case 'document_get_page_range':
          return await this.handleGetPageRange(
            args.start_page as number,
            args.end_page as number
          )

        default:
          return {
            success: false,
            result: null,
            error: `Unknown document tool: ${toolName}`,
          }
      }
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : 'Document tool failed',
      }
    }
  }

  /**
   * 处理获取文档概要
   */
  private async handleGetOutline(): Promise<{
    success: boolean
    result: unknown
  }> {
    const outline = await this.ragService.getSessionDocumentOutline(
      this.sessionId
    )

    if (outline.documents.length === 0) {
      return {
        success: true,
        result: {
          message: '当前会话没有上传的文档',
          documents: [],
        },
      }
    }

    return {
      success: true,
      result: {
        message: `当前会话有 ${outline.documents.length} 个文档`,
        documents: outline.documents.map((doc) => ({
          name: doc.name,
          pageCount: doc.pageCount,
          chunkCount: doc.chunkCount,
          hasPageInfo: doc.hasPageInfo,
          status: doc.status,
        })),
      },
    }
  }

  /**
   * 处理按页获取内容
   */
  private async handleGetPage(pageNumber: number): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!pageNumber || pageNumber < 1) {
      return {
        success: false,
        result: null,
        error: '页码必须是大于0的整数',
      }
    }

    const pageContent = await this.ragService.getPageContent(
      this.sessionId,
      pageNumber
    )

    if (!pageContent) {
      // 获取文档概要以提供页码范围信息
      const outline = await this.ragService.getSessionDocumentOutline(
        this.sessionId
      )
      const maxPage = Math.max(
        ...outline.documents.map((d) => d.pageCount),
        0
      )

      return {
        success: true,
        result: {
          found: false,
          message: `未找到第 ${pageNumber} 页的内容`,
          hint: maxPage > 0 ? `文档总共有 ${maxPage} 页，请确认页码在 1-${maxPage} 范围内` : '当前会话没有包含页码信息的文档',
        },
      }
    }

    return {
      success: true,
      result: {
        found: true,
        pageNumber: pageContent.pageNumber,
        documentName: pageContent.documentName,
        content: pageContent.content,
        chunkCount: pageContent.chunks.length,
      },
    }
  }

  /**
   * 处理语义搜索
   */
  private async handleSearch(
    query: string,
    topK: number
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!query || !query.trim()) {
      return {
        success: false,
        result: null,
        error: '搜索查询不能为空',
      }
    }

    const searchResult = await this.ragService.searchInSession(
      this.sessionId,
      query
    )

    return {
      success: true,
      result: {
        query,
        totalHits: searchResult.totalHits,
        queryTimeMs: searchResult.queryTime,
        hits: searchResult.hits.slice(0, topK).map((hit) => ({
          documentName: hit.documentName,
          pageNumber: (hit.metadata.pageNumber as number) || null,
          content: hit.content,
          score: Math.round(hit.score * 100) / 100,
        })),
      },
    }
  }

  /**
   * 处理按页范围获取内容
   */
  private async handleGetPageRange(
    startPage: number,
    endPage: number
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!startPage || !endPage || startPage < 1 || endPage < startPage) {
      return {
        success: false,
        result: null,
        error: '页码范围无效，起始页必须大于0且不大于结束页',
      }
    }

    // 限制范围，防止一次获取太多
    const maxRange = 10
    const actualEndPage = Math.min(endPage, startPage + maxRange - 1)

    const rangeContent = await this.ragService.getPageRangeContent(
      this.sessionId,
      startPage,
      actualEndPage
    )

    if (rangeContent.pages.length === 0) {
      return {
        success: true,
        result: {
          found: false,
          message: `未找到第 ${startPage}-${actualEndPage} 页的内容`,
        },
      }
    }

    return {
      success: true,
      result: {
        found: true,
        requestedRange: { start: startPage, end: endPage },
        actualRange: { start: startPage, end: actualEndPage },
        pageCount: rangeContent.pages.length,
        pages: rangeContent.pages.map((p) => ({
          pageNumber: p.pageNumber,
          documentName: p.documentName,
          content: p.content,
        })),
        note:
          endPage > actualEndPage
            ? `由于内容限制，只返回了第 ${startPage}-${actualEndPage} 页，请分批获取剩余页面`
            : undefined,
      },
    }
  }
}

/**
 * 生成文档工具的 reasoning 提示
 */
export function formatDocumentToolReasoning(
  toolName: string,
  args: Record<string, unknown>,
  stage: 'start' | 'result' | 'error'
): string {
  switch (toolName) {
    case 'document_get_outline':
      return stage === 'start' ? '获取文档概要信息...' : '已获取文档概要'

    case 'document_get_page':
      return stage === 'start'
        ? `查看第 ${args.page_number} 页内容...`
        : `已获取第 ${args.page_number} 页`

    case 'document_search':
      return stage === 'start'
        ? `在文档中搜索：${args.query}`
        : '搜索完成，已获取相关内容'

    case 'document_get_page_range':
      return stage === 'start'
        ? `获取第 ${args.start_page}-${args.end_page} 页内容...`
        : '已获取页面范围内容'

    default:
      return `执行文档工具：${toolName}`
  }
}
