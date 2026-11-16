import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { getTaskTraceConfig } from '../services/task-trace/legacy-utils'
import {
  buildLatexExport,
  buildTraceExport,
  type TraceOmissionCounts,
  type TraceOverflowFlags,
} from '../services/task-trace/task-trace-export-service'
import type { TaskTraceService } from '../services/task-trace/task-trace-service'
import type { TaskTraceFileService, TraceEventReadResult, TraceFileStatus } from '../services/task-trace/task-trace-file-service'

export interface TaskTraceApiDeps {
  taskTraceService: TaskTraceService
  taskTraceFileService: TaskTraceFileService
}

type TraceFileFailureCode =
  | 'TRACE_FILE_MISSING'
  | 'TRACE_FILE_EMPTY_PATH'
  | 'TRACE_FILE_UNREADABLE'
  | 'TRACE_FILE_CORRUPT'
  | 'TRACE_NOT_READY'

interface TraceFileFailure {
  code: TraceFileFailureCode
  error: string
}

interface PendingTraceCandidate {
  status: string | null
  eventCount: number | null
}

/**
 * 记录器 create 时只存路径、首次 flush 才创建文件（batchSize=20）。
 * 「正在跑、还没写第一条」和「已结束但文件真的没了」是两件事：
 * 只有 missing + 当前目录内 + running + eventCount 为 0 才算 pending，
 * 旧目录/名字不匹配/无法定位一律保持明确失败，不掩盖真正的丢文件。
 */
const isPendingTraceFile = (trace: PendingTraceCandidate, result: TraceEventReadResult): boolean =>
  result.status === 'missing'
  && result.resolution === 'missing'
  && trace.status === 'running'
  && (trace.eventCount ?? 0) === 0

const READABLE_STATUSES: TraceFileStatus[] = ['ok', 'partial']

/** LaTeX 详情与导出共用的文件状态映射。 */
const fileStatusToFailureCode = (status: TraceFileStatus): TraceFileFailureCode => {
  if (status === 'corrupt') return 'TRACE_FILE_CORRUPT'
  if (status === 'unreadable') return 'TRACE_FILE_UNREADABLE'
  return 'TRACE_FILE_MISSING'
}

/**
 * 把文件读取状态翻译成给管理员看的中文原因。
 * 可读（ok / partial）返回 null；其余状态由调用方转成明确的非 200 响应，
 * 不再用 200 + 空事件冒充「这条记录没有事件」。
 */
const describeUnavailableTraceFile = (
  result: TraceEventReadResult,
  traceId: number,
  fileLabel: string,
): TraceFileFailure | null => {
  if (READABLE_STATUSES.includes(result.status)) return null
  const stored = result.storedPath ?? `${fileLabel}（trace #${traceId}）`

  if (result.status === 'missing') {
    switch (result.resolution) {
      case 'empty':
        return {
          code: 'TRACE_FILE_EMPTY_PATH',
          error: `追踪记录 #${traceId} 没有记录事件文件路径，无法读取事件。`,
        }
      case 'legacy-root-unknown':
        return {
          code: 'TRACE_FILE_MISSING',
          error: `追踪记录 #${traceId} 的事件文件路径 ${stored} 不在允许的目录内，已拒绝读取；请在服务端把旧目录加入 TASK_TRACE_LEGACY_LOG_DIRS 或迁移文件。`,
        }
      case 'legacy-name-mismatch':
        return {
          code: 'TRACE_FILE_MISSING',
          error: `追踪记录 #${traceId} 的事件文件 ${stored} 与记录 id 不匹配（期望 trace-${traceId}.log），未做自动映射。`,
        }
      case 'legacy-target-missing':
        return {
          code: 'TRACE_FILE_MISSING',
          error: `追踪记录 #${traceId} 的事件文件 ${stored} 不存在，当前持久化目录也没有 trace-${traceId}.log。`,
        }
      default:
        return {
          code: 'TRACE_FILE_MISSING',
          error: `追踪事件文件缺失：${stored} 不存在。可能未写入持久化卷，或容器重建时随可写层丢失。`,
        }
    }
  }

  if (result.status === 'unreadable') {
    return {
      code: 'TRACE_FILE_UNREADABLE',
      error: `追踪事件文件无法读取：${result.error ?? '未知原因'}（${stored}）。`,
    }
  }

  return {
    code: 'TRACE_FILE_CORRUPT',
    error: `追踪事件文件没有任何可解析事件（${stored}），${result.corruptLines} 行无法解析，文件可能已损坏。`,
  }
}

