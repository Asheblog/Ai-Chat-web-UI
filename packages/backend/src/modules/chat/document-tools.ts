/**
 * 会话文档工具模块
 * 提供 AI 可调用的文档检索与浏览工具（按文档 ID 精确定位）
 */

import type { RAGService } from '../../services/document/rag-service'
import type { EnhancedRAGService } from '../../services/document/enhanced-rag-service'
import type { DocumentService } from '../../services/document/document-service'
import type { DocumentSectionService } from '../../services/document/section-service'

/**
 * 文档工具定义（OpenAI function calling 格式）
 */
export const documentToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'document_list',
      description: `列出当前会话已附加的文档概览，返回文档 ID、页数、摘要、目录等信息。

**使用场景**:
- ✅ 多文档总结前先识别文档与结构
- ✅ 用户问"有哪些文档"、"文档讲什么"
- ✅ 决定使用 document_search 还是 document_get_content 时

**返回信息**:
- 文档 ID、名称、页数、分块数量、状态
- 摘要与目录结构（如有）
- 文档类型（代码/表格/报告/合同/通用）

**最佳实践**:
在执行任何文档操作前先调用此工具获取文档 ID。`,
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
      name: 'document_search',
      description: `在指定文档中进行语义搜索并返回相关片段。

**使用场景**:
- ✅ 多文档总结/对比（可传多个 document_ids）
- ✅ 查找某个问题/条款/主题
- ✅ 从章节级内容定位关键信息

**搜索模式 (search_mode)**:
- "precise": 精确匹配，少量高相关结果
- "broad": 广泛检索，适合归纳
- "overview": 概览采样，适合多文档总结
- "section": 章节级检索，返回章节列表

**最佳实践**:
1. 多文档总结优先用 overview + per_document_k
2. 需要完整上下文可开启 include_context
3. 章节定位用 section 模式`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询，使用自然语言描述要查找的内容',
          },
          document_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: '可选，指定文档 ID 列表（默认搜索会话全部文档）',
          },
          search_mode: {
            type: 'string',
            enum: ['precise', 'broad', 'overview', 'section'],
            description: '搜索模式：precise/broad/overview/section',
          },
          top_k: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '返回结果数量，默认按搜索模式自动决定',
          },
          per_document_k: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: '多文档均衡采样时，每个文档保留的结果数',
          },
          aggregate_adjacent: {
            type: 'boolean',
            description: '是否合并相邻 chunk，默认 true',
          },
          include_context: {
            type: 'boolean',
            description: '是否携带前后上下文，默认 true',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_get_content',
      description: `获取指定文档的页面内容，支持单页、范围或离散页。

**使用场景**:
- ✅ 用户问"第X页是什么"或"第X-Y页"
- ✅ 需要精读某个页面/区间

**参数说明**:
- page_number: 获取单页
- start_page + end_page: 获取连续页面
- pages: 获取不连续页码列表
- sample_mode: 控制返回内容详细程度

**采样模式 (sample_mode)**:
- "full": 完整内容（默认）
- "summary": 每页首段
- "headings": 标题与关键句

**限制**: 单次最多返回10页完整内容`,
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'integer',
            description: '文档 ID（来自 document_list）',
          },
          page_number: {
            type: 'integer',
            description: '可选，指定页码（从1开始）',
          },
          start_page: {
            type: 'integer',
            description: '可选，起始页码',
          },
          end_page: {
            type: 'integer',
            description: '可选，结束页码',
          },
          pages: {
            type: 'array',
            items: { type: 'integer' },
            description: '指定页码列表（如 [1, 5, 10]）',
          },
          sample_mode: {
            type: 'string',
            enum: ['full', 'summary', 'headings'],
            description: '采样模式：full/summary/headings',
          },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_get_toc',
      description: `获取文档目录结构（章节大纲）。

**使用场景**:
- ✅ 了解文档结构与章节分布
- ✅ 章节级阅读与定位

**最佳实践**:
先用此工具获取目录，再用 document_get_section 获取章节内容。`,
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'integer',
            description: '文档 ID（来自 document_list）',
          },
          max_level: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: '最大层级，默认 3',
          },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_get_section',
      description: `获取指定章节的完整内容。

**使用场景**:
- ✅ 已知章节路径（如 "1.2"）
- ✅ 章节标题搜索后精读

**参数说明**:
- section_path: 章节路径或标题关键词
- include_children: 是否包含子章节，默认 true`,
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'integer',
            description: '文档 ID',
          },
          section_path: {
            type: 'string',
            description: '章节路径或标题关键词',
          },
          include_children: {
            type: 'boolean',
            description: '是否包含子章节内容，默认 true',
          },
        },
        required: ['document_id', 'section_path'],
      },
    },
  },
]

/**
 * 工具名称集合
 */
export const documentToolNames = new Set([
  'document_list',
  'document_search',
  'document_get_content',
  'document_get_toc',
  'document_get_section',
])

/**
 * 文档工具处理器
 */
