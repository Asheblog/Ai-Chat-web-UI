/**
 * 文档章节服务
 * 提供章节的 CRUD 操作
 *
 * 注意：在运行 `prisma generate` 之前，部分类型使用 any
 * 运行 `pnpm --filter backend prisma generate` 后类型将完全可用
 */

import type { PrismaClient } from '@prisma/client'
import type { DocumentSection, ChunkWithMetadata, StructureExtractionResult } from '../../modules/document/structure/types'
import { PDFStructureExtractor } from '../../modules/document/structure'

// Prisma 生成后可替换为具体类型
type PrismaDocumentSection = {
  id: number
  documentId: number
  parentId: number | null
  level: number
  title: string
  path: string
  startPage: number | null
  endPage: number | null
  startChunk: number | null
  endChunk: number | null
  detectionMethod: string
  confidence: number
  metadata: string
  createdAt: Date
}

export interface SectionTreeNode extends PrismaDocumentSection {
  children: SectionTreeNode[]
}

export class DocumentSectionService {
  // 使用 any 类型以兼容 Prisma 生成前后的类型
  private prisma: any
  private extractor: PDFStructureExtractor
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma as any
    this.extractor = new PDFStructureExtractor()
  }
  
  /**
   * 从文档 chunks 提取并保存章节结构
   */
  async extractAndSave(
    documentId: number,
    chunks: ChunkWithMetadata[],
    pdfOutline?: any[] | null
  ): Promise<StructureExtractionResult> {
    // 提取结构
    const result = this.extractor.extract(documentId, pdfOutline || null, chunks)
    
    if (result.sections.length === 0) {
      return result
    }
    
    // 保存到数据库
    await this.saveSections(documentId, result.sections)
    
    // 更新 chunks 的 sectionId
    await this.updateChunkSections(documentId, result.sections, chunks)
    
    return result
  }
  
  /**
   * 保存章节到数据库
   */
  async saveSections(documentId: number, sections: DocumentSection[]): Promise<void> {
    // 先删除现有章节
    await this.prisma.documentSection.deleteMany({
      where: { documentId },
    })
    
    // 按层级和路径排序，确保父节点先创建
    const sortedSections = [...sections].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      return a.path.localeCompare(b.path)
    })
    
    // 路径到 ID 的映射
    const pathToId = new Map<string, number>()
    
    // 逐个创建章节
    for (const section of sortedSections) {
      // 查找父节点 ID
      let parentId: number | null = null
      if (section.level > 1) {
        const parentPath = section.path.split('.').slice(0, -1).join('.')
        parentId = pathToId.get(parentPath) ?? null
      }
      
      const created = await this.prisma.documentSection.create({
        data: {
          documentId: section.documentId,
          parentId,
          level: section.level,
          title: section.title,
          path: section.path,
          startPage: section.startPage,
          endPage: section.endPage,
          startChunk: section.startChunk,
          endChunk: section.endChunk,
          detectionMethod: section.detectionMethod,
          confidence: section.confidence,
          metadata: JSON.stringify(section.metadata || {}),
        },
      })
      
      pathToId.set(section.path, created.id)
    }
  }
  
  /**
   * 更新 chunks 的 sectionId
   */
  async updateChunkSections(
    documentId: number,
    sections: DocumentSection[],
    chunks: ChunkWithMetadata[]
  ): Promise<void> {
    // 获取保存后的章节（带 ID）
    const savedSections = await this.prisma.documentSection.findMany({
      where: { documentId },
      orderBy: { path: 'asc' },
    })
    
    if (savedSections.length === 0) return
    
    // 按 startChunk 排序
    const sortedSections = [...savedSections].sort((a, b) => 
      (a.startChunk ?? 0) - (b.startChunk ?? 0)
    )
    
    // 为每个 chunk 找到对应的 section
    for (const chunk of chunks) {
      let sectionId: number | null = null
      
      for (let i = 0; i < sortedSections.length; i++) {
        const section = sortedSections[i]
        const nextSection = sortedSections[i + 1]
        
        const startChunk = section.startChunk ?? 0
        const endChunk = nextSection?.startChunk 
          ? nextSection.startChunk - 1 
          : Number.MAX_SAFE_INTEGER
        
        if (chunk.chunkIndex >= startChunk && chunk.chunkIndex <= endChunk) {
          sectionId = section.id
          break
        }
      }
      
      if (sectionId !== null) {
        await this.prisma.documentChunk.updateMany({
          where: {
            documentId,
            chunkIndex: chunk.chunkIndex,
          },
          data: {
            sectionId,
          },
        })
      }
    }
  }
  
  /**
   * 获取文档的目录树
   */
  async getDocumentTOC(documentId: number, maxLevel?: number): Promise<SectionTreeNode[]> {
    const sections = await this.prisma.documentSection.findMany({
      where: {
        documentId,
        ...(maxLevel ? { level: { lte: maxLevel } } : {}),
      },
      orderBy: { path: 'asc' },
    })
    
    return this.buildTree(sections)
  }
  
  /**
   * 构建章节树
   */
  private buildTree(sections: PrismaDocumentSection[]): SectionTreeNode[] {
    const nodeMap = new Map<number, SectionTreeNode>()
    const roots: SectionTreeNode[] = []
    
    // 创建节点映射
    for (const section of sections) {
      nodeMap.set(section.id, { ...section, children: [] })
    }
    
    // 构建树
    for (const section of sections) {
      const node = nodeMap.get(section.id)!
      
      if (section.parentId && nodeMap.has(section.parentId)) {
        nodeMap.get(section.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    
    return roots
  }
  
  /**
   * 根据路径获取章节
   */
  async getSectionByPath(documentId: number, path: string): Promise<PrismaDocumentSection | null> {
    return this.prisma.documentSection.findFirst({
      where: {
        documentId,
        path,
      },
    })
  }
  
  /**
   * 根据标题搜索章节
   */
  async searchSectionsByTitle(
    documentId: number,
    query: string
  ): Promise<PrismaDocumentSection[]> {
    return this.prisma.documentSection.findMany({
      where: {
        documentId,
        title: {
          contains: query,
        },
      },
      orderBy: { path: 'asc' },
    })
  }
  
  /**
   * 获取章节内容（包含所有子章节的 chunks）
   */
  async getSectionContent(
    sectionId: number,
    includeChildren: boolean = true
  ): Promise<{
    section: PrismaDocumentSection
    content: string
    chunks: Array<{ chunkIndex: number; content: string }>
  } | null> {
    const section = await this.prisma.documentSection.findUnique({
      where: { id: sectionId },
    })
    
    if (!section) return null
    
    // 获取相关的 chunks
    let sectionIds = [sectionId]
    
    if (includeChildren) {
      // 获取所有子章节 ID
      const childSections = await this.prisma.documentSection.findMany({
        where: {
          documentId: section.documentId,
          path: { startsWith: section.path + '.' },
        },
        select: { id: true },
      })
      sectionIds = [...sectionIds, ...childSections.map((s: any) => s.id)]
    }
    
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        sectionId: { in: sectionIds },
      },
      orderBy: { chunkIndex: 'asc' },
      select: {
        chunkIndex: true,
        content: true,
      },
    })
    
    const content = chunks.map((c: any) => c.content).join('\n\n')
    
    return {
      section,
      content,
      chunks,
    }
  }
  
  /**
   * 删除文档的所有章节
   */
  async deleteSections(documentId: number): Promise<void> {
    await this.prisma.documentSection.deleteMany({
      where: { documentId },
    })
  }
}