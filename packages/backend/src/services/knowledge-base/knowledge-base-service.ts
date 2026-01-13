/**
 * 知识库服务
 * 提供知识库的 CRUD 操作和文档管理
 */

import { PrismaClient, KnowledgeBase, Document } from '@prisma/client'
import { getDocumentServices } from '../document-services-factory'
import type { RAGResult } from '../document/rag-service'
import type { EnhancedRAGService } from '../document/enhanced-rag-service'
import type { DocumentContentResult } from '../document/document-service'
import { createLogger } from '../../utils/logger'

const log = createLogger('KB')

export interface KnowledgeBaseCreateInput {
  name: string
  description?: string
  ownerId?: number | null
  isPublic?: boolean
}

export interface KnowledgeBaseUpdateInput {
  name?: string
  description?: string
  isPublic?: boolean
  status?: 'active' | 'disabled'
}

export interface KnowledgeBaseWithDocuments extends KnowledgeBase {
  documents: Array<{
    id: number
    documentId: number
    addedAt: Date
    document: Document
  }>
}

export interface KnowledgeBaseListItem {
  id: number
  name: string
  description: string | null
  ownerId: number | null
  isPublic: boolean
  status: string
  documentCount: number
  totalChunks: number
  createdAt: Date
  updatedAt: Date
}

export class KnowledgeBaseService {
  constructor(private prisma: PrismaClient) { }