interface LatexFileFailureSource {
  status: TraceFileStatus
  corruptLines: number
  storedPath: string | null
  resolvedPath: string | null
  resolution: string | null
  error: string | null
}

const describeLatexFileFailure = (source: LatexFileFailureSource, label: string): string | null => {
  if (READABLE_STATUSES.includes(source.status)) return null
  const stored = source.resolvedPath ?? source.storedPath ?? label
  if (source.status === 'corrupt') {
    return `LaTeX 事件文件没有任何可解析记录（${stored}），${source.corruptLines} 行无法解析。`
  }
  if (source.status === 'unreadable') {
    return `LaTeX 事件文件无法读取：${source.error ?? '未知原因'}（${stored}）。`
  }
  if (source.resolution === 'legacy-root-unknown') {
    return `LaTeX 事件文件路径 ${stored} 不在允许的目录内，已拒绝读取；请把文件迁移到当前 latex-trace 目录。`
  }
  return `LaTeX 事件文件缺失：${stored} 不存在。可能未写入持久化卷，或容器重建时随可写层丢失。`
}

interface TraceRetentionMetadata {
  omitted: TraceOmissionCounts | null
  overflow: TraceOverflowFlags | null
  metadataOmissions: Array<{ path: string; kept: number; total: number }>
}

const readCounts = (value: unknown, keys: Array<'noise' | 'normal' | 'critical'>, mode: 'number' | 'boolean') => {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const raw = source[key]
    if (mode === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
      result[key] = raw
    } else {
      if (typeof raw !== 'boolean') return null
      result[key] = raw
    }
  }
  return result
}

/** 读取记录器写入 metadata.__trace 的省略信息；旧记录没有这段时返回空。 */
const readTraceRetentionMetadata = (metadata: Record<string, any> | null | undefined): TraceRetentionMetadata | null => {
  const raw = metadata?.__trace
  if (!raw || typeof raw !== 'object') return null
  const omitted = readCounts((raw as Record<string, unknown>).omitted, ['noise', 'normal', 'critical'], 'number')
  const overflow = readCounts((raw as Record<string, unknown>).overflow, ['noise', 'normal', 'critical'], 'boolean')
  const rawOmissions = (raw as Record<string, unknown>).metadataOmissions
  const metadataOmissions = Array.isArray(rawOmissions)
    ? rawOmissions.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const entry = item as Record<string, unknown>
        if (typeof entry.path !== 'string' || typeof entry.kept !== 'number' || typeof entry.total !== 'number') return []
        return [{ path: entry.path, kept: entry.kept, total: entry.total }]
      })
    : []
  return {
    omitted: omitted as TraceOmissionCounts | null,
    overflow: overflow as TraceOverflowFlags | null,
    metadataOmissions,
  }
}

export const createTaskTraceApi = (deps: TaskTraceApiDeps) => {
  const traceService = deps.taskTraceService
  const traceFileService = deps.taskTraceFileService
  const taskTrace = new Hono()

const cleanupSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
})

const parseIntParam = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

taskTrace.get('/', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const page = Math.max(1, parseIntParam(c.req.query('page'), 1))
    const pageSize = Math.min(100, Math.max(1, parseIntParam(c.req.query('pageSize'), 20)))
    const sessionIdRaw = c.req.query('sessionId')
    const statusRaw = c.req.query('status')
    const keyword = (c.req.query('keyword') || '').trim()

    const result = await traceService.listTraces({
      page,
      pageSize,
      sessionId: sessionIdRaw && Number.isFinite(Number.parseInt(sessionIdRaw, 10))
        ? Number.parseInt(sessionIdRaw, 10)
        : undefined,
      status: statusRaw || undefined,
      keyword: keyword || undefined,
    })

    return c.json<ApiResponse>({
      success: true,
      data: {
        items: result.items,
        total: result.total,
        page,
        pageSize,
      },
    })
  } catch (error) {
    console.error('List task traces failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to list task traces' }, 500)
  }
})

