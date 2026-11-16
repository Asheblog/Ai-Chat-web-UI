/**
 * 文档解析与知识库的数值边界：与后端 rag-initializer / document-service 的 clamp 对齐。
 * 只在前端这一处声明，组件与保存逻辑共用。
 */
export const DOCUMENT_RANGES = {
  embeddingBatchSize: { min: 1, max: 128 },
  embeddingConcurrency: { min: 1, max: 16 },
  topK: { min: 1, max: 20 },
  relevanceThreshold: { min: 0, max: 1 },
  maxContextTokens: { min: 500, max: 32000 },
  chunkSize: { min: 100, max: 8000 },
  chunkOverlap: { min: 0, max: 1000 },
  maxFileSizeMb: { min: 1, max: 200 },
  maxPages: { min: 10, max: 1000 },
  retentionDays: { min: 1, max: 365 },
} as const

export const clampDocumentValue = (value: number, range: { min: number; max: number }) =>
  Math.max(range.min, Math.min(range.max, Math.round(value)))

export const clampDocumentDecimal = (value: number, range: { min: number; max: number }) =>
  Math.max(range.min, Math.min(range.max, value))
