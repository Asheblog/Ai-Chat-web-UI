/**
 * PDF 文件加载器
 * 使用 pdf-parse 库解析 PDF
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent } from './types'

// 动态导入 pdf-parse，因为它可能未安装
let pdfParse: typeof import('pdf-parse') | null = null

async function getPdfParse() {
  if (pdfParse) return pdfParse
  try {
    pdfParse = (await import('pdf-parse')).default
    return pdfParse
  } catch {
    throw new Error('pdf-parse is not installed. Run: pnpm add pdf-parse')
  }
}

export class PdfLoader implements DocumentLoader {
  readonly name = 'pdf'

  readonly supportedMimeTypes = ['application/pdf']

  async load(filePath: string): Promise<DocumentContent[]> {
    const pdf = await getPdfParse()
    const dataBuffer = await fs.readFile(filePath)
    const filename = path.basename(filePath)

    const data = await pdf(dataBuffer)

    // pdf-parse 返回整个文档的文本
    // 如果需要按页分割，需要使用更复杂的库
    return [
      {
        pageContent: data.text,
        metadata: {
          source: filename,
          filePath,
          totalPages: data.numpages,
          info: data.info,
        },
      },
    ]
  }
}
