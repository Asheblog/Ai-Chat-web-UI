/**
 * 文档加载器工厂
 * 根据 MIME 类型选择合适的加载器
 */

import type { DocumentLoader, DocumentContent } from './types'
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
 * 加载文档
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

// 导出类型
export type { DocumentLoader, DocumentContent } from './types'

// 导出加载器类
export { TextLoader } from './text-loader'
export { PdfLoader } from './pdf-loader'
export { DocxLoader } from './docx-loader'
export { CsvLoader } from './csv-loader'
