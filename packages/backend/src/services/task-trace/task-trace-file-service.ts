import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import readline from 'node:readline'
import {
  resolveLatexTraceLogPath,
  resolveTaskTraceLogDir,
  resolveTraceLogPath,
  type TraceLogPathReason,
} from '../../utils/task-trace'

export interface TraceEvent {
  id: string
  seq: number
  eventType: string
  payload: any
  timestamp: string | null
}

export interface LatexEvent {
  seq: number
  matched: boolean
  reason: string
  raw: string
  normalized: string
  trimmed: string
}

export type TraceFileStatus = 'ok' | 'partial' | 'corrupt' | 'missing' | 'unreadable'

export interface TraceFileReadOptions {
  /** 记录 id：用于校验文件名并允许已知旧目录重映射。 */
  traceId?: number
  baseDir?: string
  legacyDirs?: string[]
}

export interface TraceEventReadResult {
  events: TraceEvent[]
  /** 展示截断：文件里还有更多事件没返回。 */
  truncated: boolean
  status: TraceFileStatus
  /** 无法解析而被跳过的行数。 */
  corruptLines: number
  storedPath: string | null
  resolvedPath: string | null
  resolution: TraceLogPathReason | null
  error: string | null
}

export interface LatexEventReadResult {
  events: LatexEvent[]
  truncated: boolean
  status: TraceFileStatus
  corruptLines: number
  storedPath: string | null
  resolvedPath: string | null
  resolution: TraceLogPathReason | null
  error: string | null
}

export interface LatexFileReadOptions {
  baseDir?: string
  legacyDirs?: string[]
}

interface LineScanResult {
  values: any[]
  truncated: boolean
  corruptLines: number
  error: string | null
}

const emptyResult = (status: TraceFileStatus, resolution: TraceLogPathReason | null, storedPath: string | null): TraceEventReadResult => ({
  events: [],
  truncated: false,
  status,
  corruptLines: 0,
  storedPath,
  resolvedPath: null,
  resolution,
  error: null,
})

export class TaskTraceFileService {
  private resolveStoredPath(
    filePath: string | null | undefined,
    options: TraceFileReadOptions,
  ): { path: string | null; reason: TraceLogPathReason } {
    const baseDir = resolvePath(options.baseDir ?? resolveTaskTraceLogDir())
    if (typeof options.traceId === 'number' && Number.isFinite(options.traceId)) {
      const resolution = resolveTraceLogPath({
        storedPath: filePath,
        traceId: options.traceId,
        baseDir,
        legacyDirs: options.legacyDirs,
      })
      return { path: resolution.path, reason: resolution.reason }
    }
    // 没有 traceId 时无法校验文件名（latex 文件按时间戳命名），只承认真实存在的路径。
    const trimmed = typeof filePath === 'string' ? filePath.trim() : ''
    if (!trimmed) return { path: null, reason: 'empty' }
    const absolute = resolvePath(trimmed)
    return existsSync(absolute) ? { path: absolute, reason: 'stored' } : { path: null, reason: 'missing' }
  }

