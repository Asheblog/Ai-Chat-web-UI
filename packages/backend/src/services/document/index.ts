/**
 * 文档服务模块导出
 */

export { DocumentService } from './document-service'
export type {
  DocumentServiceConfig,
  UploadResult,
  ProcessingProgress,
  ProgressCallback,
} from './document-service'

export { EmbeddingService, createEmbeddingProvider } from './embedding-service'
export type { EmbeddingConfig, EmbeddingProvider } from './embedding-service'

export { RAGService } from './rag-service'
export type { RAGConfig, RAGHit, RAGResult } from './rag-service'

export {
  RecursiveCharacterTextSplitter,
  splitText,
  estimateTokenCount,
} from './chunking-service'
export type { TextChunk, ChunkingOptions } from './chunking-service'
