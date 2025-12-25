/**
 * 文档结构类型定义
 */

export interface DocumentSection {
  id?: number;
  documentId: number;
  parentId?: number | null;
  level: number;          // 1=章, 2=节, 3=小节
  title: string;
  path: string;           // 如 "1", "1.2", "1.2.3"
  startPage?: number;
  endPage?: number;
  startChunk?: number;
  endChunk?: number;
  detectionMethod: 'pdf_outline' | 'heuristic';
  confidence: number;     // 0-1
  metadata?: Record<string, unknown>;
  children?: DocumentSection[];
}

export interface StructureExtractionResult {
  sections: DocumentSection[];
  hasPdfOutline: boolean;
  detectionMethod: 'pdf_outline' | 'heuristic' | 'none';
  totalSections: number;
  maxLevel: number;
}

export interface PDFOutlineItem {
  title: string;
  dest?: string | any[];
  url?: string;
  bold?: boolean;
  italic?: boolean;
  color?: number[];
  count?: number;
  items?: PDFOutlineItem[];
}

export interface ChunkWithMetadata {
  chunkIndex: number;
  content: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
}