export class DocumentToolHandler {
  private ragService: RAGService
  private documentService: DocumentService
  private enhancedRagService: EnhancedRAGService | null
  private sectionService: DocumentSectionService | null
  private sessionId: number

  constructor(
    ragService: RAGService,
    documentService: DocumentService,
    sessionId: number,
    enhancedRagService?: EnhancedRAGService | null,
    sectionService?: DocumentSectionService | null
  ) {
    this.ragService = ragService
    this.documentService = documentService
    this.sessionId = sessionId
    this.enhancedRagService = enhancedRagService || null
    this.sectionService = sectionService || null
  }

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
        case 'document_list':
          return await this.handleList()

        case 'document_search':
          return await this.handleSearch(args)

        case 'document_get_content':
          return await this.handleGetContent(args)

        case 'document_get_toc':
          return await this.handleGetTOC(args)

        case 'document_get_section':
          return await this.handleGetSection(args)

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

  private async handleList(): Promise<{ success: boolean; result: unknown }> {
    const overview = await this.documentService.getSessionDocumentOverview(this.sessionId)

    if (overview.documents.length === 0) {
      return {
        success: true,
        result: {
          message: '当前会话没有上传或附加的文档',
          documents: [],
          suggestion: '请先上传文档并附加到会话',
        },
      }
    }

    const totalPages = overview.documents.reduce((sum, doc) => sum + doc.pageCount, 0)
    const analysisHint = totalPages <= 10
      ? '文档较短，可直接阅读或使用 document_get_content'
      : '文档较长，建议先用 document_search 定位，再按章节/页码阅读'

    return {
      success: true,
      result: {
        message: `当前会话有 ${overview.documents.length} 个文档，共 ${totalPages} 页`,
        analysisHint,
        documents: overview.documents.map((doc) => ({
          documentId: doc.id,
          name: doc.name,
          pageCount: doc.pageCount,
          chunkCount: doc.chunkCount,
          hasPageInfo: doc.hasPageInfo,
          status: doc.status,
          summary: doc.summary,
          toc: doc.toc,
          documentType: doc.documentType,
        })),
      },
    }
  }

  private async handleSearch(args: Record<string, unknown>): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    const query = (args.query as string) || ''
    if (!query.trim()) {
      return { success: false, result: null, error: '搜索查询不能为空' }
    }

    const sessionDocIds = await this.documentService.getSessionDocumentIds(this.sessionId, { onlyReady: true })
    const requestedIds = Array.isArray(args.document_ids) ? (args.document_ids as number[]) : []
    const targetIds = requestedIds.length > 0
      ? requestedIds.filter((id) => sessionDocIds.includes(id))
      : sessionDocIds

    if (targetIds.length === 0) {
      return {
        success: false,
        result: null,
        error: '没有可搜索的文档，请先使用 document_list 获取有效文档 ID',
      }
    }

    const searchMode = (args.search_mode as string) || 'precise'
    let defaultTopK = 5
    if (searchMode === 'broad') defaultTopK = 10
    if (searchMode === 'overview') defaultTopK = 8
    if (searchMode === 'section') defaultTopK = 6
    const topK = (args.top_k as number) || defaultTopK
    const perDocumentK = (args.per_document_k as number) || undefined
    const aggregateAdjacent = typeof args.aggregate_adjacent === 'boolean' ? args.aggregate_adjacent : true
    const includeContext = typeof args.include_context === 'boolean' ? args.include_context : true

    if (searchMode === 'section' && this.enhancedRagService) {
      const sections = await this.enhancedRagService.searchSections(targetIds, query, topK)
      return {
        success: true,
        result: {
          query,
          searchMode,
          totalHits: sections.length,
          sections,
          suggestion: sections.length === 0 ? '未找到相关章节，可尝试 broad 或 overview 模式' : undefined,
        },
      }
    }

    let result: { hits: any[]; totalHits: number; queryTime: number }

    const normalizedMode = searchMode === 'section' ? 'broad' : searchMode

    if (this.enhancedRagService) {
      const enhanced = await this.enhancedRagService.search(targetIds, query, {
        mode: normalizedMode as 'precise' | 'broad' | 'overview',
        aggregateAdjacent,
        groupBySection: true,
        includeContext,
        contextSize: 1,
        topK,
        ensureDocumentCoverage: targetIds.length > 1,
        perDocumentK,
      })
      result = {
        hits: enhanced.hits,
        totalHits: enhanced.totalHits,
        queryTime: enhanced.queryTime,
      }
    } else {
      const basic = await this.ragService.searchInDocuments(targetIds, query, normalizedMode as 'precise' | 'broad' | 'overview', {
        ensureDocumentCoverage: targetIds.length > 1,
        perDocumentK,
      })
      result = {
        hits: basic.hits.slice(0, topK),
        totalHits: basic.totalHits,
        queryTime: basic.queryTime,
      }
    }

