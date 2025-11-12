import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createReadStream } from 'node:fs'
import { readFile, unlink, access } from 'node:fs/promises'
import readline from 'node:readline'
import { prisma } from '../db'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { getTaskTraceConfig } from '../utils/task-trace'

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

const readTraceEventsFromFile = async (filePath: string | null | undefined, limit = 2000) => {
  const events: Array<{ id: string; seq: number; eventType: string; payload: any; timestamp: string | null }> = []
  if (!filePath) {
    return { events, truncated: false }
  }
  try {
    await access(filePath)
  } catch {
    return { events, truncated: false }
  }
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let truncated = false
  const take = Math.max(1, limit)
  const maxLines = take + 1
  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: any = null
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const seq = typeof parsed.seq === 'number' ? parsed.seq : events.length + 1
      const eventType = typeof parsed.eventType === 'string' ? parsed.eventType : (parsed.type || 'event')
      events.push({
        id: `${seq}`,
        seq,
        eventType,
        payload: parsed.payload ?? {},
        timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
      })
      if (events.length >= maxLines) {
        truncated = true
        events.pop()
        break
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { events, truncated }
}

taskTrace.get('/', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const page = Math.max(1, parseIntParam(c.req.query('page'), 1))
    const pageSize = Math.min(100, Math.max(1, parseIntParam(c.req.query('pageSize'), 20)))
    const sessionIdRaw = c.req.query('sessionId')
    const statusRaw = c.req.query('status')
    const keyword = (c.req.query('keyword') || '').trim()

    const where: any = {}
    if (sessionIdRaw) {
      const parsed = Number.parseInt(sessionIdRaw, 10)
      if (Number.isFinite(parsed)) {
        where.sessionId = parsed
      }
    }
    if (statusRaw) {
      where.status = statusRaw
    }
    if (keyword) {
      where.OR = [
        { actor: { contains: keyword } },
        { clientMessageId: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.taskTrace.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sessionId: true,
          messageId: true,
          clientMessageId: true,
          actor: true,
          status: true,
          traceLevel: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          metadata: true,
          eventCount: true,
        },
      }),
      prisma.taskTrace.count({ where }),
    ])

    const data = items.map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      messageId: item.messageId,
      clientMessageId: item.clientMessageId,
      actor: item.actor,
      status: item.status,
      traceLevel: item.traceLevel,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      durationMs: item.durationMs,
      metadata: parseJsonColumn(item.metadata),
      eventCount: item.eventCount,
    }))

    return c.json<ApiResponse>({
      success: true,
      data: {
        items: data,
        total,
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
    const trace = await prisma.taskTrace.findUnique({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        messageId: true,
        clientMessageId: true,
        actor: true,
        status: true,
        traceLevel: true,
        startedAt: true,
        endedAt: true,
        durationMs: true,
        metadata: true,
        eventCount: true,
        logFilePath: true,
      },
    })
    if (!trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }
    const { events, truncated } = await readTraceEventsFromFile(trace.logFilePath, 2000)
    return c.json<ApiResponse>({
      success: true,
      data: {
        trace: {
          id: trace.id,
          sessionId: trace.sessionId,
          messageId: trace.messageId,
          clientMessageId: trace.clientMessageId,
          actor: trace.actor,
          status: trace.status,
          traceLevel: trace.traceLevel,
          startedAt: trace.startedAt,
          endedAt: trace.endedAt,
          durationMs: trace.durationMs,
          metadata: parseJsonColumn(trace.metadata),
          eventCount: trace.eventCount,
        },
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
    const trace = await prisma.taskTrace.findUnique({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        messageId: true,
        clientMessageId: true,
        actor: true,
        status: true,
        traceLevel: true,
        startedAt: true,
        endedAt: true,
        durationMs: true,
        metadata: true,
        logFilePath: true,
      },
    })
    if (!trace) {
      return c.json<ApiResponse>({ success: false, error: 'Trace not found' }, 404)
    }
    const lines: string[] = []
    lines.push(`Trace #${trace.id}`)
    lines.push(`Status: ${trace.status}`)
    lines.push(`Actor: ${trace.actor}`)
    lines.push(`Session: ${trace.sessionId ?? '-'}`)
    lines.push(`Message: ${trace.messageId ?? '-'}`)
    lines.push(`Client ID: ${trace.clientMessageId ?? '-'}`)
    lines.push(`Level: ${trace.traceLevel}`)
    lines.push(`Started: ${trace.startedAt?.toISOString?.() ?? trace.startedAt}`)
    lines.push(`Ended: ${trace.endedAt ? trace.endedAt.toISOString() : '-'}`)
    if (typeof trace.durationMs === 'number') {
      lines.push(`Duration(ms): ${trace.durationMs}`)
    }
    lines.push('--- Metadata ---')
    lines.push(JSON.stringify(parseJsonColumn(trace.metadata) ?? {}, null, 2))
    lines.push('--- Events ---')
    if (trace.logFilePath) {
      try {
        const content = await readFile(trace.logFilePath, 'utf8')
        const rawLines = content.split('\n').filter((l) => l.trim() !== '')
        for (const raw of rawLines) {
          let parsed: any = null
          try {
            parsed = JSON.parse(raw)
          } catch {
            continue
          }
          const seq = typeof parsed.seq === 'number' ? parsed.seq : null
          const ts = parsed.timestamp ? new Date(parsed.timestamp).toISOString() : ''
          lines.push(`[${seq != null ? seq.toString().padStart(4, '0') : '----'}] ${ts} ${parsed.eventType || parsed.type || 'event'}`)
          lines.push(JSON.stringify(parsed.payload ?? {}, null, 2))
        }
      } catch (error) {
        lines.push(`(无法读取日志文件：${(error as Error).message})`)
      }
    } else {
      lines.push('(未找到日志文件)')
    }
    const body = lines.join('\n')
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

taskTrace.delete('/:id', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid trace id' }, 400)
    }
    const trace = await prisma.taskTrace.findUnique({
      where: { id },
      select: { logFilePath: true },
    })
    if (!trace) {
      return c.json<ApiResponse>({ success: true, message: 'Trace removed' })
    }
    await prisma.taskTrace.delete({ where: { id } })
    if (trace.logFilePath) {
      try {
        await unlink(trace.logFilePath)
      } catch {}
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
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const targets = await prisma.taskTrace.findMany({
      where: { startedAt: { lt: cutoff } },
      select: { id: true, logFilePath: true },
    })
    if (targets.length === 0) {
      return c.json<ApiResponse>({
        success: true,
        data: {
          deleted: 0,
          retentionDays,
        },
      })
    }
    await prisma.taskTrace.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } })
    await Promise.all(
      targets
        .map((item) => item.logFilePath)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
        .map(async (file) => {
          try {
            await unlink(file)
          } catch {}
        }),
    )
    return c.json<ApiResponse>({
      success: true,
      data: {
        deleted: targets.length,
        retentionDays,
      },
    })
  } catch (error) {
    console.error('Cleanup traces failed', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to cleanup traces' }, 500)
  }
})

export default taskTrace
