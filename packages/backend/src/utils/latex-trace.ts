import { appendFile, mkdir } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { prisma } from '../db'
import { BackendLogger as log } from './logger'
import type { LatexSegmentAudit } from '@aichat/shared/latex-normalizer'

export type LatexTraceStatus = 'pending' | 'completed' | 'error'

const sanitizeMetadata = (payload?: Record<string, unknown> | null) => {
  if (!payload) return {}
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch {
    return {}
  }
}

const buildLogDir = () => {
  const customDir = process.env.LATEX_TRACE_LOG_DIR
  if (customDir) return resolvePath(customDir)
  if (process.env.LOG_DIR) {
    return resolvePath(process.env.LOG_DIR, 'latex-trace')
  }
  return resolvePath(process.cwd(), 'logs', 'latex-trace')
}

interface LatexTraceRecorderOptions {
  taskTraceId: number
  matchedBlocks: number
  unmatchedBlocks: number
  metadata?: Record<string, unknown>
}

interface LatexTraceLogEntry {
  seq: number
  matched: boolean
  reason: string
  raw: string
  normalized: string
  trimmed: string
}

export class LatexTraceRecorder {
  private static baseDir = buildLogDir()
  private traceId: number | null = null
  private logFilePath: string | null = null
  private entries: LatexTraceLogEntry[] = []
  private seq = 0
  private enabled = true
  private ensured = false
  private matched: number
  private unmatched: number
  private metadata: Record<string, unknown>

  private constructor(private readonly taskTraceId: number, options: LatexTraceRecorderOptions) {
    this.matched = Math.max(0, options.matchedBlocks)
    this.unmatched = Math.max(0, options.unmatchedBlocks)
    this.metadata = sanitizeMetadata(options.metadata)
  }

  static async create(options: LatexTraceRecorderOptions): Promise<LatexTraceRecorder | null> {
    const recorder = new LatexTraceRecorder(options.taskTraceId, options)
    try {
      const logDir = LatexTraceRecorder.baseDir
      await recorder.ensureDir(logDir)
      const filePath = resolvePath(logDir, `latex-trace-${options.taskTraceId}-${Date.now()}.log`)
      const latexTrace = await prisma.latexTrace.upsert({
        where: { taskTraceId: options.taskTraceId },
        create: {
          taskTraceId: options.taskTraceId,
          matchedBlocks: recorder.matched,
          unmatchedBlocks: recorder.unmatched,
          status: 'pending',
          metadata: JSON.stringify(recorder.metadata),
          logFilePath: filePath,
        },
        update: {
          matchedBlocks: recorder.matched,
          unmatchedBlocks: recorder.unmatched,
          status: 'pending',
          metadata: JSON.stringify(recorder.metadata),
          logFilePath: filePath,
        },
      })
      recorder.traceId = latexTrace.id
      recorder.logFilePath = filePath
      return recorder
    } catch (error) {
      log.error('[latex-trace] create failed', error)
      return null
    }
  }

  private async ensureDir(dir: string) {
    if (this.ensured) return
    try {
      await mkdir(dir, { recursive: true })
      this.ensured = true
    } catch (error) {
      log.error('[latex-trace] ensure dir failed', error)
      this.enabled = false
    }
  }

  private pushEntry(segment: LatexSegmentAudit) {
    if (!this.enabled) return
    this.seq += 1
    this.entries.push({
      seq: this.seq,
      matched: segment.matched,
      reason: segment.reason,
      raw: segment.raw,
      normalized: segment.normalized,
      trimmed: segment.trimmed,
    })
  }

  logSegments(segments: LatexSegmentAudit[]) {
    if (!segments?.length) return
    for (const segment of segments) {
      this.pushEntry(segment)
    }
  }

  async finalize(status: LatexTraceStatus, extra?: { metadata?: Record<string, unknown>; error?: string }) {
    if (!this.enabled || !this.traceId) return
    try {
      if (this.logFilePath && this.entries.length > 0) {
        const lines = this.entries.map((entry) => JSON.stringify(entry)).join('\n')
        await appendFile(this.logFilePath, `${lines}\n`, { encoding: 'utf8' })
      }
    } catch (error) {
      log.error('[latex-trace] write log failed', error)
    }

    const mergedMeta = {
      ...this.metadata,
      ...(extra?.metadata ? sanitizeMetadata(extra.metadata) : {}),
      ...(extra?.error ? { error: extra.error } : {}),
    }
    try {
      await prisma.latexTrace.update({
        where: { taskTraceId: this.taskTraceId },
        data: {
          status,
          matchedBlocks: this.matched,
          unmatchedBlocks: this.unmatched,
          metadata: JSON.stringify(mergedMeta),
        },
      })
    } catch (error) {
      log.error('[latex-trace] finalize update failed', error)
    }
  }
}
