/**
 * DOCX 文件加载器
 * 使用 mammoth 库解析 Word 文档
 *
 * 优化：使用 convertToHtml 保留标题样式，便于 heading-detector 识别章节结构
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent } from './types'

// 动态导入 mammoth
let mammoth: typeof import('mammoth') | null = null

async function getMammoth() {
  if (mammoth) return mammoth
  try {
    mammoth = await import('mammoth')
    return mammoth
  } catch {
    throw new Error('mammoth is not installed. Run: pnpm add mammoth')
  }
}

/**
 * 从 HTML 中提取标题信息
 */
interface ExtractedHeading {
  level: number
  text: string
  index: number
}

function extractHeadingsFromHtml(html: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  const headingRegex = /<h([1-6])[^>]*>([^<]*)<\/h[1-6]>/gi
  let match: RegExpExecArray | null
  let index = 0
  
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10)
    const text = match[2].trim()
    if (text) {
      headings.push({ level, text, index: index++ })
    }
  }
  
  return headings
}

/**
 * 将 HTML 转换为带有标题标记的纯文本
 * 保留标题格式以便 heading-detector 识别
 */
function htmlToTextWithHeadings(html: string): string {
  let text = html
  
  // 替换标题标签为带标记的格式（便于启发式检测）
  // h1 -> "# Title" (Markdown 风格，heading-detector 可识别)
  text = text.replace(/<h1[^>]*>([^<]*)<\/h1>/gi, '\n# $1\n')
  text = text.replace(/<h2[^>]*>([^<]*)<\/h2>/gi, '\n## $1\n')
  text = text.replace(/<h3[^>]*>([^<]*)<\/h3>/gi, '\n### $1\n')
  text = text.replace(/<h4[^>]*>([^<]*)<\/h4>/gi, '\n#### $1\n')
  text = text.replace(/<h5[^>]*>([^<]*)<\/h5>/gi, '\n##### $1\n')
  text = text.replace(/<h6[^>]*>([^<]*)<\/h6>/gi, '\n###### $1\n')
  
  // 替换段落标签
  text = text.replace(/<p[^>]*>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  
  // 替换换行标签
  text = text.replace(/<br\s*\/?>/gi, '\n')
  
  // 替换列表项
  text = text.replace(/<li[^>]*>/gi, '\n• ')
  text = text.replace(/<\/li>/gi, '')
  
  // 移除其他所有 HTML 标签
  text = text.replace(/<[^>]+>/g, '')
  
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  
  // 清理多余的空行
  text = text.replace(/\n{3,}/g, '\n\n')
  
  return text.trim()
}

export class DocxLoader implements DocumentLoader {
  readonly name = 'docx'

  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]

  async load(filePath: string): Promise<DocumentContent[]> {
    const mammothLib = await getMammoth()
    const buffer = await fs.readFile(filePath)
    const filename = path.basename(filePath)

    // DOCX 应该是 ZIP 格式，提前校验避免将 .doc 误当成 .docx
    const isZip =
      buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b

    if (!isZip) {
      const ext = path.extname(filename).toLowerCase()
      const hint =
        ext === '.doc'
          ? '仅支持 DOCX，请先将 .doc 转为 .docx 再上传'
          : '文件可能已损坏或不是有效的 DOCX'
      throw new Error(hint)
    }

    // 使用 convertToHtml 保留标题样式
    const htmlResult = await mammothLib.convertToHtml({ buffer })
    const html = htmlResult.value
    
    // 从 HTML 中提取标题信息
    const headings = extractHeadingsFromHtml(html)
    
    // 将 HTML 转换为带有标题标记的纯文本
    const textContent = htmlToTextWithHeadings(html)

    return [
      {
        pageContent: textContent,
        metadata: {
          source: filename,
          filePath,
          messages: htmlResult.messages,
          // 新增：提取的标题信息，供 heading-detector 使用
          extractedHeadings: headings,
          hasStructure: headings.length > 0,
        },
      },
    ]
  }
}
