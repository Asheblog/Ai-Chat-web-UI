jest.mock('../../../db', () => ({ prisma: {} }))

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskTraceRecorder } from '../../task-trace'

interface RecorderHarness {
  recorder: TaskTraceRecorder
  updates: Array<Record<string, any>>
  dir: string
  readLines: () => Promise<Array<Record<string, any>>>
}

const createHarness = async (options: Record<string, any>): Promise<RecorderHarness> => {
  const dir = await mkdtemp(join(tmpdir(), 'trace-recorder-'))
  const updates: Array<Record<string, any>> = []
  const prisma = {
    taskTrace: {
      create: jest.fn().mockResolvedValue({ id: 77 }),
      update: jest.fn(async ({ data }: any) => {
        updates.push(data)
        return data
      }),
    },
  } as any
  const previousDir = process.env.TASK_TRACE_LOG_DIR
  process.env.TASK_TRACE_LOG_DIR = dir
  let recorder: TaskTraceRecorder
  try {
    recorder = await TaskTraceRecorder.create(
      {
        enabled: true,
        actorIdentifier: 'user:1',
        batchSize: 1,
        ...options,
      },
      { prisma },
    )
  } finally {
    if (previousDir === undefined) delete process.env.TASK_TRACE_LOG_DIR
    else process.env.TASK_TRACE_LOG_DIR = previousDir
  }
  const file = join(dir, 'trace-77.log')
  return {
    recorder,
    updates,
    dir,
    readLines: async () => {
      const raw = await readFile(file, 'utf8')
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
    },
  }
}

const parseStoredMetadata = (update: Record<string, any>) =>
  JSON.parse(update.metadata) as Record<string, any>

