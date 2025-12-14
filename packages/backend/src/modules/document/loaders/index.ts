/**
 * 文档加载器工厂
 * 根据 MIME 类型选择合适的加载器
 */

import type { DocumentLoader, DocumentContent, StreamLoadOptions } from './types'
import { TextLoader } from './text-loader'
import { PdfLoader } from './pdf-loader'
import { DocxLoader } from './docx-loader'
import { CsvLoader } from './csv-loader'

// 注册所有加载器
const loaders: DocumentLoader[] = [
  new TextLoader(),
  new PdfLoader(),
  new DocxLoader(),
  new CsvLoader(),
]

// MIME 类型到加载器的映射
const mimeTypeMap = new Map<string, DocumentLoader>()

for (const loader of loaders) {
  for (const mimeType of loader.supportedMimeTypes) {
    mimeTypeMap.set(mimeType, loader)
  }
}

/**
 * 根据 MIME 类型获取加载器
 */
export function getLoaderForMimeType(mimeType: string): DocumentLoader | null {
  return mimeTypeMap.get(mimeType) || null
}

/**
 * 检查是否支持该 MIME 类型
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return mimeTypeMap.has(mimeType)
}

/**
 * 获取所有支持的 MIME 类型
 */
export function getSupportedMimeTypes(): string[] {
  return Array.from(mimeTypeMap.keys())
}

/**
 * 加载文档（全量模式）
 */
export async function loadDocument(
  filePath: string,
  mimeType: string
): Promise<DocumentContent[]> {
  const loader = getLoaderForMimeType(mimeType)

  if (!loader) {
    throw new Error(`Unsupported file type: ${mimeType}`)
  }

  return loader.load(filePath, mimeType)
}

/**
 * 流式加载文档（按页处理，减少内存占用）
 * 适用于大型 PDF 等文档
 */
export async function loadDocumentStream(
  filePath: string,
  mimeType: string,
  options: StreamLoadOptions
): Promise<{ totalPages: number; processedPages: number; skipped: boolean }> {
  const loader = getLoaderForMimeType(mimeType)

  if (!loader) {
    throw new Error(`Unsupported file type: ${mimeType}`)
  }

  // 如果加载器支持流式加载，使用流式模式
  if (loader.loadStream) {
    return loader.loadStream(filePath, mimeType, options)
  }

  // 否则回退到全量加载，然后逐个调用回调
  const contents = await loader.load(filePath, mimeType)
  let processedPages = 0

  for (let i = 0; i < contents.length; i++) {
    if (options.maxPages && i >= options.maxPages) {
      return {
        totalPages: contents.length,
        processedPages,
        skipped: true,
      }
    }

    if (options.onPage) {
      const result = await options.onPage(contents[i], i)
      if (result === false) {
        return {
          totalPages: contents.length,
          processedPages,
          skipped: true,
        }
      }
    }
    processedPages++
  }

  return {
    totalPages: contents.length,
    processedPages,
    skipped: false,
  }
}

// 导出类型
export type { DocumentLoader, DocumentContent, StreamLoadOptions } from './types'

// 导出加载器类
export { TextLoader } from './text-loader'
export { PdfLoader } from './pdf-loader'
export { DocxLoader } from './docx-loader'
export { CsvLoader } from './csv-loader'
