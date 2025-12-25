/**
 * PDF 结构提取器
 * 从 PDF 书签/大纲中提取目录结构
 */

import type { DocumentSection, PDFOutlineItem, StructureExtractionResult, ChunkWithMetadata } from './types'
import { HeadingDetector } from './heading-detector'

/**
 * 从 PDF 大纲构建章节树
 */
function buildSectionsFromOutline(
  documentId: number,
  items: PDFOutlineItem[],
  parentId: number | null = null,
  basePath: string = '',
  level: number = 1
): DocumentSection[] {
  const sections: DocumentSection[] = []
  
  items.forEach((item, index) => {
    const path = basePath ? `${basePath}.${index + 1}` : String(index + 1)
    
    // 提取页码（如果有 dest）
    let startPage: number | undefined
    if (item.dest) {
      // dest 可能是数组，第一个元素通常包含页面引用
      if (Array.isArray(item.dest) && item.dest.length > 0) {
        // 页码需要从 PDF 文档中解析，这里暂时不处理
        // 实际页码需要通过 pdf.js 的 getPageIndex 获取
      }
    }
    
    const section: DocumentSection = {
      documentId,
      parentId,
      level,
      title: item.title.trim(),
      path,
      startPage,
      detectionMethod: 'pdf_outline',
      confidence: 1.0, // PDF 书签是最可靠的
      metadata: {
        hasSubItems: (item.items?.length ?? 0) > 0,
        bold: item.bold,
        italic: item.italic,
      },
    }
    
    sections.push(section)
    
    // 递归处理子项
    if (item.items && item.items.length > 0) {
      const children = buildSectionsFromOutline(
        documentId,
        item.items,
        section.id ?? null, // 需要在保存后填充
        path,
        level + 1
      )
      section.children = children
      sections.push(...children)
    }
  })
  
  return sections
}

export class PDFStructureExtractor {
  private headingDetector: HeadingDetector
  
  constructor() {
    this.headingDetector = new HeadingDetector()
  }
  
  /**
   * 从 PDF 书签提取目录结构
   * 需要 pdf-parse 或 pdf.js 解析后的大纲数据
   */
  extractFromOutline(documentId: number, outline: PDFOutlineItem[]): DocumentSection[] {
    if (!outline || outline.length === 0) {
      return []
    }
    
    return buildSectionsFromOutline(documentId, outline)
  }
  
  /**
   * 启发式检测标题（当 PDF 没有书签时使用）
   */
  detectFromChunks(documentId: number, chunks: ChunkWithMetadata[]): DocumentSection[] {
    return this.headingDetector.detect(documentId, chunks)
  }
  
  /**
   * 综合提取：优先使用 PDF 书签，否则使用启发式检测
   */
  extract(
    documentId: number,
    outline: PDFOutlineItem[] | null,
    chunks: ChunkWithMetadata[]
  ): StructureExtractionResult {
    let sections: DocumentSection[] = []
    let detectionMethod: 'pdf_outline' | 'heuristic' | 'none' = 'none'
    const hasPdfOutline = outline !== null && outline.length > 0
    
    if (hasPdfOutline) {
      // 优先使用 PDF 书签
      sections = this.extractFromOutline(documentId, outline!)
      detectionMethod = 'pdf_outline'
    }
    
    // 如果书签提取结果太少，尝试启发式检测
    if (sections.length < 3) {
      const heuristicSections = this.detectFromChunks(documentId, chunks)
      
      if (heuristicSections.length > sections.length) {
        sections = heuristicSections
        detectionMethod = 'heuristic'
      }
    }
    
    // 计算最大层级
    const maxLevel = sections.reduce((max, s) => Math.max(max, s.level), 0)
    
    return {
      sections,
      hasPdfOutline,
      detectionMethod,
      totalSections: sections.length,
      maxLevel,
    }
  }
  
  /**
   * 将章节与 chunks 关联
   * 根据页码或位置匹配
   */
  associateSectionsWithChunks(
    sections: DocumentSection[],
    chunks: ChunkWithMetadata[]
  ): Map<number, number[]> {
    const sectionChunks = new Map<number, number[]>()
    
    // 按 startChunk 排序章节
    const sortedSections = [...sections].sort((a, b) => 
      (a.startChunk ?? 0) - (b.startChunk ?? 0)
    )
    
    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i]
      const nextSection = sortedSections[i + 1]
      
      const startChunk = section.startChunk ?? 0
      const endChunk = nextSection?.startChunk 
        ? nextSection.startChunk - 1 
        : chunks.length - 1
      
      const chunkIndices: number[] = []
      for (let j = startChunk; j <= endChunk; j++) {
        if (chunks[j]) {
          chunkIndices.push(j)
        }
      }
      
      if (section.id !== undefined) {
        sectionChunks.set(section.id, chunkIndices)
      }
    }
    
    return sectionChunks
  }
}

export { HeadingDetector }