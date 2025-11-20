import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { getTaskTraceConfig } from '../utils/task-trace'
import { taskTraceService } from '../services/task-trace/task-trace-service'
import { taskTraceFileService } from '../services/task-trace/task-trace-file-service'
import { buildLatexExport, buildTraceExport } from '../services/task-trace/task-trace-export-service'

const taskTrace = new Hono()

const cleanupSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
})

const parseIntParam = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseJsonColumn = <T = any>(value: string | null | undefined): T | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

taskTrace.get('/', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const page = Math.max(1, parseIntParam(c.req.query('page'), 1))
    const pageSize = Math.min(100, Math.max(1, parseIntParam(c.req.query('pageSize'), 20)))
    const sessionIdRaw = c.req.query('sessionId')
    const statusRaw = c.req.query('status')
    const keyword = (c.req.query('keyword') || '').trim()

    const result = await taskTraceService.listTraces({
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
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const traceDetail = await taskTraceService.getTraceWithLatex(id)
    const trace = traceDetail?.trace
    if (!trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }
    const { events, truncated } = await taskTraceFileService.readTraceEventsFromFile(trace.logFilePath, 2000)
    return c.json<ApiResponse>({
      success: true,
      data: {
        trace,
        latexTrace: traceDetail?.latexTrace ?? null,
        events,
        truncated: truncated || (trace.eventCount ?? 0) > events.length,
      },
    })
  } catch (error) {
    console.error('Get task trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch task trace' }, 500)
  }
})

taskTrace.get('/:id/export', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const detail = await taskTraceService.getTraceWithLatex(id)
    if (!detail?.trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }
    const { events } = await taskTraceFileService.readTraceEventsFromFile(detail.trace.logFilePath, Number.MAX_SAFE_INTEGER)
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
      events,
    })
    return c.newResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="task-trace-${trace.id}.txt"`,
      },
    })
  } catch (error) {
    console.error('Export trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to export trace' }, 500)
  }
})

taskTrace.get('/:id/latex', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await taskTraceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    return c.json<ApiResponse>({
      success: true,
      data: {
        latexTrace: {
          ...latex,
          metadata: parseJsonColumn(latex.metadata),
        },
      },
    })
  } catch (error) {
    console.error('Get latex trace failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch latex trace' }, 500)
  }
})

taskTrace.get('/:id/latex/events', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await taskTraceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    const { events, truncated } = await taskTraceFileService.readLatexEventsFromFile(latex.logFilePath, 2000)
    return c.json<ApiResponse>({
      success: true,
      data: { events, truncated },
    })
  } catch (error) {
    console.error('Get latex events failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch latex events' }, 500)
  }
})

taskTrace.get('/:id/latex/export', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const latex = await taskTraceService.getLatexTrace(id)
    if (!latex) {
      return c.json<ApiResponse>({ success: false, error: 'Latex trace not found' }, 404)
    }
    const { events } = await taskTraceFileService.readLatexEventsFromFile(latex.logFilePath, Number.MAX_SAFE_INTEGER)
    const body = buildLatexExport({
      id: latex.id,
      taskTraceId: latex.taskTraceId,
      status: latex.status,
      matchedBlocks: latex.matchedBlocks,
      unmatchedBlocks: latex.unmatchedBlocks,
      createdAt: latex.createdAt,
      updatedAt: latex.updatedAt,
      metadata: latex.metadata,
      events,
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
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const result = await taskTraceService.deleteLatexTrace(id)
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
    const result = await taskTraceService.deleteAllTraces()
    return c.json<ApiResponse>({ success: true, data: { deleted: result.deleted } })
  } catch (error) {
    console.error('Delete all traces failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete all traces' }, 500)
  }
})

taskTrace.delete('/:id', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const result = await taskTraceService.deleteTrace(id)
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
    const result = await taskTraceService.cleanupTraces(retentionDays)
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

export default taskTrace