  /**
   * 创建知识库
   */
  async create(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase> {
    return this.prisma.knowledgeBase.create({
      data: {
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        isPublic: input.isPublic ?? true,
      },
    })
  }

  /**
   * 获取知识库列表
   * @param options.ownerId - 只获取指定用户的知识库
   * @param options.includePublic - 是否包含公共知识库
   * @param options.adminView - 管理员视图，返回所有知识库
   */
  async list(options: {
    ownerId?: number | null
    includePublic?: boolean
    adminView?: boolean
  } = {}): Promise<KnowledgeBaseListItem[]> {
    const { ownerId, includePublic = true, adminView = false } = options

    let where: any = {}

    if (adminView) {
      // 管理员可以看到所有知识库
    } else if (ownerId !== undefined) {
      // 用户可以看到自己的知识库和公共知识库
      if (includePublic) {
        where = {
          OR: [
            { ownerId: ownerId },
            { isPublic: true, ownerId: null },
          ],
        }
      } else {
        where = { ownerId }
      }
    } else {
      // 未登录用户只能看到公共知识库
      where = { isPublic: true, ownerId: null }
    }

    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return knowledgeBases.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      ownerId: kb.ownerId,
      isPublic: kb.isPublic,
      status: kb.status,
      documentCount: kb.documentCount,
      totalChunks: kb.totalChunks,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    }))
  }

  /**
   * 获取知识库详情
   */
  async get(id: number): Promise<KnowledgeBaseWithDocuments | null> {
    return this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        documents: {
          include: {
            document: true,
          },
          orderBy: { addedAt: 'desc' },
        },
      },
    })
  }

  /**
   * 更新知识库
   */
  async update(id: number, input: KnowledgeBaseUpdateInput): Promise<KnowledgeBase> {
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: input,
    })
  }

  /**
   * 删除知识库
   * 同时彻底删除所有关联文档的物理文件和向量数据
   */
  async delete(id: number): Promise<void> {
    // 先获取知识库及其文档
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        documents: {
          include: { document: true },
        },
      },
    })

    if (!kb) return

    // 收集需要删除的文档ID
    const documentIds = kb.documents.map((d) => d.documentId)

    // 删除知识库（级联删除关联关系）
    await this.prisma.knowledgeBase.delete({
      where: { id },
    })

    // 彻底删除不再被任何知识库引用的文档
    const services = getDocumentServices()
    if (services && documentIds.length > 0) {
      for (const documentId of documentIds) {
        // 检查文档是否还被其他知识库引用
        const otherReferences = await this.prisma.knowledgeBaseDocument.count({
          where: { documentId },
        })

        if (otherReferences === 0) {
          try {
            await services.documentService.deleteDocument(documentId)
            log.debug(`Deleted orphaned document ${documentId}`)
          } catch (err) {
            log.error(`Failed to delete document ${documentId}:`, err)
          }
        }
      }
    }
  }

  /**
   * 添加文档到知识库
   */
  async addDocument(knowledgeBaseId: number, documentId: number): Promise<void> {
    // 检查知识库是否存在
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    })
    if (!kb) {
      throw new Error('Knowledge base not found')
    }

    // 检查文档是否存在
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    })
    if (!doc) {
      throw new Error('Document not found')
    }

    // 添加关联（忽略已存在的关联）
    await this.prisma.knowledgeBaseDocument.upsert({
      where: {
        knowledgeBaseId_documentId: {
          knowledgeBaseId,
          documentId,
        },
      },
      create: {
        knowledgeBaseId,
        documentId,
      },
      update: {},
    })

    // 更新统计
    await this.updateStats(knowledgeBaseId)
  }

  /**
   * 从知识库移除文档
   * 同时彻底删除文档的物理文件、向量数据和数据库记录
   */
  async removeDocument(knowledgeBaseId: number, documentId: number): Promise<void> {
    // 首先删除关联关系
    await this.prisma.knowledgeBaseDocument.deleteMany({
      where: {
        knowledgeBaseId,
        documentId,
      },
    })

    // 检查文档是否还被其他知识库引用
    const otherReferences = await this.prisma.knowledgeBaseDocument.count({
      where: { documentId },
    })

    // 如果没有其他引用，彻底删除文档
    if (otherReferences === 0) {
      const services = getDocumentServices()
      if (services) {
        try {
          await services.documentService.deleteDocument(documentId)
          log.debug(`Deleted document ${documentId}`)
        } catch (err) {
          log.error(`Failed to delete document ${documentId}:`, err)
        }
      }
    }

    // 更新统计
    await this.updateStats(knowledgeBaseId)
  }

  /**
   * 批量从知识库移除文档
   * @param knowledgeBaseId - 知识库ID
   * @param documentIds - 要移除的文档ID列表
   * @returns 成功移除的数量
   */
  async removeDocuments(knowledgeBaseId: number, documentIds: number[]): Promise<{ removed: number; deleted: number }> {
    if (documentIds.length === 0) {
      return { removed: 0, deleted: 0 }
    }

    // 批量删除关联关系
    const result = await this.prisma.knowledgeBaseDocument.deleteMany({
      where: {
        knowledgeBaseId,
        documentId: { in: documentIds },
      },
    })

    // 检查哪些文档不再被任何知识库引用
    const orphanedDocIds: number[] = []
    for (const documentId of documentIds) {
      const otherReferences = await this.prisma.knowledgeBaseDocument.count({
        where: { documentId },
      })
      if (otherReferences === 0) {
        orphanedDocIds.push(documentId)
      }
    }

    // 批量删除不再被引用的文档
    let deleted = 0
    if (orphanedDocIds.length > 0) {
      const services = getDocumentServices()
      if (services) {
        try {
          const deleteResult = await services.documentService.deleteDocuments(orphanedDocIds)
          deleted = deleteResult.deleted
          log.debug(`Batch removed ${result.count} refs, deleted ${deleted} orphaned docs`)
        } catch (err) {
          log.error('Failed to batch delete documents:', err)
        }
      }
    }

    // 更新统计
    await this.updateStats(knowledgeBaseId)

    return { removed: result.count, deleted }
  }


  /**
   * 更新知识库统计信息（公开方法，可用于手动刷新）
   */
  async updateStats(knowledgeBaseId: number): Promise<void> {
    // 统计文档数
    const documentCount = await this.prisma.knowledgeBaseDocument.count({
      where: { knowledgeBaseId },
    })

    // 统计总 chunk 数
    const kbDocs = await this.prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId },
      include: { document: true },
    })

    const totalChunks = kbDocs.reduce((sum, kbDoc) => sum + (kbDoc.document.chunkCount || 0), 0)

    await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: { documentCount, totalChunks },
    })
  }

  /**
   * 获取知识库的文档ID列表
   */
  async getDocumentIds(knowledgeBaseId: number): Promise<number[]> {
    const docs = await this.prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId },
      select: { documentId: true },
    })
    return docs.map((d) => d.documentId)
  }

  /**
   * 获取多个知识库的文档ID列表
   */
  async getDocumentIdsFromMultiple(knowledgeBaseIds: number[]): Promise<number[]> {
    const docs = await this.prisma.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId: { in: knowledgeBaseIds },
      },
      select: { documentId: true },
    })
    // 去重
    return [...new Set(docs.map((d) => d.documentId))]
  }

  /**
   * 在知识库中检索（增强版）
   * 支持搜索模式
   */
  async search(
    knowledgeBaseIds: number[],
    query: string,
    searchMode: 'precise' | 'broad' | 'overview' = 'precise'
  ): Promise<RAGResult> {
    const services = getDocumentServices()
    if (!services) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: 0,
      }
    }

    // 获取所有相关文档ID
    const documentIds = await this.getDocumentIdsFromMultiple(knowledgeBaseIds)

    if (documentIds.length === 0) {
      return {
        hits: [],
        context: '',
        totalHits: 0,
        queryTime: 0,
      }
    }

    // 优先使用增强检索（如果可用）
    const enhanced = (services as { enhancedRagService?: EnhancedRAGService }).enhancedRagService
    if (enhanced) {
      const mode = searchMode === 'overview' ? 'overview' : searchMode
      return enhanced.search(documentIds, query, {
        mode,
        aggregateAdjacent: true,
        groupBySection: true,
        includeContext: true,
        contextSize: 1,
        ensureDocumentCoverage: documentIds.length > 1,
      })
    }

    return services.ragService.searchInDocuments(documentIds, query, searchMode)
  }

  /**
   * 检查用户是否有权限访问知识库
   */
  async canAccess(
    knowledgeBaseId: number,
    userId: number | null,
    isAdmin: boolean
  ): Promise<boolean> {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    })

    if (!kb) return false

    // 管理员可以访问所有
    if (isAdmin) return true

    // 公共知识库任何人可以访问
    if (kb.isPublic && kb.ownerId === null) return true

    // 私有知识库只有所有者可以访问
    if (kb.ownerId === userId) return true

    return false
  }

  /**
   * 检查用户是否有权限修改知识库
   */
  async canModify(
    knowledgeBaseId: number,
    userId: number | null,
    isAdmin: boolean
  ): Promise<boolean> {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    })

    if (!kb) return false

    // 管理员可以修改所有
    if (isAdmin) return true

    // 只有所有者可以修改
    if (kb.ownerId === userId) return true

    return false
  }

  /**
   * 获取用户可用的知识库列表（用于聊天选择）
   */
  async getAvailableForChat(
    userId: number | null,
    isAnonymous: boolean,
    settings: {
      knowledgeBaseEnabled: boolean
      knowledgeBaseAllowAnonymous: boolean
      knowledgeBaseAllowUsers: boolean
    }
  ): Promise<KnowledgeBaseListItem[]> {
    // 检查功能是否启用
    if (!settings.knowledgeBaseEnabled) {
      return []
    }

    // 检查用户权限
    if (isAnonymous && !settings.knowledgeBaseAllowAnonymous) {
      return []
    }
    if (!isAnonymous && userId && !settings.knowledgeBaseAllowUsers) {
      return []
    }

    // 获取可用的知识库
    return this.list({
      ownerId: userId,
      includePublic: true,
    })
  }

  /**
   * 检查文档是否属于指定的知识库列表
   */
  async isDocumentInKnowledgeBases(
    documentId: number,
    knowledgeBaseIds: number[]
  ): Promise<boolean> {
    if (!knowledgeBaseIds.length) return false

    const count = await this.prisma.knowledgeBaseDocument.count({
      where: {
        documentId,
        knowledgeBaseId: { in: knowledgeBaseIds },
      },
    })

    return count > 0
  }

  /**
   * 获取文档内容（用于知识库工具）
   * 注意：pageNumber 存储在 chunk.metadata JSON 中，不是直接字段
   */
  async getDocumentContent(
    documentId: number,
    options: {
      pageNumber?: number
      startPage?: number
      endPage?: number
      pages?: number[]
      sampleMode?: 'full' | 'summary' | 'headings'
    } = {}
  ): Promise<DocumentContentResult | null> {
    const services = getDocumentServices()
    if (!services) return null
    return services.documentService.getDocumentContent(documentId, options)
  }
}
