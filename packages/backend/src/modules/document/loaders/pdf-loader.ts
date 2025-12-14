/**
 * PDF 文件加载器
 * 使用 pdf-parse 库解析 PDF，支持按页提取内容
 * 支持流式处理和页数限制，优化内存占用
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent, StreamLoadOptions } from './types'

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

/**
 * 默认最大页数限制
 * 可通过系统设置 rag_max_pages 覆盖
 */
const DEFAULT_MAX_PAGES = 200

export class PdfLoader implements DocumentLoader {
  readonly name = 'pdf'

  readonly supportedMimeTypes = ['application/pdf']

  /**
   * 流式加载 PDF 文件
   * 每解析完一页就调用回调，避免全部加载到内存
   */
  async loadStream(
    filePath: string,
    _mimeType: string,
    options: StreamLoadOptions
  ): Promise<{ totalPages: number; processedPages: number; skipped: boolean }> {
    const pdf = await getPdfParse()
    const dataBuffer = await fs.readFile(filePath)
    const filename = path.basename(filePath)

    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    let currentPageNumber = 0
    let processedPages = 0
    let totalPages = 0
    let shouldStop = false
    let skipped = false

    // 自定义 pagerender 回调，流式处理每页
    const pagerender = async (pageData: any): Promise<string> => {
      currentPageNumber++

      // 检查是否超过页数限制
      if (maxPages > 0 && currentPageNumber > maxPages) {
        skipped = true
        // 返回空字符串跳过后续页面的处理
        return ''
      }

      if (shouldStop) {
        return ''
      }

      const pageText = await renderPage(pageData)

      // 只有非空页面才处理
      if (pageText.trim() && options.onPage) {
        const content: DocumentContent = {
          pageContent: pageText,
          metadata: {
            source: filename,
            filePath,
            pageNumber: currentPageNumber,
            // totalPages 会在解析完成后通过外部设置
          },
        }

        const result = await options.onPage(content, currentPageNumber - 1)
        if (result === false) {
          shouldStop = true
        } else {
          processedPages++
        }
      } else if (pageText.trim()) {
        processedPages++
      }

      // 主动释放引用，帮助 GC
      return ''
    }

    // 执行解析
    // max 参数：0 表示解析所有页面，但我们通过 pagerender 内部控制
    const data = await pdf(dataBuffer, {
      pagerender,
      max: maxPages > 0 ? maxPages : 0,
    })

    totalPages = data.numpages

    return {
      totalPages,
      processedPages,
      skipped: skipped || (maxPages > 0 && totalPages > maxPages),
    }
  }

  /**
   * 加载 PDF 文件，按页提取内容（全量模式，兼容旧接口）
   * 注意：大文件建议使用 loadStream
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

      // 全量模式下也应用默认页数限制，防止内存爆炸
      if (currentPageNumber > DEFAULT_MAX_PAGES) {
        return ''
      }

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
      max: DEFAULT_MAX_PAGES, // 全量模式也限制页数
    })

    totalPages = data.numpages

    // 回填 totalPages 到所有页面的元数据
    for (const page of pages) {
      page.metadata.totalPages = totalPages
      page.metadata.info = data.info
      // 标记是否被截断
      if (totalPages > DEFAULT_MAX_PAGES) {
        page.metadata.truncated = true
        page.metadata.maxPagesLimit = DEFAULT_MAX_PAGES
      }
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
