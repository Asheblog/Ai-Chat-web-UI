import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import type { DocumentContent } from './types'

const execFile = promisify(execFileCb)

export interface PdfOcrOptions {
  command?: string
  language?: string
  maxPages?: number
  timeoutMs?: number
}

export function splitOcrSidecarText(raw: string): string[] {
  return raw
    .split('\f')
    .map((page) => page.trim())
    .filter((page) => page.length > 0)
}

/**
 * 使用 ocrmypdf sidecar 模式提取 PDF 文本。
 * 依赖外部命令：ocrmypdf。
 */
export async function extractPdfTextWithOcr(
  filePath: string,
  options: PdfOcrOptions = {}
): Promise<DocumentContent[]> {
  const command = options.command?.trim() || 'ocrmypdf'
  const language = options.language?.trim() || 'eng'
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const maxPages = options.maxPages && options.maxPages > 0 ? options.maxPages : undefined

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-ocr-'))
  const sidecarPath = path.join(tempDir, 'ocr-sidecar.txt')
  const outputPdfPath = path.join(tempDir, 'ocr-output.pdf')

  const args: string[] = [
    '--skip-text',
    '--force-ocr',
    '--sidecar',
    sidecarPath,
    '-l',
    language,
    filePath,
    outputPdfPath,
  ]

  if (maxPages) {
    args.splice(4, 0, '--pages', `1-${maxPages}`)
  }

  try {
    await execFile(command, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    })

    const raw = await fs.readFile(sidecarPath, 'utf-8')
    const pages = splitOcrSidecarText(raw)

    return pages.map((pageContent, index) => ({
      pageContent,
      metadata: {
        source: path.basename(filePath),
        filePath,
        pageNumber: index + 1,
        ocr: true,
      },
    }))
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`OCR command not found: ${command}`)
    }
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(`OCR extraction failed: ${message}`)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

