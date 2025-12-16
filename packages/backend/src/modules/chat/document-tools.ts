/**
 * 文档工具模块
 * 提供AI可调用的文档检索和查看工具
 * 
 * 改进说明：
 * 1. 增强工具描述，添加使用场景和最佳实践
 * 2. 支持自适应检索策略 (search_mode)
 * 3. 支持稀疏页码批量获取 (pages 参数)
 * 4. 增强错误反馈，提供替代建议
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
      description: `获取当前会话上传文档的概要信息，包括文档名称、总页数、分块数量、内容摘要和目录结构。

**使用场景**:
- ✅ 首次分析文档时，先调用此工具了解文档结构
- ✅ 用户问"这个文档讲什么"、"文档有多长"
- ✅ 需要决定使用 search 还是 get_page_range 时

**返回信息**:
- 文档名称、页数、分块数量
- 内容摘要（基于首尾内容生成）
- 目录结构（如果有章节标题）
- 文档类型（代码/表格/报告等）

**最佳实践**:
在回答任何文档相关问题前，应先调用此工具了解文档全貌。`,
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
      description: `获取文档指定页码的完整内容。

**使用场景**:
- ✅ 用户明确问"第X页是什么内容"
- ✅ search 返回某页有相关内容，需要查看完整上下文
- ✅ 需要精读特定页面

**不适用场景**:
- ❌ 模糊问题如"文档中关于XX的内容" → 应使用 document_search
- ❌ 需要浏览多页 → 应使用 document_get_page_range

**返回信息**:
- 页面完整文本内容
- 页面位置标记（便于引用）`,
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
      description: `在文档中语义搜索与问题相关的内容片段。

**使用场景**:
- ✅ "文档中关于XX的部分"
- ✅ "合同里的付款条款是什么"
- ✅ "总结文档中所有关于YYY的内容"

**不适用场景**:
- ❌ "第5页写了什么" → 应使用 document_get_page
- ❌ "文档开头说了什么" → 应使用 document_get_page(1)

**搜索模式 (search_mode)**:
- "precise": 精确匹配，返回少量高相关结果（适合找具体条款）
- "broad": 广泛检索，返回更多结果（适合总结归纳）
- "overview": 概览采样，从文档不同位置采样（适合快速了解）

**最佳实践**:
1. 长文档(>20页)优先用 search 定位，再用 get_page 精读
2. 短文档(<5页)可直接用 get_page_range 全量阅读`,
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
            description: '返回的结果数量，默认根据 search_mode 自动决定',
          },
          search_mode: {
            type: 'string',
            enum: ['precise', 'broad', 'overview'],
            description: '搜索模式：precise(精确,默认)、broad(广泛)、overview(概览采样)',
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
      description: `获取文档指定页码范围或多个指定页码的内容。

**使用场景**:
- ✅ "第5-10页的内容"
- ✅ 需要阅读连续多页
- ✅ 需要采样查看多个不连续的页面（使用 pages 参数）

**参数说明**:
- 使用 start_page + end_page 获取连续页面
- 使用 pages 数组获取不连续的特定页面（如 [1, 5, 10, 15]）
- 使用 sample_mode 控制返回内容详细程度

**采样模式 (sample_mode)**:
- "full": 返回完整内容（默认）
- "summary": 只返回每页首段，适合快速浏览
- "headings": 只返回标题和关键句

**限制**: 单次最多返回10页完整内容，超出部分需分批获取`,
      parameters: {
        type: 'object',
        properties: {
          start_page: {
            type: 'integer',
            description: '起始页码（从1开始），与 end_page 配合使用',
          },
          end_page: {
            type: 'integer',
            description: '结束页码，与 start_page 配合使用',
          },
          pages: {
            type: 'array',
            items: { type: 'integer' },
            description: '指定页码列表（如 [1, 5, 10]），用于获取不连续的多个页面',
          },
          sample_mode: {
            type: 'string',
            enum: ['full', 'summary', 'headings'],
            description: '采样模式：full(完整内容,默认)、summary(每页首段)、headings(仅标题)',
          },
        },
        required: [],
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

        case 'document_search': {
          const searchMode = (args.search_mode as string) || 'precise'
          // 根据搜索模式决定默认 topK
          let defaultTopK = 5
          if (searchMode === 'broad') defaultTopK = 10
          if (searchMode === 'overview') defaultTopK = 8
          const topK = (args.top_k as number) || defaultTopK
          return await this.handleSearch(
            args.query as string,
            topK,
            searchMode as 'precise' | 'broad' | 'overview'
          )
        }

        case 'document_get_page_range': {
          const pages = args.pages as number[] | undefined
          const sampleMode = (args.sample_mode as string) || 'full'
          if (pages && Array.isArray(pages) && pages.length > 0) {
            return await this.handleGetPages(
              pages,
              sampleMode as 'full' | 'summary' | 'headings'
            )
          }
          return await this.handleGetPageRange(
            args.start_page as number,
            args.end_page as number,
            sampleMode as 'full' | 'summary' | 'headings'
          )
        }

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
   * 处理获取文档概要（增强版）
   * 返回摘要、目录结构和文档类型等信息
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
          suggestion: '请先上传文档，支持 PDF、DOCX、TXT、MD、CSV 等格式',
        },
      }
    }

    // 计算总页数，给出分析建议
    const totalPages = outline.documents.reduce((sum, doc) => sum + doc.pageCount, 0)
    let analysisHint = ''
    if (totalPages <= 5) {
      analysisHint = '文档较短，可使用 document_get_page_range 直接阅读全部内容'
    } else if (totalPages <= 20) {
      analysisHint = '文档长度适中，建议先用 document_search 定位关键内容，再用 document_get_page 精读'
    } else {
      analysisHint = '文档较长，强烈建议使用 document_search 语义搜索定位相关内容'
    }

    return {
      success: true,
      result: {
        message: `当前会话有 ${outline.documents.length} 个文档，共 ${totalPages} 页`,
        analysisHint,
        documents: outline.documents.map((doc) => ({
          name: doc.name,
          pageCount: doc.pageCount,
          chunkCount: doc.chunkCount,
          hasPageInfo: doc.hasPageInfo,
          status: doc.status,
          // 新增：文档摘要（来自 metadata）
          summary: doc.summary || null,
          // 新增：目录结构（如果有）
          toc: doc.toc || null,
          // 新增：文档类型
          documentType: doc.documentType || 'general',
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
   * 处理语义搜索（增强版）
   * 支持不同的搜索模式
   */
  private async handleSearch(
    query: string,
    topK: number,
    searchMode: 'precise' | 'broad' | 'overview' = 'precise'
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
        // 提供替代建议
      }
    }

    // 根据搜索模式调整相关性阈值
    const searchResult = await this.ragService.searchInSession(
      this.sessionId,
      query,
      searchMode
    )

    // 如果没有结果，提供替代建议
    if (searchResult.hits.length === 0) {
      const outline = await this.ragService.getSessionDocumentOutline(this.sessionId)
      const totalPages = outline.documents.reduce((sum, doc) => sum + doc.pageCount, 0)

      return {
        success: true,
        result: {
          query,
          searchMode,
          totalHits: 0,
          queryTimeMs: searchResult.queryTime,
          hits: [],
          suggestion: totalPages > 0
            ? '未找到相关内容，建议：1) 尝试更换关键词 2) 使用 document_get_page_range 浏览文档内容'
            : '当前会话没有可搜索的文档',
        },
      }
    }

    return {
      success: true,
      result: {
        query,
        searchMode,
        totalHits: searchResult.totalHits,
        queryTimeMs: searchResult.queryTime,
        hits: searchResult.hits.slice(0, topK).map((hit) => ({
          documentName: hit.documentName,
          pageNumber: (hit.metadata.pageNumber as number) || null,
          // 新增：页面位置标识
          pagePosition: (hit.metadata.pagePosition as string) || null,
          // 新增：上下文锚点（内容前20个字符）
          anchor: hit.content.trim().substring(0, 40) + '...',
          content: hit.content,
          score: Math.round(hit.score * 100) / 100,
        })),
        // 如果是 overview 模式，给出阅读建议
        suggestion: searchMode === 'overview'
          ? '以上是文档各部分的代表性内容，如需详细了解某部分，请使用 document_get_page 查看完整页面'
          : undefined,
      },
    }
  }

  /**
   * 处理按页范围获取内容（增强版）
   * 支持采样模式
   */
  private async handleGetPageRange(
    startPage: number,
    endPage: number,
    sampleMode: 'full' | 'summary' | 'headings' = 'full'
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!startPage || !endPage || startPage < 1 || endPage < startPage) {
      // 增强错误提示
      const outline = await this.ragService.getSessionDocumentOutline(this.sessionId)
      const maxPage = Math.max(...outline.documents.map((d) => d.pageCount), 0)

      return {
        success: false,
        result: null,
        error: '页码范围无效，起始页必须大于0且不大于结束页',
        // @ts-ignore - 添加建议字段
        suggestion: maxPage > 0
          ? `文档总共有 ${maxPage} 页，请使用 1-${maxPage} 范围内的页码`
          : undefined,
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
          suggestion: '该页面可能为扫描件图片，无法提取文字。建议使用 document_search 搜索其他内容',
        },
      }
    }

    // 根据采样模式处理内容
    const processContent = (content: string): string => {
      if (sampleMode === 'full') {
        return content
      }
      if (sampleMode === 'summary') {
        // 只返回首段（前300字符）
        const firstPara = content.split('\n\n')[0] || content
        return firstPara.substring(0, 300) + (firstPara.length > 300 ? '...' : '')
      }
      if (sampleMode === 'headings') {
        // 提取可能的标题行（短行、全大写、数字开头等）
        const lines = content.split('\n')
        const headings = lines.filter((line) => {
          const trimmed = line.trim()
          if (!trimmed) return false
          // 短行可能是标题
          if (trimmed.length < 60 && trimmed.length > 2) return true
          // 数字开头可能是章节
          if (/^[0-9一二三四五六七八九十]+[.、)）]/.test(trimmed)) return true
          return false
        })
        return headings.slice(0, 10).join('\n') || content.substring(0, 200)
      }
      return content
    }

    return {
      success: true,
      result: {
        found: true,
        sampleMode,
        requestedRange: { start: startPage, end: endPage },
        actualRange: { start: startPage, end: actualEndPage },
        pageCount: rangeContent.pages.length,
        pages: rangeContent.pages.map((p) => ({
          pageNumber: p.pageNumber,
          documentName: p.documentName,
          content: processContent(p.content),
        })),
        note:
          endPage > actualEndPage
            ? `由于内容限制，只返回了第 ${startPage}-${actualEndPage} 页，请分批获取剩余页面`
            : undefined,
      },
    }
  }

  /**
   * 处理获取多个不连续页面（新增）
   * 支持稀疏页码列表
   */
  private async handleGetPages(
    pages: number[],
    sampleMode: 'full' | 'summary' | 'headings' = 'full'
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    // 验证页码
    const validPages = pages.filter((p) => p > 0).slice(0, 10) // 最多10页
    if (validPages.length === 0) {
      return {
        success: false,
        result: null,
        error: '请提供至少一个有效的页码（大于0的整数）',
      }
    }

    const results: Array<{
      pageNumber: number
      documentName: string
      content: string
      found: boolean
    }> = []

    for (const pageNum of validPages) {
      const pageContent = await this.ragService.getPageContent(
        this.sessionId,
        pageNum
      )

      if (pageContent) {
        let content = pageContent.content

        // 根据采样模式处理
        if (sampleMode === 'summary') {
          const firstPara = content.split('\n\n')[0] || content
          content = firstPara.substring(0, 300) + (firstPara.length > 300 ? '...' : '')
        } else if (sampleMode === 'headings') {
          const lines = content.split('\n')
          const headings = lines.filter((line) => {
            const trimmed = line.trim()
            return trimmed && trimmed.length < 60 && trimmed.length > 2
          })
          content = headings.slice(0, 5).join('\n') || content.substring(0, 100)
        }

        results.push({
          pageNumber: pageNum,
          documentName: pageContent.documentName,
          content,
          found: true,
        })
      } else {
        results.push({
          pageNumber: pageNum,
          documentName: '',
          content: '',
          found: false,
        })
      }
    }

    const foundCount = results.filter((r) => r.found).length

    return {
      success: true,
      result: {
        requestedPages: pages,
        sampleMode,
        pageCount: foundCount,
        pages: results,
        note: pages.length > 10
          ? `请求了 ${pages.length} 页，仅返回前10页结果`
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
