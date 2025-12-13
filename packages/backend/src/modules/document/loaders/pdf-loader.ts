/**
 * PDF 文件加载器
 * 使用 pdf-parse 库解析 PDF，支持按页提取内容
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

/**
 * 默认的页面渲染函数，提取页面文本
 */
function renderPage(pageData: any): Promise<string> {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  }

  return pageData.getTextContent(renderOptions).then((textContent: any) => {
    let lastY: number | undefined
    let text = ''

    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str
      } else {
        text += '\n' + item.str
      }
      lastY = item.transform[5]
    }

    return text
  })
}

export class PdfLoader implements DocumentLoader {
  readonly name = 'pdf'

  readonly supportedMimeTypes = ['application/pdf']

  /**
   * 加载 PDF 文件，按页提取内容
   * 每页返回独立的 DocumentContent，包含 pageNumber 元数据
   */
  async load(filePath: string): Promise<DocumentContent[]> {
    const pdf = await getPdfParse()
    const dataBuffer = await fs.readFile(filePath)
    const filename = path.basename(filePath)

    // 存储每页的内容
    const pages: DocumentContent[] = []
    let currentPageNumber = 0
    let totalPages = 0

    // 自定义 pagerender 回调，捕获每页内容
    const pagerender = async (pageData: any): Promise<string> => {
      currentPageNumber++
      const pageText = await renderPage(pageData)

      // 只有非空页面才添加
      if (pageText.trim()) {
        pages.push({
          pageContent: pageText,
          metadata: {
            source: filename,
            filePath,
            pageNumber: currentPageNumber,
            // totalPages 会在解析完成后填充
          },
        })
      }

      return pageText
    }

    // 执行解析，使用自定义的 pagerender
    const data = await pdf(dataBuffer, {
      pagerender,
      max: 0, // 0 表示解析所有页面
    })

    totalPages = data.numpages

    // 回填 totalPages 到所有页面的元数据
    for (const page of pages) {
      page.metadata.totalPages = totalPages
      page.metadata.info = data.info
    }

    // 如果没有提取到任何内容，返回空文档标记
    if (pages.length === 0) {
      return [
        {
          pageContent: '',
          metadata: {
            source: filename,
            filePath,
            pageNumber: 1,
            totalPages,
            info: data.info,
            empty: true,
          },
        },
      ]
    }

    return pages
  }
}
