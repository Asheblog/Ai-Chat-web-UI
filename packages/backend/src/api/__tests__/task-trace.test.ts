jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'ADMIN',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => {
    await next()
  },
  adminOnlyMiddleware: async (_c: any, next: any) => {
    await next()
  },
}))

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTaskTraceApi } from '../task-trace'
import { TaskTraceFileService } from '../../services/task-trace/task-trace-file-service'

interface TraceFixtureOptions {
  logFilePath: string | null
  metadata?: Record<string, any> | null
  eventCount?: number
}

const buildTraceDetail = (options: TraceFixtureOptions) => ({
  trace: {
    id: 105,
    sessionId: 2,
    messageId: 3,
    clientMessageId: 'c1',
    actor: 'user:1',
    status: 'completed',
    traceLevel: 'explicit',
    startedAt: new Date('2026-11-16T02:48:50.000Z'),
    endedAt: new Date('2026-11-16T02:51:18.872Z'),
    durationMs: 148077,
    metadata: options.metadata ?? null,
    eventCount: options.eventCount ?? 0,
    latexTrace: null,
    logFilePath: options.logFilePath,
  },
  latexTrace: null,
})

const eventLine = (seq: number, eventType: string, payload: Record<string, unknown> = {}) =>
  JSON.stringify({ seq, eventType, payload, timestamp: '2026-11-16T02:49:00.000Z' })

const createApp = (detail: any) => {
  const traceService = {
    listTraces: jest.fn(),
    getTraceWithLatex: jest.fn().mockResolvedValue(detail),
    getLatexTrace: jest.fn().mockResolvedValue(null),
    deleteTrace: jest.fn(),
    deleteAllTraces: jest.fn(),
    deleteLatexTrace: jest.fn(),
    cleanupTraces: jest.fn(),
  }
  const app = createTaskTraceApi({
    taskTraceService: traceService as any,
    taskTraceFileService: new TaskTraceFileService(),
  })
  return { app, traceService }
}

/** 事件文件必须位于配置的持久化目录内，测试把 TASK_TRACE_LOG_DIR 指向临时目录。 */
const useTraceDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trace-api-'))
  const previous = process.env.TASK_TRACE_LOG_DIR
  process.env.TASK_TRACE_LOG_DIR = dir
  return {
    dir,
    file: join(dir, 'trace-105.log'),
    restore: async () => {
      if (previous === undefined) delete process.env.TASK_TRACE_LOG_DIR
      else process.env.TASK_TRACE_LOG_DIR = previous
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe('task-trace detail api', () => {
  it('returns an explicit 409 when the event file is gone', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 2001 }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.data.code).toBe('TRACE_FILE_MISSING')
    expect(String(body.error)).toContain('追踪事件文件缺失')

    await ctx.restore()
  })

  it('distinguishes a record without any event file path', async () => {
    const { app } = createApp(buildTraceDetail({ logFilePath: null }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.data.code).toBe('TRACE_FILE_EMPTY_PATH')
    expect(String(body.error)).toContain('没有记录事件文件路径')
  })

  it('reports an unreadable event file with the underlying reason', async () => {
    const ctx = await useTraceDir()
    await mkdir(ctx.file)
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.data.code).toBe('TRACE_FILE_UNREADABLE')
    expect(String(body.error)).toContain('无法读取')

    await ctx.restore()
  })

  it('returns events with file status and recorder omissions for a readable file', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init'), eventLine(2, 'tool:event', { error: 'HTTP_403' })].join('\n'), 'utf8')
    const { app } = createApp(
      buildTraceDetail({
        logFilePath: ctx.file,
        eventCount: 2,
        metadata: {
          __trace: {
            eventCount: 2,
            omitted: { noise: 150, normal: 0, critical: 2 },
            overflow: { noise: true, normal: false, critical: true },
            metadataOmissions: [],
          },
        },
      }),
    )

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.fileStatus).toBe('ok')
    expect(body.data.corruptLines).toBe(0)
    expect(body.data.truncated).toBe(false)
    expect(body.data.events).toHaveLength(2)
    expect(body.data.omissions).toEqual({ noise: 150, normal: 0, critical: 2 })
    expect(body.data.overflow).toEqual({ noise: true, normal: false, critical: true })
    expect(body.data.metadataOmissions).toEqual([])

    await ctx.restore()
  })

  it('marks a partially unreadable file as partial instead of complete', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init'), 'broken line'].join('\n'), 'utf8')
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 2 }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.fileStatus).toBe('partial')
    expect(body.data.corruptLines).toBe(1)
    expect(body.data.events).toHaveLength(1)

    await ctx.restore()
  })

  it('fails the detail request when the file has no parseable event at all', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, 'garbage', 'utf8')
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 5 }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.data.code).toBe('TRACE_FILE_CORRUPT')

    await ctx.restore()
  })

  it('keeps 404 for unknown traces', async () => {
    const { app } = createApp(null)
    const res = await app.request('http://localhost/404')
    expect(res.status).toBe(404)
  })
})