describe('TaskTraceRecorder retention', () => {
  it('keeps tool errors and the closing marker after the noise budget is exhausted', async () => {
    const harness = await createHarness({ maxEvents: 50 })
    for (let i = 0; i < 200; i += 1) {
      harness.recorder.log('sse:dispatch', { type: 'content', content: 'x' })
    }
    harness.recorder.log('tool:event', { type: 'tool_call', tool: 'read_url', stage: 'error', error: 'HTTP_403' })
    await harness.recorder.finalize('completed', { metadata: { toolLogs: [] } })

    const lines = await harness.readLines()
    const overflow = lines.filter((line) => line.eventType === 'trace_overflow')
    expect(overflow).toHaveLength(1)
    expect(overflow[0].payload).toMatchObject({ tier: 'noise', limit: 50 })

    const toolError = lines.find(
      (line) => line.eventType === 'tool:event' && line.payload?.error === 'HTTP_403',
    )
    expect(toolError).toBeDefined()

    const last = lines[lines.length - 1]
    expect(last.eventType).toBe('trace_finalized')
    expect(last.payload.status).toBe('completed')
    expect(last.payload.omitted.noise).toBe(150)

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('reports a persisted event count that matches the file content', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    harness.recorder.log('request:init', { sessionId: 1 })
    harness.recorder.log('http:client_request', { route: '/api/chat/stream' })
    harness.recorder.log('stream:started', { provider: 'deepseek' })
    await harness.recorder.finalize('completed')

    const lines = await harness.readLines()
    const finalUpdate = harness.updates[harness.updates.length - 1]
    expect(finalUpdate.eventCount).toBe(lines.length)
    expect(lines.length).toBe(4)
    const metadata = parseStoredMetadata(finalUpdate)
    expect(metadata.__trace).toMatchObject({
      eventCount: lines.length,
      omitted: { noise: 0, normal: 0, critical: 0 },
    })

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('treats progress persistence as noise but keeps the final persistence event', async () => {
    const harness = await createHarness({ maxEvents: 2 })
    for (let i = 0; i < 6; i += 1) {
      harness.recorder.log('db:persist_progress', { length: i })
    }
    harness.recorder.log('db:persist_final', { length: 999 })
    await harness.recorder.finalize('completed')

    const lines = await harness.readLines()
    expect(lines.some((line) => line.eventType === 'db:persist_final')).toBe(true)
    expect(lines.filter((line) => line.eventType === 'db:persist_progress').length).toBe(2)

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('bounds critical events with their own budget and counts omissions', async () => {
    const harness = await createHarness({ maxEvents: 100, maxCriticalEvents: 3 })
    for (let i = 0; i < 10; i += 1) {
      harness.recorder.log('stream:error', { error: `failure-${i}` })
    }
    await harness.recorder.finalize('error')

    const lines = await harness.readLines()
    const criticalErrors = lines.filter((line) => line.eventType === 'stream:error')
    expect(criticalErrors).toHaveLength(3)
    const overflow = lines.find((line) => line.eventType === 'trace_overflow')
    expect(overflow?.payload).toMatchObject({ tier: 'critical', limit: 3 })
    const last = lines[lines.length - 1]
    expect(last.payload.omitted.critical).toBe(7)

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('keeps metadata arrays beyond the old ten-item cap', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    const toolLogs = Array.from({ length: 50 }, (_, index) => ({ id: `log-${index}`, tool: 'read_url' }))
    await harness.recorder.finalize('completed', { metadata: { toolLogs } })

    const metadata = parseStoredMetadata(harness.updates[harness.updates.length - 1])
    expect(metadata.toolLogs).toHaveLength(50)
    expect(metadata.__trace.metadataOmissions).toEqual([])

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('marks metadata truncation explicitly instead of hiding it', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    const toolLogs = Array.from({ length: 500 }, (_, index) => ({ id: `log-${index}`, tool: 'read_url' }))
    await harness.recorder.finalize('completed', { metadata: { toolLogs } })

    const metadata = parseStoredMetadata(harness.updates[harness.updates.length - 1])
    expect(metadata.toolLogs).toHaveLength(100)
    expect(metadata.__trace.metadataOmissions).toEqual([{ path: 'toolLogs', kept: 100, total: 500 }])

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('records a caller-declared total when the caller already sliced the array', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    const toolLogs = Array.from({ length: 50 }, (_, index) => ({ id: `log-${index}`, tool: 'read_url' }))
    await harness.recorder.finalize('completed', { metadata: { toolLogs, toolLogsTotal: 82 } })

    const metadata = parseStoredMetadata(harness.updates[harness.updates.length - 1])
    expect(metadata.toolLogs).toHaveLength(50)
    expect(metadata.__trace.metadataOmissions).toEqual([{ path: 'toolLogs', kept: 50, total: 82 }])

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('prefers the larger caller-declared total when the recorder also trimmed the array', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    const toolLogs = Array.from({ length: 500 }, (_, index) => ({ id: `log-${index}`, tool: 'read_url' }))
    await harness.recorder.finalize('completed', { metadata: { toolLogs, toolLogsTotal: 900 } })

    const metadata = parseStoredMetadata(harness.updates[harness.updates.length - 1])
    expect(metadata.toolLogs).toHaveLength(100)
    expect(metadata.__trace.metadataOmissions).toEqual([{ path: 'toolLogs', kept: 100, total: 900 }])

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('ignores a declared total that does not exceed the kept array', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    const toolLogs = Array.from({ length: 3 }, (_, index) => ({ id: `log-${index}`, tool: 'read_url' }))
    await harness.recorder.finalize('completed', { metadata: { toolLogs, toolLogsTotal: 2 } })

    const metadata = parseStoredMetadata(harness.updates[harness.updates.length - 1])
    expect(metadata.__trace.metadataOmissions).toEqual([])

    await rm(harness.dir, { recursive: true, force: true })
  })

  it('ignores events logged after finalize', async () => {
    const harness = await createHarness({ maxEvents: 100 })
    harness.recorder.log('request:init', { sessionId: 1 })
    await harness.recorder.finalize('completed')
    harness.recorder.log('stream:error', { error: 'late' })

    const lines = await harness.readLines()
    expect(lines.filter((line) => line.eventType === 'stream:error')).toHaveLength(0)

    await rm(harness.dir, { recursive: true, force: true })
  })
})
describe('TaskTraceRecorder env budgets', () => {
  const withEnv = async (name: string, value: string, run: () => Promise<void>) => {
    const previous = process.env[name]
    process.env[name] = value
    try {
      await run()
    } finally {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  }

  it('honours a numeric env normal-event budget', async () => {
    await withEnv('TASK_TRACE_MAX_NORMAL_EVENTS', '5', async () => {
      const harness = await createHarness({ maxEvents: 100 })
      for (let i = 0; i < 10; i += 1) {
        harness.recorder.log('http:client_request', { index: i })
      }
      await harness.recorder.finalize('completed')

      const lines = await harness.readLines()
      expect(lines.filter((line) => line.eventType === 'http:client_request')).toHaveLength(5)
      const overflow = lines.find((line) => line.eventType === 'trace_overflow')
      expect(overflow?.payload).toMatchObject({ tier: 'normal', limit: 5 })
      expect(lines[lines.length - 1].payload.omitted.normal).toBe(5)

      await rm(harness.dir, { recursive: true, force: true })
    })
  })

  it('honours a numeric env critical-event budget', async () => {
    await withEnv('TASK_TRACE_MAX_CRITICAL_EVENTS', '2', async () => {
      const harness = await createHarness({ maxEvents: 100 })
      for (let i = 0; i < 5; i += 1) {
        harness.recorder.log('stream:error', { error: `fail-${i}` })
      }
      await harness.recorder.finalize('error')

      const lines = await harness.readLines()
      expect(lines.filter((line) => line.eventType === 'stream:error')).toHaveLength(2)
      expect(lines[lines.length - 1].payload.omitted.critical).toBe(3)

      await rm(harness.dir, { recursive: true, force: true })
    })
  })

  it('falls back to the noise budget when the env value is not a number', async () => {
    await withEnv('TASK_TRACE_MAX_NORMAL_EVENTS', 'not-a-number', async () => {
      const harness = await createHarness({ maxEvents: 3 })
      for (let i = 0; i < 5; i += 1) {
        harness.recorder.log('http:client_request', { index: i })
      }
      await harness.recorder.finalize('completed')

      const lines = await harness.readLines()
      expect(lines.filter((line) => line.eventType === 'http:client_request')).toHaveLength(3)

      await rm(harness.dir, { recursive: true, force: true })
    })
  })
})
