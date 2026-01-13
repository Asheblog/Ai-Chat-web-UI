/**
 * 知识库工具模块
 * 提供 AI 可调用的知识库检索和查看工具
 */

import type { KnowledgeBaseService } from '../../services/knowledge-base/knowledge-base-service'
import type { RAGService } from '../../services/document/rag-service'
import type { EnhancedRAGService } from '../../services/document/enhanced-rag-service'
import type { DocumentSectionService } from '../../services/document/section-service'

/**
 * 知识库工具定义（OpenAI function calling 格式）
 */
export const kbToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: `列出用户当前选择的知识库概要信息。

**使用场景**:
- ✅ 首次分析知识库时，先调用此工具了解可用知识库
- ✅ 用户问"有哪些知识库"、"知识库里有什么"

**返回信息**:
- 知识库名称、描述、文档数量、分块数量
- 分析建议（根据文档数量推荐搜索策略）`,
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
      name: 'kb_get_documents',
      description: `获取指定知识库中的文档列表。

**使用场景**:
- ✅ 用户问"知识库里有哪些文档"
- ✅ 获取文档 ID 用于后续 kb_get_document_content 调用

**返回信息**:
- 文档名称、类型、大小、状态
- 分块数量、添加时间`,
      parameters: {
        type: 'object',
        properties: {
          kb_id: {
            type: 'integer',
            description: '知识库 ID（可从 kb_list 获取）',
          },
        },
        required: ['kb_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_search',
      description: `在知识库中进行语义搜索，返回相关片段或章节。

**使用场景**:
- ✅ 多文档总结/对比
- ✅ 搜索某个问题/条款/主题
- ✅ 章节级定位

**搜索模式 (search_mode)**:
- "precise": 精确匹配
- "broad": 广泛检索
- "overview": 概览采样（多知识库总结）
- "section": 章节级检索，返回章节列表

**最佳实践**:
1. 多文档总结用 overview + per_document_k
2. 章节定位用 section 模式
3. 需要上下文可开启 include_context`,
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
            description: '返回结果数量，默认按搜索模式自动决定',
          },
          per_document_k: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: '多文档均衡采样时每个文档保留的结果数',
          },
          search_mode: {
            type: 'string',
            enum: ['precise', 'broad', 'overview', 'section'],
            description: '搜索模式：precise/broad/overview/section',
          },
          aggregate_adjacent: {
            type: 'boolean',
            description: '是否合并相邻 chunk，默认 true',
          },
          include_context: {
            type: 'boolean',
            description: '是否携带前后上下文，默认 true',
          },
          kb_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: '可选，指定要搜索的知识库 ID 列表（默认搜索所有已选知识库）',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_get_document_content',
      description: `获取知识库中某个文档的内容。

**使用场景**:
- ✅ "这个文档讲了什么"
- ✅ "第X页是什么内容"
- ✅ 需要阅读连续或不连续的多个页面

**采样模式 (sample_mode)**:
- "full": 返回完整内容（默认）
- "summary": 只返回每页首段
- "headings": 只返回标题和关键句

**限制**: 单次最多返回10页完整内容`,
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'integer',
            description: '文档 ID（可从 kb_get_documents 获取）',
          },
          page_number: {
            type: 'integer',
            description: '可选，指定获取某一页的内容（从 1 开始）',
          },
          start_page: {
            type: 'integer',
            description: '可选，起始页码（与 end_page 配合使用）',
          },
          end_page: {
            type: 'integer',
            description: '可选，结束页码（与 start_page 配合使用）',
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
      name: 'kb_get_toc',
      description: `获取文档的目录结构（章节大纲）。

**使用场景**:
- ✅ 了解文档结构
- ✅ 章节级定位`,
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'integer',
            description: '文档 ID（可从 kb_get_documents 获取）',
          },
          max_level: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: '最大展示层级，默认3',
          },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_get_section',
      description: `获取指定章节的完整内容。

**使用场景**:
- ✅ 已知章节路径或标题关键词
- ✅ 从目录中选择章节后精读`,
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
export const kbToolNames = new Set([
  'kb_list',
  'kb_get_documents',
  'kb_search',
  'kb_get_document_content',
  'kb_get_toc',
  'kb_get_section',
])