  private async scanLines(
    filePath: string,
    limit: number,
    mapLine: (parsed: any) => any | null,
  ): Promise<LineScanResult> {
    const values: any[] = []
    let truncated = false
    let corruptLines = 0
    const take = Math.max(1, limit)
    const maxLines = take + 1
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of rl) {
        if (!line.trim()) continue
        let parsed: any = null
        let parseable = false
        try {
          parsed = JSON.parse(line)
          parseable = true
        } catch {
          parseable = false
        }
        const mapped = parseable ? mapLine(parsed) : null
        if (mapped == null) {
          corruptLines += 1
          continue
        }
        values.push(mapped)
        if (values.length >= maxLines) {
          truncated = true
          values.pop()
          break
        }
      }
    } catch (error) {
      return {
        values,
        truncated,
        corruptLines,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      rl.close()
      stream.destroy()
    }
    return { values, truncated, corruptLines, error: null }
  }

  async readTraceEventsFromFile(
    filePath: string | null | undefined,
    limit = 2000,
    options: TraceFileReadOptions = {},
  ): Promise<TraceEventReadResult> {
    const storedPath = typeof filePath === 'string' ? filePath : null
    const resolved = this.resolveStoredPath(filePath, options)
    if (!resolved.path) {
      return { ...emptyResult('missing', resolved.reason, storedPath) }
    }

    let isFile = false
    try {
      isFile = (await stat(resolved.path)).isFile()
    } catch (error) {
      return {
        ...emptyResult('missing', resolved.reason, storedPath),
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (!isFile) {
      return {
        ...emptyResult('unreadable', resolved.reason, storedPath),
        resolvedPath: resolved.path,
        error: 'trace log path is not a regular file',
      }
    }

    const scan = await this.scanLines(resolved.path, limit, (parsed) => {
      const seq = typeof parsed?.seq === 'number' ? parsed.seq : null
      const eventType = typeof parsed?.eventType === 'string' ? parsed.eventType : (typeof parsed?.type === 'string' ? parsed.type : null)
      if (seq == null && eventType == null) return null
      const resolvedSeq = seq ?? 0
      return {
        id: `${resolvedSeq}`,
        seq: resolvedSeq,
        eventType: eventType ?? 'event',
        payload: parsed?.payload ?? {},
        timestamp: typeof parsed?.timestamp === 'string' ? parsed.timestamp : null,
      } satisfies TraceEvent
    })

    const status: TraceFileStatus = scan.error && scan.values.length === 0
      ? 'unreadable'
      : scan.corruptLines === 0
        ? 'ok'
        : scan.values.length > 0
          ? 'partial'
          : 'corrupt'

    return {
      events: scan.values,
      truncated: scan.truncated,
      status,
      corruptLines: scan.corruptLines,
      storedPath,
      resolvedPath: resolved.path,
      resolution: resolved.reason,
      error: scan.error,
    }
  }

  async readLatexEventsFromFile(
    filePath: string | null | undefined,
    limit = 2000,
    options: LatexFileReadOptions = {},
  ): Promise<LatexEventReadResult> {
    const storedPath = typeof filePath === 'string' ? filePath : null
    const resolved = resolveLatexTraceLogPath({
      storedPath: filePath,
      baseDir: options.baseDir,
      legacyDirs: options.legacyDirs,
    })
    const base: LatexEventReadResult = {
      events: [],
      truncated: false,
      status: 'missing',
      corruptLines: 0,
      storedPath,
      resolvedPath: null,
      resolution: resolved.reason,
      error: null,
    }
    if (!resolved.path) {
      return base
    }

    let isFile = false
    try {
      isFile = (await stat(resolved.path)).isFile()
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) }
    }
    if (!isFile) {
      return {
        ...base,
        status: 'unreadable',
        resolvedPath: resolved.path,
        error: 'latex trace log path is not a regular file',
      }
    }

    const scan = await this.scanLines(resolved.path, limit, (parsed) => {
      if (!parsed || typeof parsed !== 'object') return null
      return {
        seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
        matched: Boolean(parsed.matched),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        raw: typeof parsed.raw === 'string' ? parsed.raw : '',
        normalized: typeof parsed.normalized === 'string' ? parsed.normalized : '',
        trimmed: typeof parsed.trimmed === 'string' ? parsed.trimmed : '',
      } satisfies LatexEvent
    })

    const status: TraceFileStatus = scan.error && scan.values.length === 0
      ? 'unreadable'
      : scan.corruptLines === 0
        ? 'ok'
        : scan.values.length > 0
          ? 'partial'
          : 'corrupt'

    return {
      ...base,
      events: scan.values,
      truncated: scan.truncated,
      status,
      corruptLines: scan.corruptLines,
      resolvedPath: resolved.path,
      error: scan.error,
    }
  }
}
