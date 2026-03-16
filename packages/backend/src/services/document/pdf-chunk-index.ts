export interface PdfChunkResumeIndex {
  index: number
  skip: boolean
}

/**
 * 为 PDF 断点续跑计算 chunk 索引。
 * parsedChunkIndex 始终是从 0 开始的解析顺序索引；
 * startIndex 表示已落库 chunk 数。
 */
export function resolvePdfChunkResumeIndex(
  parsedChunkIndex: number,
  startIndex: number
): PdfChunkResumeIndex {
  return {
    index: parsedChunkIndex,
    skip: parsedChunkIndex < startIndex,
  }
}

