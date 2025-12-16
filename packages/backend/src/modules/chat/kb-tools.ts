/**
 * 知识库工具模块
 * 提供 AI 可调用的知识库检索和查看工具
 */

import type { KnowledgeBaseService } from '../../services/knowledge-base/knowledge-base-service'
import type { RAGService } from '../../services/document/rag-service'

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
]

/**
 * 工具名称集合（用于检查是否为知识库工具）
 */
export const kbToolNames = new Set([
    'kb_list',
    'kb_get_documents',
    'kb_search',
    'kb_get_document_content',
])

/**
 * 知识库工具处理器
 */
export class KBToolHandler {
    private kbService: KnowledgeBaseService
    private ragService: RAGService
    private knowledgeBaseIds: number[]

    constructor(
        kbService: KnowledgeBaseService,
        ragService: RAGService,
        knowledgeBaseIds: number[]
    ) {
        this.kbService = kbService
        this.ragService = ragService
        this.knowledgeBaseIds = knowledgeBaseIds
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

        default:
            return `执行知识库工具：${toolName}`
    }
}
