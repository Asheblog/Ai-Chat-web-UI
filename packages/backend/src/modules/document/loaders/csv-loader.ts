/**
 * CSV 文件加载器
 * 使用 papaparse 库解析 CSV
 */

import fs from 'fs/promises'
import path from 'path'
import type { DocumentLoader, DocumentContent } from './types'

// 动态导入 papaparse
let Papa: typeof import('papaparse') | null = null

async function getPapaparse() {
  if (Papa) return Papa
  try {
    Papa = await import('papaparse')
    return Papa
  } catch {
    throw new Error('papaparse is not installed. Run: pnpm add papaparse')
  }
}

export class CsvLoader implements DocumentLoader {
  readonly name = 'csv'

  readonly supportedMimeTypes = ['text/csv', 'application/csv']

  async load(filePath: string): Promise<DocumentContent[]> {
    const papaparse = await getPapaparse()
    const content = await fs.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)

    const result = papaparse.parse(content, {
      header: true,
      skipEmptyLines: true,
    })

    // 将每行转换为文本
    const rows = result.data as Record<string, string>[]
    const textContent = rows
      .map((row, index) => {
        const rowText = Object.entries(row)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
        return `Row ${index + 1}: ${rowText}`
      })
      .join('\n')

    return [
      {
        pageContent: textContent,
        metadata: {
          source: filename,
          filePath,
          rowCount: rows.length,
          columns: result.meta.fields || [],
          errors: result.errors,
        },
      },
    ]
  }
}