taskTrace.get('/:id', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const traceDetail = await traceService.getTraceWithLatex(id)
    const trace = traceDetail?.trace
    if (!trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }

    const fileResult = await traceFileService.readTraceEventsFromFile(trace.logFilePath, 2000, {
      traceId: trace.id,
    })
    const retention = readTraceRetentionMetadata(trace.metadata)

    if (isPendingTraceFile(trace, fileResult)) {
      // 任务还在跑且还没写第一条事件：文件不存在是正常状态，不是丢文件。
      return c.json<ApiResponse>({
        success: true,
        data: {
          trace,
          latexTrace: traceDetail?.latexTrace ?? null,
          events: [],
          truncated: false,
          fileStatus: 'pending',
          corruptLines: 0,
          omissions: retention?.omitted ?? null,
          overflow: retention?.overflow ?? null,
          metadataOmissions: retention?.metadataOmissions ?? null,
        },
      })
    }

    const failure = describeUnavailableTraceFile(fileResult, trace.id, 'trace')
    if (failure) {
      return c.json<ApiResponse>({ success: false, error: failure.error, data: { code: failure.code } }, 409)
    }

    // truncated 只表示「文件里还有事件没返回」的展示截断，不表示记录器丢过事件。
    const truncated = fileResult.truncated || (trace.eventCount ?? 0) > fileResult.events.length

    return c.json<ApiResponse>({
      success: true,
      data: {
        trace,
        latexTrace: traceDetail?.latexTrace ?? null,
        events: fileResult.events,
        truncated,
        fileStatus: fileResult.status,
        corruptLines: fileResult.corruptLines,
        omissions: retention?.omitted ?? null,
        overflow: retention?.overflow ?? null,
        // 旧记录没有 __trace：null 表示「未知」，不是「没有省略」。
        metadataOmissions: retention?.metadataOmissions ?? null,
      },
    })
  } catch (error) {
    console.error('Get task trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch task trace' }, 500)
  }
})

taskTrace.get('/:id/export', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const detail = await traceService.getTraceWithLatex(id)
    if (!detail?.trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }

    const fileResult = await traceFileService.readTraceEventsFromFile(detail.trace.logFilePath, Number.MAX_SAFE_INTEGER, {
      traceId: detail.trace.id,
    })
    if (isPendingTraceFile(detail.trace, fileResult)) {
      // 进行中且尚未落盘：不生成成功空附件，明确让调用方稍后再来。
      return c.json<ApiResponse>(
        {
          success: false,
          error: `追踪记录 #${detail.trace.id} 仍在执行，事件文件尚未落盘（首次写入前为空）。请等任务结束后再导出。`,
          data: { code: 'TRACE_NOT_READY' },
        },
        409,
      )
    }

    const failure = describeUnavailableTraceFile(fileResult, detail.trace.id, 'trace')
    if (failure) {
      // 文件缺失时不再返回 200 附件：导出必须能反映「拿不到事件」。
      return c.json<ApiResponse>({ success: false, error: failure.error, data: { code: failure.code } }, 409)
    }

    const retention = readTraceRetentionMetadata(detail.trace.metadata)
    const body = buildTraceExport({
      id: detail.trace.id,
      status: detail.trace.status,
      actor: detail.trace.actor,
      sessionId: detail.trace.sessionId,
      messageId: detail.trace.messageId,
      clientMessageId: detail.trace.clientMessageId,
      traceLevel: detail.trace.traceLevel,
      startedAt: detail.trace.startedAt,
      endedAt: detail.trace.endedAt,
      durationMs: detail.trace.durationMs,
      metadata: detail.trace.metadata,
      events: fileResult.events,
      eventCount: detail.trace.eventCount,
      integrity: {
        fileStatus: fileResult.status,
        corruptLines: fileResult.corruptLines,
        exportTruncated: fileResult.truncated,
        omitted: retention?.omitted ?? null,
        overflow: retention?.overflow ?? null,
        sourcePath: fileResult.resolvedPath,
        resolvedVia: fileResult.resolution,
      },
    })
    return c.newResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="task-trace-${detail.trace.id}.txt"`,
      },
    })
  } catch (error) {
    console.error('Export trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to export trace' }, 500)
  }
})

taskTrace.get('/:id/latex', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await traceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    return c.json<ApiResponse>({
      success: true,
      data: {
        latexTrace: latex,
      },
    })
  } catch (error) {
    console.error('Get latex trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch latex trace' }, 500)
  }
})

taskTrace.get('/:id/latex/events', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await traceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    const fileResult = await traceFileService.readLatexEventsFromFile(latex.logFilePath, 2000)
    const failureMessage = describeLatexFileFailure(fileResult, `latex-trace #${latex.id}`)
    if (failureMessage) {
      return c.json<ApiResponse>(
        { success: false, error: failureMessage, data: { code: fileStatusToFailureCode(fileResult.status) } },
        409,
      )
    }
    return c.json<ApiResponse>({
      success: true,
      data: {
        events: fileResult.events,
        truncated: fileResult.truncated,
        fileStatus: fileResult.status,
        corruptLines: fileResult.corruptLines,
      },
    })
  } catch (error) {
    console.error('Get latex events failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch latex events' }, 500)
  }
})

