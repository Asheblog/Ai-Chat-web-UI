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
            description:
                '列出用户当前选择的知识库概要信息，包括知识库名称、文档数量、分块数量等。在回答知识库相关问题前，可先调用此工具了解知识库结构。',
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
            description:
                '获取指定知识库中的文档列表。返回每个文档的名称、状态、分块数量等信息。',
            parameters: {
                type: 'object',
                properties: {
                    kb_id: {
                        type: 'integer',
                        description: '知识库 ID',
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
            description:
                '在知识库中进行语义搜索，找出与查询最相关的内容片段。用于回答"知识库中关于XXX的内容"、"搜索关于YYY的资料"等问题。',
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
                        description: '返回的结果数量，默认 5',
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
            description:
                '获取知识库中某个文档的完整内容或指定页的内容。当用户询问"这个文档讲了什么"或"第X页是什么内容"时使用。',
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

                case 'kb_search':
                    return await this.handleSearch(
                        args.query as string,
                        (args.top_k as number) || 5
                    )

                case 'kb_get_document_content':
                    return await this.handleGetDocumentContent(
                        args.document_id as number,
                        args.page_number as number | undefined,
                        args.start_page as number | undefined,
                        args.end_page as number | undefined
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

        if (this.knowledgeBaseIds.length === 0) {
            return {
                success: false,
                result: null,
                error: '没有选择任何知识库',
            }
        }

        const searchResult = await this.kbService.search(this.knowledgeBaseIds, query)

        return {
            success: true,
            result: {
                query,
                totalHits: searchResult.totalHits,
                queryTimeMs: searchResult.queryTime,
                hits: searchResult.hits.slice(0, topK).map((hit: any) => ({
                    documentName: hit.documentName,
                    pageNumber: hit.metadata?.pageNumber || null,
                    content: hit.content,
                    score: Math.round(hit.score * 100) / 100,
                    knowledgeBaseName: hit.metadata?.knowledgeBaseName || null,
                })),
            },
        }
    }

    /**
     * 处理获取文档内容
     */
    private async handleGetDocumentContent(
        documentId: number,
        pageNumber?: number,
        startPage?: number,
        endPage?: number
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
                },
            }
        }

        return {
            success: true,
            result: {
                found: true,
                documentId,
                documentName: content.documentName,
                pageCount: content.pageCount,
                requestedPages: pageNumber
                    ? [pageNumber]
                    : startPage && endPage
                        ? { start: startPage, end: endPage }
                        : 'all',
                content: content.text,
                truncated: content.truncated,
                note: content.truncated
                    ? '内容过长，已截断。请使用 page_number 或 start_page/end_page 参数获取特定页面。'
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
