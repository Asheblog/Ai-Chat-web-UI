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
