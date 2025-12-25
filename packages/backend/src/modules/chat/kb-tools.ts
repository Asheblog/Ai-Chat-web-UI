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
- ✅ 需要决定使用 kb_search 还是 kb_get_document_content 时

**返回信息**:
- 知识库名称、描述、文档数量、分块数量
- 分析建议（根据文档数量推荐搜索策略）

**最佳实践**:
在回答知识库相关问题前，应先调用此工具了解知识库情况。`,
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
- ✅ 需要了解某个知识库的文档组成
- ✅ 获取文档 ID 用于后续 kb_get_document_content 调用

**返回信息**:
- 文档名称、类型、大小、状态
- 分块数量、添加时间
- 文档摘要（如有）

**最佳实践**:
获取文档列表后，根据文档数量和大小决定是用搜索还是直接阅读。`,
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
            description: `在知识库中进行语义搜索，找出与查询最相关的内容片段。

**使用场景**:
- ✅ "知识库中关于XX的内容"
- ✅ "搜索关于YYY的资料"
- ✅ 需要从多个知识库中检索信息

**不适用场景**:
- ❌ "第5页写了什么" → 应使用 kb_get_document_content
- ❌ "文档开头说了什么" → 应使用 kb_get_document_content

**搜索模式 (search_mode)**:
- "precise": 精确匹配，返回少量高相关结果（适合找具体条款）
- "broad": 广泛检索，返回更多结果（适合总结归纳）
- "overview": 概览采样，从知识库不同位置采样（适合快速了解）

**最佳实践**:
1. 大型知识库优先用 search 定位关键内容
2. 找到相关内容后，可用 kb_get_document_content 获取完整上下文`,
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

**参数说明**:
- page_number: 获取单页内容
- start_page + end_page: 获取连续页面
- pages: 获取不连续的多个页面（如 [1, 5, 10]）
- sample_mode: 控制返回内容详细程度

**采样模式 (sample_mode)**:
- "full": 返回完整内容（默认）
- "summary": 只返回每页首段，适合快速浏览
- "headings": 只返回标题和关键句

**限制**: 单次最多返回10页完整内容，超出部分需分批获取`,
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
                        description: '指定页码列表（如 [1, 5, 10]），用于获取不连续的多个页面',
                    },
                    sample_mode: {
                        type: 'string',
                        enum: ['full', 'summary', 'headings'],
                        description: '采样模式：full(完整内容,默认)、summary(每页首段)、headings(仅标题)',
                    },
                },
                required: ['document_id'],
            },
        },
    },
    // ==================== 新增工具 ====================
    {
        type: 'function',
        function: {
            name: 'kb_get_toc',
            description: `获取文档的目录结构（章节大纲）。

**使用场景**:
- ✅ 首次查看文档时了解整体结构
- ✅ 用户问"这个文档有哪些章节"、"目录是什么"
- ✅ 需要定位特定章节内容时，先查看目录
- ✅ 比逐页翻阅更高效地了解文档组织

**返回信息**:
- 层级目录树（章、节、小节）
- 每个章节的页码范围
- 章节路径（如 "1.2.3"）

