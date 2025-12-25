/**
 * 文本文件加载器 (TXT, MD, 代码文件等)
 *
 * 优化：对 Markdown 文件提取标题结构信息
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent } from './types'

/**
 * 从 Markdown 内容中提取标题信息
 */
interface ExtractedHeading {
  level: number
  text: string
  lineNumber: number
}

function extractMarkdownHeadings(content: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  const lines = content.split('\n')
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 匹配 Markdown 标题: # Title, ## Title, etc.
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineNumber: i + 1,
      })
    }
  }
  
  return headings
}

/**
 * 判断是否是 Markdown 文件
 */
function isMarkdownFile(filePath: string, mimeType?: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.md' || ext === '.markdown' ||
    mimeType === 'text/markdown' || mimeType === 'text/x-markdown'
}

export class TextLoader implements DocumentLoader {
  readonly name = 'text'

  readonly supportedMimeTypes = [
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/json',
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'text/x-python',
    'text/x-java',
    'text/css',
    'text/html',
    'text/xml',
    'application/xml',
  ]

  async load(filePath: string, mimeType?: string): Promise<DocumentContent[]> {
    const content = await fs.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)
    
    // 检查是否是 Markdown 文件
    const isMarkdown = isMarkdownFile(filePath, mimeType)
    
    // 提取 Markdown 标题信息
    const extractedHeadings = isMarkdown ? extractMarkdownHeadings(content) : []

    return [
      {
        pageContent: content,
        metadata: {
          source: filename,
          filePath,
          charCount: content.length,
          lineCount: content.split('\n').length,
          // 新增：Markdown 结构信息
          isMarkdown,
          extractedHeadings: extractedHeadings.length > 0 ? extractedHeadings : undefined,
          hasStructure: extractedHeadings.length > 0,
        },
      },
    ]
  }
}