taskTrace.get('/:id/latex/export', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await traceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    const fileResult = await traceFileService.readLatexEventsFromFile(latex.logFilePath, Number.MAX_SAFE_INTEGER)
    const failureMessage = describeLatexFileFailure(fileResult, `latex-trace #${latex.id}`)
    if (failureMessage) {
      return c.json<ApiResponse>(
        { success: false, error: failureMessage, data: { code: fileStatusToFailureCode(fileResult.status) } },
        409,
      )
    }
    const body = buildLatexExport({
      id: latex.id,
      taskTraceId: latex.taskTraceId,
      status: latex.status,
      matchedBlocks: latex.matchedBlocks,
      unmatchedBlocks: latex.unmatchedBlocks,
      createdAt: latex.createdAt,
      updatedAt: latex.updatedAt,
      metadata: latex.metadata,
      events: fileResult.events as unknown as Array<Record<string, any>>,
      integrity: {
        fileStatus: fileResult.status,
        corruptLines: fileResult.corruptLines,
        exportTruncated: fileResult.truncated,
        sourcePath: fileResult.resolvedPath,
        resolvedVia: fileResult.resolution,
      },
    })
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="latex-trace-${latex.id}.txt"`,
      },
    })
  } catch (error) {
    console.error('Export latex trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to export latex trace' }, 500)
  }
})

taskTrace.delete('/:id/latex', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const result = await traceService.deleteLatexTrace(id)
    if (!result.deleted) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    return c.json<ApiResponse>({ success: true })
  } catch (error) {
    console.error('Delete latex trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete latex trace' }, 500)
  }
})

taskTrace.delete('/all', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const result = await traceService.deleteAllTraces()
    return c.json<ApiResponse>({ success: true, data: { deleted: result.deleted } })
  } catch (error) {
    console.error('Delete all traces failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete all traces' }, 500)
  }
})

taskTrace.delete('/:id', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id')!, 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const result = await traceService.deleteTrace(id)
    if (!result.deleted) {
      return c.json<ApiResponse>({ success: true, message: 'Trace removed' })
    }
    return c.json<ApiResponse>({ success: true, message: 'Trace removed' })
  } catch (error) {
    console.error('Delete trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete trace' }, 500)
  }
})

taskTrace.post('/cleanup', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', cleanupSchema), async (c) => {
  try {
    const body = c.req.valid('json')
    const inputDays = body?.retentionDays
    const config = await getTaskTraceConfig()
    const retentionDays = typeof inputDays === 'number' ? Math.max(1, Math.min(365, inputDays)) : config.retentionDays
    const result = await traceService.cleanupTraces(retentionDays)
    return c.json<ApiResponse>({
      success: true,
      data: {
        deleted: result.deleted,
        retentionDays: result.retentionDays,
      },
    })
  } catch (error) {
    console.error('Cleanup traces failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to cleanup traces' }, 500)
  }
})

  return taskTrace
}
