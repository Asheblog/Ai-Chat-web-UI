/**
 * DOCX 文件加载器
 * 使用 mammoth 库解析 Word 文档
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

export class DocxLoader implements DocumentLoader {
  readonly name = 'docx'

  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ]

  async load(filePath: string): Promise<DocumentContent[]> {
    const mammothLib = await getMammoth()
    const buffer = await fs.readFile(filePath)
    const filename = path.basename(filePath)

    // 提取纯文本
    const result = await mammothLib.extractRawText({ buffer })

    return [
      {
        pageContent: result.value,
        metadata: {
          source: filename,
          filePath,
          messages: result.messages,
        },
      },
    ]
  }
}