**最佳实践**:
1. 在查看文档内容前，先调用此工具了解结构
2. 根据目录定位到感兴趣的章节
3. 使用 kb_get_section 获取章节完整内容`,
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
                        description: '最大展示层级，默认3（1=只显示章，2=显示章和节，3=显示到小节）',
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
- ✅ 已知章节路径（如 "1.2"），需要完整内容
- ✅ 从目录中选定章节后获取详细内容
- ✅ 比按页码获取更精准，直接获取完整章节

**参数说明**:
- section_path: 章节路径（如 "1", "1.2", "1.2.3"）或章节标题
- include_children: 是否包含子章节内容

**最佳实践**:
1. 先用 kb_get_toc 获取目录
2. 从目录中找到目标章节的路径
3. 使用此工具获取章节内容`,
            parameters: {
                type: 'object',
                properties: {
                    document_id: {
                        type: 'integer',
                        description: '文档 ID',
                    },
                    section_path: {
                        type: 'string',
                        description: '章节路径（如 "1.2.3"）或章节标题关键词',
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
    {
        type: 'function',
        function: {
            name: 'kb_search_v2',
            description: `增强版语义搜索：自动聚合相邻内容，按章节分组返回。

**相比 kb_search 的优势**:
- ✅ 相邻内容自动合并，不再碎片化
- ✅ 结果按章节分组，更易理解
- ✅ 返回章节上下文，内容更完整
- ✅ 支持按章节模式搜索

**搜索模式 (search_mode)**:
- "precise": 精确匹配，高相关性
- "broad": 广泛检索，覆盖更多内容
- "section": 按章节聚合，返回匹配的完整章节

**使用场景**:
- ✅ 搜索某个主题的完整信息
- ✅ 需要连贯的上下文而非碎片
- ✅ 了解某个概念在文档中的分布

**最佳实践**:
1. 对于复杂查询，优先使用此工具
2. 使用 section 模式可快速定位相关章节`,
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '搜索查询，使用自然语言描述要查找的内容',
                    },
                    search_mode: {
                        type: 'string',
                        enum: ['precise', 'broad', 'section'],
                        description: '搜索模式：precise(精确)、broad(广泛)、section(按章节聚合)',
                    },
                    aggregate_adjacent: {
                        type: 'boolean',
                        description: '是否合并相邻内容，默认 true',
                    },
                    include_context: {
                        type: 'boolean',
                        description: '是否包含上下文，默认 true',
                    },
                    top_k: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20,
                        description: '返回的结果数量，默认根据模式自动决定',
                    },
                    kb_ids: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: '可选，指定要搜索的知识库 ID 列表',
                    },
                },
                required: ['query'],
            },
        },
    },
]

/**
 * 工具名称集合（用于检查是否为知识库工具）
 */
