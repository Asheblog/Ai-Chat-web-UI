/**
 * 文本文件加载器 (TXT, MD, 代码文件等)
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent } from './types'

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

  async load(filePath: string): Promise<DocumentContent[]> {
    const content = await fs.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)

    return [
      {
        pageContent: content,
        metadata: {
          source: filename,
          filePath,
          charCount: content.length,
          lineCount: content.split('\n').length,
        },
      },
    ]
  }
}
