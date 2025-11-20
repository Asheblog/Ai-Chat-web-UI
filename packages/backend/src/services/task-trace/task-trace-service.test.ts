import { TaskTraceService } from './task-trace-service'

const buildService = () => {
  const prisma = {
    taskTrace: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    latexTrace: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  }
  const unlink = jest.fn()
  const service = new TaskTraceService({ prisma: prisma as any })
  ;(service as any).unlink = unlink
  return { prisma, service, unlink }
}

describe('TaskTraceService', () => {
  it('lists traces with filters and parses metadata/latex summary', async () => {
    const { prisma, service } = buildService()
    prisma.taskTrace.findMany.mockResolvedValueOnce([
      {
        id: 1,
        sessionId: 2,
        messageId: 3,
        clientMessageId: 'c1',
        actor: 'user:1',
        status: 'completed',
        traceLevel: 'full',
        startedAt: new Date('2024-01-01T00:00:00Z'),
        endedAt: new Date('2024-01-01T00:01:00Z'),
        durationMs: 60000,
        metadata: '{"foo":"bar"}',
        eventCount: 10,
        latexTrace: {
          id: 9,
          status: 'ok',
          matchedBlocks: 2,
          unmatchedBlocks: 1,
          updatedAt: new Date('2024-01-01T00:02:00Z'),
        },
      },
    ])
    prisma.taskTrace.count.mockResolvedValueOnce(1)

    const result = await service.listTraces({
      page: 1,
      pageSize: 20,
      sessionId: 2,
      status: 'completed',
      keyword: 'user',
    })

    expect(prisma.taskTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 2,
          status: 'completed',
          OR: [{ actor: { contains: 'user' } }, { clientMessageId: { contains: 'user' } }],
        }),
        skip: 0,
        take: 20,
      }),
    )
    expect(result.total).toBe(1)
    expect(result.items[0].metadata).toEqual({ foo: 'bar' })
    expect(result.items[0].latexTrace).toEqual(
      expect.objectContaining({ id: 9, status: 'ok', matchedBlocks: 2 }),
    )
  })

  it('returns null when trace is missing on detail', async () => {
    const { prisma, service } = buildService()
    prisma.taskTrace.findUnique.mockResolvedValueOnce(null)
    const result = await service.getTraceWithLatex(99)
    expect(result).toBeNull()
  })

  it('maps trace detail and parses latex metadata', async () => {
    const { prisma, service } = buildService()
    const now = new Date('2024-01-01T00:00:00Z')
    prisma.taskTrace.findUnique.mockResolvedValueOnce({
      id: 5,
      sessionId: 6,
      messageId: 7,
      clientMessageId: 'c7',
      actor: 'user:5',
      status: 'running',
      traceLevel: 'full',
      startedAt: now,
      endedAt: null,
      durationMs: null,
      metadata: '{"a":1}',
      eventCount: 3,
      logFilePath: '/tmp/log.ndjson',
      latexTrace: {
        id: 11,
        status: 'pending',
        matchedBlocks: 0,
        unmatchedBlocks: 0,
        metadata: '{"k":"v"}',
        createdAt: now,
        updatedAt: now,
      },
    })

    const result = await service.getTraceWithLatex(5)
    expect(prisma.taskTrace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 } }),
    )
    expect(result?.trace.logFilePath).toBe('/tmp/log.ndjson')
    expect(result?.trace.metadata).toEqual({ a: 1 })
    expect(result?.latexTrace?.metadata).toEqual({ k: 'v' })
  })

  it('gets latex trace and parses metadata', async () => {
    const { prisma, service } = buildService()
    prisma.latexTrace.findUnique.mockResolvedValueOnce({
      id: 1,
      taskTraceId: 2,
      matchedBlocks: 1,
      unmatchedBlocks: 0,
      status: 'ok',
      metadata: '{"x":1}',
      logFilePath: '/tmp/a',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const latex = await service.getLatexTrace(2)
    expect(latex?.metadata).toEqual({ x: 1 })
  })

  it('deletes latex trace and removes file when exists', async () => {
    const { prisma, service, unlink } = buildService()
    prisma.latexTrace.findUnique.mockResolvedValueOnce({ id: 3, logFilePath: '/tmp/a' })
    prisma.latexTrace.delete.mockResolvedValueOnce({})
    const result = await service.deleteLatexTrace(1)
    expect(result.deleted).toBe(true)
    expect(prisma.latexTrace.delete).toHaveBeenCalledWith({ where: { taskTraceId: 1 } })
    expect(unlink).toHaveBeenCalledWith('/tmp/a')
  })

  it('deletes trace and related files', async () => {
    const { prisma, service, unlink } = buildService()
    prisma.taskTrace.findUnique.mockResolvedValueOnce({
      logFilePath: '/tmp/a',
      latexTrace: { logFilePath: '/tmp/b' },
    })
    prisma.taskTrace.delete.mockResolvedValueOnce({})
    const result = await service.deleteTrace(10)
    expect(result.deleted).toBe(true)
    expect(prisma.taskTrace.delete).toHaveBeenCalledWith({ where: { id: 10 } })
    expect(unlink).toHaveBeenCalledTimes(2)
  })

  it('deletes all traces and removes files', async () => {
    const { prisma, service, unlink } = buildService()
    prisma.taskTrace.findMany.mockResolvedValueOnce([
      { id: 1, logFilePath: '/tmp/a', latexTrace: { logFilePath: '/tmp/b' } },
      { id: 2, logFilePath: null, latexTrace: { logFilePath: null } },
    ])
    prisma.taskTrace.deleteMany.mockResolvedValueOnce({})
    const result = await service.deleteAllTraces()
    expect(result.deleted).toBe(2)
    expect(unlink).toHaveBeenCalledWith('/tmp/a')
    expect(unlink).toHaveBeenCalledWith('/tmp/b')
  })

  it('cleans up traces older than cutoff', async () => {
    const { prisma, service, unlink } = buildService()
    prisma.taskTrace.findMany.mockResolvedValueOnce([
      { id: 1, logFilePath: '/tmp/a', latexTrace: { logFilePath: null } },
    ])
    prisma.taskTrace.deleteMany.mockResolvedValueOnce({})
    const result = await service.cleanupTraces(7, () => new Date('2024-01-08T00:00:00Z').getTime())
    expect(result.deleted).toBe(1)
    expect(result.retentionDays).toBe(7)
    expect(prisma.taskTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startedAt: { lt: new Date('2024-01-01T00:00:00.000Z') } },
      }),
    )
    expect(unlink).toHaveBeenCalledWith('/tmp/a')
  })
})