export const kbToolNames = new Set([
    'kb_list',
    'kb_get_documents',
    'kb_search',
    'kb_get_document_content',
    // 新增工具
    'kb_get_toc',
    'kb_get_section',
    'kb_search_v2',
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

    /**
     * 处理知识库工具调用
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
                case 'kb_list':
                    return await this.handleList()

                case 'kb_get_documents':
                    return await this.handleGetDocuments(args.kb_id as number)

                case 'kb_search': {
                    const searchMode = (args.search_mode as string) || 'precise'
                    // 根据搜索模式决定默认 topK
                    let defaultTopK = 5
                    if (searchMode === 'broad') defaultTopK = 10
                    if (searchMode === 'overview') defaultTopK = 8
                    const topK = (args.top_k as number) || defaultTopK
                    const kbIds = (args.kb_ids as number[]) || this.knowledgeBaseIds
                    return await this.handleSearch(
                        args.query as string,
                        topK,
                        searchMode as 'precise' | 'broad' | 'overview',
                        kbIds
                    )
                }

                case 'kb_get_document_content': {
                    const pages = args.pages as number[] | undefined
                    const sampleMode = (args.sample_mode as string) || 'full'
                    if (pages && Array.isArray(pages) && pages.length > 0) {
                        return await this.handleGetPages(
                            args.document_id as number,
                            pages,
                            sampleMode as 'full' | 'summary' | 'headings'
                        )
                    }
                    return await this.handleGetDocumentContent(
                        args.document_id as number,
                        args.page_number as number | undefined,
                        args.start_page as number | undefined,
                        args.end_page as number | undefined,
                        sampleMode as 'full' | 'summary' | 'headings'
                    )
                }

                // ========== 新增工具 ==========
                case 'kb_get_toc':
                    return await this.handleGetTOC(
                        args.document_id as number,
                        args.max_level as number | undefined
                    )

                case 'kb_get_section':
                    return await this.handleGetSection(
                        args.document_id as number,
                        args.section_path as string,
                        args.include_children as boolean | undefined
                    )

                case 'kb_search_v2': {
                    const kbIds = (args.kb_ids as number[]) || this.knowledgeBaseIds
                    return await this.handleSearchV2(
                        args.query as string,
                        args.search_mode as 'precise' | 'broad' | 'section' | undefined,
                        args.aggregate_adjacent as boolean | undefined,
                        args.include_context as boolean | undefined,
                        args.top_k as number | undefined,
                        kbIds
                    )
                }

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

    /**
     * 处理列出知识库
     */
    private async handleList(): Promise<{
        success: boolean
        result: unknown
    }> {
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

    /**
     * 处理获取知识库文档列表
     */
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

    /**
     * 处理语义搜索（增强版）
     * 支持搜索模式和指定知识库
     */
    private async handleSearch(
        query: string,
        topK: number,
        searchMode: 'precise' | 'broad' | 'overview' = 'precise',
        kbIds: number[] = this.knowledgeBaseIds
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

        // 验证 kb_ids 有效性
        const validKbIds = kbIds.filter((id) => this.knowledgeBaseIds.includes(id))
        if (validKbIds.length === 0) {
            return {
                success: false,
                result: null,
                error: '没有有效的知识库可供搜索',
                // @ts-ignore
                suggestion: `当前可用的知识库 ID: ${this.knowledgeBaseIds.join(', ')}`,
            }
        }

        const searchResult = await this.kbService.search(validKbIds, query, searchMode)

        // 如果没有结果，提供替代建议
        if (searchResult.hits.length === 0) {
            return {
                success: true,
                result: {
                    query,
                    searchMode,
                    totalHits: 0,
                    queryTimeMs: searchResult.queryTime,
                    hits: [],
                    suggestion: '未找到相关内容，建议：1) 尝试更换关键词 2) 使用 kb_get_document_content 浏览文档内容',
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
                hits: searchResult.hits.slice(0, topK).map((hit: any) => ({
                    // 文档 ID（用于 kb_get_document_content 调用）
                    documentId: hit.documentId,
                    documentName: hit.documentName,
                    pageNumber: hit.metadata?.pageNumber || null,
                    // 新增：页面位置标识
                    pagePosition: hit.metadata?.pagePosition || null,
                    // 新增：内容锚点
                    anchor: hit.content.trim().substring(0, 40) + '...',
                    content: hit.content,
                    score: Math.round(hit.score * 100) / 100,
                    knowledgeBaseName: hit.metadata?.knowledgeBaseName || null,
                })),
                // 如果是 overview 模式，给出阅读建议
                suggestion: searchMode === 'overview'
                    ? '以上是知识库各部分的代表性内容，如需详细了解某部分，请使用 kb_get_document_content 查看'
                    : undefined,
            },
        }
    }

    /**
     * 处理获取文档内容（增强版）
     * 支持采样模式
     */
    private async handleGetDocumentContent(
        documentId: number,
        pageNumber?: number,
        startPage?: number,
        endPage?: number,
        sampleMode: 'full' | 'summary' | 'headings' = 'full'
    ): Promise<{
        success: boolean
        result: unknown
        error?: string
    }> {
        if (!documentId) {
            return {
                success: false,
                result: null,
                error: '文档 ID 不能为空',
            }
        }

        // 验证文档属于当前选择的知识库
        const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(
            documentId,
            this.knowledgeBaseIds
        )
        if (!isDocumentInKb) {
            return {
                success: false,
                result: null,
                error: `文档 ${documentId} 不属于当前选择的知识库`,
                // @ts-ignore
                suggestion: '请先使用 kb_get_documents 获取有效的文档 ID',
            }
        }

        // 获取文档内容
        const content = await this.kbService.getDocumentContent(
            documentId,
            pageNumber,
            startPage,
            endPage
        )

        if (!content) {
            return {
                success: true,
                result: {
                    found: false,
                    message: pageNumber
                        ? `未找到文档 ${documentId} 第 ${pageNumber} 页的内容`
                        : `未找到文档 ${documentId} 的内容`,
                    suggestion: '该页面可能为扫描件图片，无法提取文字。建议使用 kb_search 搜索其他内容',
                },
            }
        }

        // 根据采样模式处理内容
        let processedText = content.text
        if (sampleMode === 'summary') {
            // 只返回首段（前300字符）
            const firstPara = content.text.split('\n\n')[0] || content.text
            processedText = firstPara.substring(0, 300) + (firstPara.length > 300 ? '...' : '')
        } else if (sampleMode === 'headings') {
            // 提取可能的标题行
            const lines = content.text.split('\n')
            const headings = lines.filter((line) => {
                const trimmed = line.trim()
                if (!trimmed) return false
                if (trimmed.length < 60 && trimmed.length > 2) return true
                if (/^[0-9一二三四五六七八九十]+[.、)）]/.test(trimmed)) return true
                return false
            })
            processedText = headings.slice(0, 10).join('\n') || content.text.substring(0, 200)
        }

        return {
            success: true,
            result: {
                found: true,
                sampleMode,
                documentId,
                documentName: content.documentName,
                pageCount: content.pageCount,
                requestedPages: pageNumber
                    ? [pageNumber]
                    : startPage && endPage
                        ? { start: startPage, end: endPage }
                        : 'all',
                content: processedText,
                truncated: content.truncated,
                note: content.truncated
                    ? '内容过长，已截断。请使用 page_number 或 start_page/end_page 参数获取特定页面。'
                    : undefined,
            },
        }
    }

    /**
     * 处理获取多个不连续页面（新增）
     * 支持稀疏页码列表
     */
    private async handleGetPages(
        documentId: number,
        pages: number[],
        sampleMode: 'full' | 'summary' | 'headings' = 'full'
    ): Promise<{
        success: boolean
        result: unknown
        error?: string
    }> {
        if (!documentId) {
            return {
                success: false,
                result: null,
                error: '文档 ID 不能为空',
            }
        }

        // 验证文档属于当前选择的知识库
        const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(
            documentId,
            this.knowledgeBaseIds
        )
        if (!isDocumentInKb) {
            return {
                success: false,
                result: null,
                error: `文档 ${documentId} 不属于当前选择的知识库`,
            }
        }

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
            content: string
            found: boolean
        }> = []

        // 逐页获取内容
        for (const pageNum of validPages) {
            const content = await this.kbService.getDocumentContent(documentId, pageNum)

            if (content && content.text) {
                let text = content.text

                // 根据采样模式处理
                if (sampleMode === 'summary') {
                    const firstPara = text.split('\n\n')[0] || text
                    text = firstPara.substring(0, 300) + (firstPara.length > 300 ? '...' : '')
                } else if (sampleMode === 'headings') {
                    const lines = text.split('\n')
                    const headings = lines.filter((line) => {
                        const trimmed = line.trim()
                        return trimmed && trimmed.length < 60 && trimmed.length > 2
                    })
                    text = headings.slice(0, 5).join('\n') || text.substring(0, 100)
                }

                results.push({
                    pageNumber: pageNum,
                    content: text,
                    found: true,
                })
            } else {
                results.push({
                    pageNumber: pageNum,
                    content: '',
                    found: false,
                })
            }
        }

        const foundCount = results.filter((r) => r.found).length

        return {
            success: true,
            result: {
                documentId,
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

    // ==================== 新增工具处理方法 ====================

    /**
     * 处理获取文档目录结构
     */
    private async handleGetTOC(
        documentId: number,
        maxLevel?: number
    ): Promise<{
        success: boolean
        result: unknown
        error?: string
    }> {
        if (!documentId) {
            return {
                success: false,
                result: null,
                error: '文档 ID 不能为空',
            }
        }

        // 验证文档属于当前选择的知识库
        const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(
            documentId,
            this.knowledgeBaseIds
        )
        if (!isDocumentInKb) {
            return {
                success: false,
                result: null,
                error: `文档 ${documentId} 不属于当前选择的知识库`,
            }
        }

        // 检查 sectionService 是否可用
        if (!this.sectionService) {
            return {
                success: false,
                result: null,
                error: '章节服务不可用，请确保已启用文档结构提取功能',
            }
        }

        try {
            const toc = await this.sectionService.getDocumentTOC(
                documentId,
                maxLevel ?? 3
            )

            if (toc.length === 0) {
                return {
                    success: true,
                    result: {
                        documentId,
                        hasTOC: false,
                        message: '该文档没有提取到目录结构。可能是因为文档没有书签或标题格式不标准。',
                        suggestion: '请使用 kb_get_document_content 按页浏览文档内容。',
                    },
                }
            }

            // 格式化目录树
            const formatTOC = (sections: any[], indent: number = 0): string => {
                return sections.map((s: any) => {
                    const prefix = '  '.repeat(indent)
                    const pageInfo = s.startPage ? ` (第${s.startPage}页)` : ''
                    let line = `${prefix}${s.path} ${s.title}${pageInfo}`
                    if (s.children && s.children.length > 0) {
                        line += '\n' + formatTOC(s.children, indent + 1)
                    }
                    return line
                }).join('\n')
            }

            return {
                success: true,
                result: {
                    documentId,
                    hasTOC: true,
                    sectionCount: toc.length,
                    maxLevel: maxLevel ?? 3,
                    toc: toc,
                    formatted: formatTOC(toc),
                    usage: '使用 kb_get_section 可以获取指定章节的完整内容',
                },
            }
        } catch (error) {
            return {
                success: false,
                result: null,
                error: error instanceof Error ? error.message : '获取目录结构失败',
            }
        }
    }

    /**
     * 处理获取章节内容
     */
    private async handleGetSection(
        documentId: number,
        sectionPath: string,
        includeChildren: boolean = true
    ): Promise<{
        success: boolean
        result: unknown
        error?: string
    }> {
        if (!documentId) {
            return {
                success: false,
                result: null,
                error: '文档 ID 不能为空',
            }
        }

        if (!sectionPath) {
            return {
                success: false,
                result: null,
                error: '章节路径不能为空',
            }
        }

        // 验证文档属于当前选择的知识库
        const isDocumentInKb = await this.kbService.isDocumentInKnowledgeBases(
            documentId,
            this.knowledgeBaseIds
        )
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
                error: '章节服务不可用',
            }
        }

        try {
            // 先尝试按路径查找
            let section = await this.sectionService.getSectionByPath(documentId, sectionPath)

            // 如果按路径找不到，尝试按标题搜索
            if (!section) {
                const sections = await this.sectionService.searchSectionsByTitle(documentId, sectionPath)
                if (sections.length > 0) {
                    section = sections[0]
                }
            }

            if (!section) {
                return {
                    success: true,
                    result: {
                        found: false,
                        message: `未找到章节 "${sectionPath}"`,
                        suggestion: '请使用 kb_get_toc 查看完整目录结构，确认章节路径',
                    },
                }
            }

            // 获取章节内容
            const sectionContent = await this.sectionService.getSectionContent(
                section.id,
                includeChildren
            )

            if (!sectionContent) {
                return {
                    success: true,
                    result: {
                        found: true,
                        section: {
                            id: section.id,
                            title: section.title,
                            path: section.path,
                            level: section.level,
                        },
                        content: '',
                        message: '章节存在但没有提取到内容',
                    },
                }
            }

            return {
                success: true,
                result: {
                    found: true,
                    section: {
                        id: section.id,
                        title: section.title,
                        path: section.path,
                        level: section.level,
                        startPage: section.startPage,
                        endPage: section.endPage,
                    },
                    includeChildren,
                    chunkCount: sectionContent.chunks.length,
                    content: sectionContent.content,
                },
            }
        } catch (error) {
            return {
                success: false,
                result: null,
                error: error instanceof Error ? error.message : '获取章节内容失败',
            }
        }
    }

    /**
     * 处理增强版搜索
     */
    private async handleSearchV2(
        query: string,
        searchMode: 'precise' | 'broad' | 'section' = 'precise',
        aggregateAdjacent: boolean = true,
        includeContext: boolean = true,
        topK?: number,
        kbIds: number[] = this.knowledgeBaseIds
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

        // 验证 kb_ids 有效性
        const validKbIds = kbIds.filter((id) => this.knowledgeBaseIds.includes(id))
        if (validKbIds.length === 0) {
            return {
                success: false,
                result: null,
                error: '没有有效的知识库可供搜索',
            }
        }

        // 如果没有增强服务，回退到普通搜索
        if (!this.enhancedRagService) {
            console.log('[KBTools] EnhancedRAGService not available, falling back to regular search')
            return this.handleSearch(query, topK ?? 5, searchMode === 'section' ? 'broad' : searchMode as any, validKbIds)
        }

        try {
            // 获取所有相关文档ID
            const documentIds = await this.kbService.getDocumentIdsFromMultiple(validKbIds)

            if (documentIds.length === 0) {
                return {
                    success: true,
                    result: {
                        query,
                        searchMode,
                        totalHits: 0,
                        hits: [],
                        message: '知识库中没有可搜索的文档',
                    },
                }
            }

            // 使用增强版搜索
            const result = await this.enhancedRagService.search(documentIds, query, {
                mode: searchMode,
                aggregateAdjacent,
                groupBySection: true,
                includeContext,
                contextSize: 1,
                topK,
            })

            // 格式化结果
            const formattedHits = result.hits.map((hit: any) => ({
                documentId: hit.documentId,
                documentName: hit.documentName,
                section: hit.section ? {
                    title: hit.section.title,
                    path: hit.section.path,
                } : null,
                score: Math.round(hit.score * 100) / 100,
                content: hit.content,
                aggregatedChunks: hit.aggregatedFrom?.length ?? 1,
                hasContext: !!(hit.contextBefore || hit.contextAfter),
            }))

            return {
                success: true,
                result: {
                    query,
                    searchMode,
                    aggregateAdjacent,
                    totalHits: result.totalHits,
                    returnedHits: formattedHits.length,
                    hits: formattedHits,
                    aggregationStats: result.aggregationStats,
                    context: result.context,
                    suggestion: result.hits.length > 0
                        ? '如需查看完整章节内容，可使用 kb_get_section 工具'
                        : '未找到相关内容，建议更换关键词或使用 broad 模式',
                },
            }
        } catch (error) {
            return {
                success: false,
                result: null,
                error: error instanceof Error ? error.message : '搜索失败',
            }
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
                : `已获取文档列表`

        case 'kb_search':
            return stage === 'start'
                ? `在知识库中搜索：${args.query}`
                : '搜索完成，已获取相关内容'

        case 'kb_get_document_content':
            const pageInfo = args.page_number
                ? `第 ${args.page_number} 页`
                : args.start_page && args.end_page
                    ? `第 ${args.start_page}-${args.end_page} 页`
                    : '完整内容'
            return stage === 'start'
                ? `获取文档 ${args.document_id} 的${pageInfo}...`
                : '已获取文档内容'

        // 新增工具
        case 'kb_get_toc':
            return stage === 'start'
                ? `获取文档 ${args.document_id} 的目录结构...`
                : '已获取文档目录'

        case 'kb_get_section':
            return stage === 'start'
                ? `获取章节 "${args.section_path}" 的内容...`
                : '已获取章节内容'

        case 'kb_search_v2':
            return stage === 'start'
                ? `使用增强搜索查询：${args.query}`
                : '搜索完成，已聚合相关内容'

        default:
            return `执行知识库工具：${toolName}`
    }
}