/**
 * 知识库工具处理器
 */
export class KBToolHandler {
  private kbService: KnowledgeBaseService
  private ragService: RAGService
  private enhancedRagService: EnhancedRAGService | null
  private sectionService: DocumentSectionService | null
  private knowledgeBaseIds: number[]

  constructor(
    kbService: KnowledgeBaseService,
    ragService: RAGService,
    knowledgeBaseIds: number[],
    enhancedRagService?: EnhancedRAGService | null,
    sectionService?: DocumentSectionService | null
  ) {
    this.kbService = kbService
    this.ragService = ragService
    this.knowledgeBaseIds = knowledgeBaseIds
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
        case 'kb_list':
          return await this.handleList()

        case 'kb_get_documents':
          return await this.handleGetDocuments(args.kb_id as number)

        case 'kb_search':
          return await this.handleSearch(args)

        case 'kb_get_document_content':
          return await this.handleGetDocumentContent(args)

        case 'kb_get_toc':
          return await this.handleGetTOC(args.document_id as number, args.max_level as number | undefined)

        case 'kb_get_section':
          return await this.handleGetSection(
            args.document_id as number,
            args.section_path as string,
            args.include_children as boolean | undefined
          )

        default:
          return {
            success: false,
            result: null,
            error: `Unknown knowledge base tool: ${toolName}`,
          }
      }
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : 'Knowledge base tool failed',
      }
    }
  }

  private async handleList(): Promise<{ success: boolean; result: unknown }> {
    if (this.knowledgeBaseIds.length === 0) {
      return {
        success: true,
        result: {
          message: '当前没有选择任何知识库',
          knowledgeBases: [],
        },
      }
    }

    const knowledgeBases = []
    for (const kbId of this.knowledgeBaseIds) {
      const kb = await this.kbService.get(kbId)
      if (kb) {
        knowledgeBases.push({
          id: kb.id,
          name: kb.name,
          description: kb.description,
          documentCount: kb.documentCount,
          totalChunks: kb.totalChunks,
          status: kb.status,
        })
      }
    }

    return {
      success: true,
      result: {
        message: `当前选择了 ${knowledgeBases.length} 个知识库`,
        knowledgeBases,
      },
    }
  }

  private async handleGetDocuments(kbId: number): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!kbId || !this.knowledgeBaseIds.includes(kbId)) {
      return {
        success: false,
        result: null,
        error: `知识库 ID ${kbId} 不在当前选择的知识库列表中`,
      }
    }

    const kb = await this.kbService.get(kbId)
    if (!kb) {
      return {
        success: false,
        result: null,
        error: `知识库 ${kbId} 不存在`,
      }
    }

    const documents = kb.documents.map((d: any) => ({
      id: d.document.id,
      name: d.document.originalName,
      mimeType: d.document.mimeType,
      fileSize: d.document.fileSize,
      status: d.document.status,
      chunkCount: d.document.chunkCount,
      addedAt: d.addedAt,
    }))

    return {
      success: true,
      result: {
        knowledgeBase: {
          id: kb.id,
          name: kb.name,
        },
        documentCount: documents.length,
        documents,
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

    const kbIds = (args.kb_ids as number[]) || this.knowledgeBaseIds
    const validKbIds = kbIds.filter((id) => this.knowledgeBaseIds.includes(id))

    if (validKbIds.length === 0) {
      return {
        success: false,
        result: null,
        error: '没有有效的知识库可供搜索',
        suggestion: `当前可用的知识库 ID: ${this.knowledgeBaseIds.join(', ')}`,
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

    const documentIds = await this.kbService.getDocumentIdsFromMultiple(validKbIds)
    if (documentIds.length === 0) {
      return {
        success: true,
        result: {
          message: '知识库中没有可搜索的文档',
          hits: [],
        },
      }
    }

    if (searchMode === 'section' && this.enhancedRagService) {
      const sections = await this.enhancedRagService.searchSections(documentIds, query, topK)
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
      const enhanced = await this.enhancedRagService.search(documentIds, query, {
        mode: normalizedMode as 'precise' | 'broad' | 'overview',
        aggregateAdjacent,
        groupBySection: true,
        includeContext,
        contextSize: 1,
        topK,
        ensureDocumentCoverage: documentIds.length > 1,
        perDocumentK,
      })
      result = {
        hits: enhanced.hits,
        totalHits: enhanced.totalHits,
        queryTime: enhanced.queryTime,
      }
    } else {
      const basic = await this.ragService.searchInDocuments(documentIds, query, normalizedMode as 'precise' | 'broad' | 'overview', {
        ensureDocumentCoverage: documentIds.length > 1,
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
            ? '以上为多文档概览结果，如需精读请使用 kb_get_document_content 或 kb_get_section'
            : undefined,
      },
    }
  }

  private async handleGetDocumentContent(args: Record<string, unknown>): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    const documentId = args.document_id as number
    if (!documentId) {
      return { success: false, result: null, error: 'document_id 不能为空' }
    }

    const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(documentId, this.knowledgeBaseIds)
    if (!isDocumentInKb) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前选择的知识库`,
        suggestion: '请先使用 kb_get_documents 获取有效的文档 ID',
      }
    }

    const content = await this.kbService.getDocumentContent(documentId, {
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
          message: `未找到文档 ${documentId} 的内容`,
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

  private async handleGetTOC(documentId: number, maxLevel?: number): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!documentId) {
      return { success: false, result: null, error: 'document_id 不能为空' }
    }

    const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(documentId, this.knowledgeBaseIds)
    if (!isDocumentInKb) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前选择的知识库`,
      }
    }

    if (!this.sectionService) {
      return {
        success: true,
        result: {
          message: '当前文档未生成章节目录',
          toc: [],
          suggestion: '可先使用 kb_search 或 kb_get_document_content 获取内容',
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

  private async handleGetSection(
    documentId: number,
    sectionPath: string,
    includeChildren: boolean = true
  ): Promise<{
    success: boolean
    result: unknown
    error?: string
  }> {
    if (!documentId || !sectionPath) {
      return { success: false, result: null, error: 'document_id 与 section_path 不能为空' }
    }

    const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(documentId, this.knowledgeBaseIds)
    if (!isDocumentInKb) {
      return {
        success: false,
        result: null,
        error: `文档 ${documentId} 不属于当前选择的知识库`,
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
        suggestion: '请使用 kb_get_toc 查看完整目录结构',
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
}

/**
 * 生成知识库工具的 reasoning 提示
 */
export function formatKBToolReasoning(
  toolName: string,
  args: Record<string, unknown>,
  stage: 'start' | 'result' | 'error'
): string {
  switch (toolName) {
    case 'kb_list':
      return stage === 'start' ? '获取知识库列表...' : '已获取知识库概要'

    case 'kb_get_documents':
      return stage === 'start'
        ? `获取知识库 ${args.kb_id} 的文档列表...`
        : '已获取知识库文档列表'

    case 'kb_search':
      return stage === 'start'
        ? `在知识库中搜索：${args.query}`
        : '搜索完成，已获取相关内容'

    case 'kb_get_document_content':
      return stage === 'start'
        ? `获取文档 ${args.document_id} 的内容...`
        : '已获取文档内容'

    case 'kb_get_toc':
      return stage === 'start'
        ? `获取文档 ${args.document_id} 的目录结构...`
        : '已获取目录结构'

    case 'kb_get_section':
      return stage === 'start'
        ? `获取章节 ${args.section_path} 内容...`
        : '已获取章节内容'

    default:
      return `执行知识库工具：${toolName}`
  }
}
