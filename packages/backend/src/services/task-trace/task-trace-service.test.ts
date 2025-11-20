import { TaskTraceService } from './task-trace-service'

const buildService = () => {
  const prisma = {
    taskTrace: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  }
  const service = new TaskTraceService({ prisma: prisma as any })
  return { prisma, service }
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
})