describe('task-trace export api', () => {
  it('refuses to fake a successful empty export when the event file is missing', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 2001 }))

    const res = await app.request('http://localhost/105/export')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(body.data.code).toBe('TRACE_FILE_MISSING')

    await ctx.restore()
  })

  it('exports readable events with an explicit integrity header', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init'), 'broken line'].join('\n'), 'utf8')
    const { app } = createApp(
      buildTraceDetail({
        logFilePath: ctx.file,
        eventCount: 2,
        metadata: {
          __trace: {
            eventCount: 2,
            omitted: { noise: 150, normal: 0, critical: 2 },
            overflow: { noise: true, normal: false, critical: true },
            metadataOmissions: [],
          },
        },
      }),
    )

    const res = await app.request('http://localhost/105/export')
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(text).toContain('File status: partial')
    expect(text).toContain(`Event file: ${ctx.file}`)
    expect(text).toContain('Event count (persisted): 2')
    expect(text).toContain('Unparsed lines: 1')
    expect(text).toContain('Omitted events: noise=150, normal=0, critical=2')
    expect(text).toContain('request:init')

    await ctx.restore()
  })
})
describe('task-trace pending (running before first flush)', () => {
  const runningDetail = (logFilePath: string | null, eventCount = 0) => {
    const detail = buildTraceDetail({ logFilePath, eventCount })
    detail.trace.status = 'running'
    ;(detail.trace as any).endedAt = null
    return detail
  }

  it('keeps a running trace readable with fileStatus pending instead of failing', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(runningDetail(ctx.file))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.fileStatus).toBe('pending')
    expect(body.data.events).toEqual([])
    expect(body.data.truncated).toBe(false)
    expect(body.data.corruptLines).toBe(0)
    expect(body.data.omissions).toBeNull()

    await ctx.restore()
  })

  it('still reports a running trace that already flushed events normally', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init')].join('\n'), 'utf8')
    const { app } = createApp(runningDetail(ctx.file, 1))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.fileStatus).toBe('ok')
    expect(body.data.events).toHaveLength(1)

    await ctx.restore()
  })

  it('refuses to export a running trace that has not written its file yet', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(runningDetail(ctx.file))

    const res = await app.request('http://localhost/105/export')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(body.data.code).toBe('TRACE_NOT_READY')
    expect(String(body.error)).toContain('仍在执行')

    await ctx.restore()
  })

  it('exports a running trace that already flushed events', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init')].join('\n'), 'utf8')
    const { app } = createApp(runningDetail(ctx.file, 1))

    const res = await app.request('http://localhost/105/export')
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('File status: ok')

    await ctx.restore()
  })

  it('keeps the explicit missing error for a finished trace', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 12 }))

    const detailRes = await app.request('http://localhost/105')
    const detailBody = await detailRes.json()
    const exportRes = await app.request('http://localhost/105/export')
    const exportBody = await exportRes.json()

    expect(detailRes.status).toBe(409)
    expect(detailBody.data.code).toBe('TRACE_FILE_MISSING')
    expect(exportRes.status).toBe(409)
    expect(exportBody.data.code).toBe('TRACE_FILE_MISSING')

    await ctx.restore()
  })
})
describe('task-trace old metadata semantics', () => {
  it('reports retention fields as unknown when the record predates __trace', async () => {
    const ctx = await useTraceDir()
    await writeFile(ctx.file, [eventLine(1, 'request:init')].join('\n'), 'utf8')
    const { app } = createApp(buildTraceDetail({ logFilePath: ctx.file, eventCount: 1, metadata: { provider: 'deepseek' } }))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.omissions).toBeNull()
    expect(body.data.overflow).toBeNull()
    expect(body.data.metadataOmissions).toBeNull()

    await ctx.restore()
  })
})

describe('task-trace pending condition', () => {
  const runningDetail = (logFilePath: string | null, eventCount: number) => {
    const detail = buildTraceDetail({ logFilePath, eventCount })
    detail.trace.status = 'running'
    return detail
  }

  it('does not treat a running trace that already counted events as pending', async () => {
    const ctx = await useTraceDir()
    const { app } = createApp(runningDetail(ctx.file, 5))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.data.code).toBe('TRACE_FILE_MISSING')

    await ctx.restore()
  })

  it('does not treat an out-of-policy stored path as a pending file', async () => {
    const ctx = await useTraceDir()
    const elsewhere = join(ctx.dir, 'elsewhere', 'trace-105.log')
    const { app } = createApp(runningDetail(elsewhere, 0))

    const res = await app.request('http://localhost/105')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.data.code).toBe('TRACE_FILE_MISSING')
    expect(String(body.error)).toContain('不在允许的目录内')

    await ctx.restore()
  })
})