    return {
      success: true,
      result: {
        query,
        searchMode,
        totalHits: result.totalHits,
        queryTimeMs: result.queryTime,
        hits: result.hits.slice(0, topK).map((hit: any) => ({
          documentId: hit.documentId,
          documentName: hit.documentName,
          pageNumber: (hit.metadata?.pageNumber as number) || null,
          section: hit.section
            ? {
                title: hit.section.title,
                path: hit.section.path,
                level: hit.section.level,
              }
            : null,
          aggregatedFrom: hit.aggregatedFrom || null,
          contextBefore: hit.contextBefore || null,
          contextAfter: hit.contextAfter || null,
          anchor: hit.content.trim().substring(0, 40) + '...',
          content: hit.content,
          score: Math.round(hit.score * 100) / 100,
        })),
        suggestion:
          searchMode === 'overview'
            ? '以上为多文档概览结果，如需精读请使用 document_get_content 或 document_get_section'
            : undefined,
      },
    }
  }

  private async handleGetContent(args: Record<string, unknown>): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    const documentId = args.document_id as number
    if (!documentId) {
      return { success: false, result: null, error: 'document_id 不能为空' }
    }

    const isInSession = await this.isDocumentInSession(documentId)
    if (!isInSession) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前会话`,
      }
    }

    const content = await this.documentService.getDocumentContent(documentId, {
      pageNumber: args.page_number as number | undefined,
      startPage: args.start_page as number | undefined,
      endPage: args.end_page as number | undefined,
      pages: (args.pages as number[]) || undefined,
      sampleMode: (args.sample_mode as 'full' | 'summary' | 'headings') || 'full',
    })

    if (!content) {
      return {
        success: true,
        result: {
          found: false,
          message: `未找到文档 ${documentId} 内容`,
        },
      }
    }

    return {
      success: true,
      result: {
        found: true,
        ...content,
      },
    }
  }

  private async handleGetTOC(args: Record<string, unknown>): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    const documentId = args.document_id as number
    const maxLevel = args.max_level as number | undefined

    if (!documentId) {
      return { success: false, result: null, error: 'document_id 不能为空' }
    }

    const isInSession = await this.isDocumentInSession(documentId)
    if (!isInSession) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前会话`,
      }
    }

    if (!this.sectionService) {
      return {
        success: true,
        result: {
          message: '当前文档未生成章节目录',
          toc: [],
          suggestion: '可先使用 document_search 或 document_get_content 获取内容',
        },
      }
    }

    const toc = await this.sectionService.getDocumentTOC(documentId, maxLevel)

    return {
      success: true,
      result: {
        documentId,
        toc,
        message: toc.length > 0 ? '已获取目录结构' : '未检测到章节目录',
      },
    }
  }

  private async handleGetSection(args: Record<string, unknown>): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    const documentId = args.document_id as number
    const sectionPath = (args.section_path as string) || ''
    const includeChildren = args.include_children !== false

    if (!documentId || !sectionPath.trim()) {
      return { success: false, result: null, error: 'document_id 与 section_path 不能为空' }
    }

    const isInSession = await this.isDocumentInSession(documentId)
    if (!isInSession) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前会话`,
      }
    }

    if (!this.sectionService) {
      return {
        success: false,
        result: null,
        error: '章节服务不可用，无法获取章节内容',
      }
    }

    let section = await this.sectionService.getSectionByPath(documentId, sectionPath)
    if (!section) {
      const matches = await this.sectionService.searchSectionsByTitle(documentId, sectionPath)
      if (matches.length > 0) {
        section = matches[0]
      }
    }

    if (!section) {
      return {
        success: false,
        result: null,
        error: `未找到章节 ${sectionPath}`,
      }
    }

    const sectionContent = await this.sectionService.getSectionContent(section.id, includeChildren)
    if (!sectionContent) {
      return {
        success: false,
        result: null,
        error: `章节 ${sectionPath} 内容为空`,
      }
    }

    return {
      success: true,
      result: {
        documentId,
        section: {
          id: section.id,
          title: section.title,
          path: section.path,
          level: section.level,
          startPage: section.startPage,
          endPage: section.endPage,
        },
        chunkCount: sectionContent.chunks.length,
        content: sectionContent.content,
      },
    }
  }

  private async isDocumentInSession(documentId: number): Promise<boolean> {
    const docs = await this.documentService.getSessionDocumentIds(this.sessionId)
    return docs.includes(documentId)
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
    case 'document_list':
      return stage === 'start' ? '获取会话文档列表...' : '已获取会话文档'

    case 'document_search':
      return stage === 'start'
        ? `在文档中搜索：${args.query}`
        : '搜索完成，已获取相关内容'

    case 'document_get_content':
      return stage === 'start'
        ? `获取文档 ${args.document_id} 内容...`
        : `已获取文档 ${args.document_id} 内容`

    case 'document_get_toc':
      return stage === 'start'
        ? `获取文档 ${args.document_id} 目录结构...`
        : '已获取目录结构'

    case 'document_get_section':
      return stage === 'start'
        ? `获取章节 ${args.section_path} 内容...`
        : '已获取章节内容'

    default:
      return `执行文档工具：${toolName}`
  }
}
