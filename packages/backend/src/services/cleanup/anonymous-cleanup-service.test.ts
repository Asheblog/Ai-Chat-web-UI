import { AnonymousCleanupService } from './anonymous-cleanup-service'

interface SessionRow {
  id: number
}

const createHarness = (options: {
  retentionDays: number
  sessions: SessionRow[]
}) => {
  const prisma = {
    chatSession: {
      findMany: jest.fn(async () => options.sessions),
      deleteMany: jest.fn(async () => ({ count: options.sessions.length })),
    },
  }
  const deleteAttachmentsForSessions = jest.fn(async () => {})
  const service = new AnonymousCleanupService({
    prisma: prisma as any,
    getQuotaPolicy: async () => ({ anonymousRetentionDays: options.retentionDays }),
    deleteAttachmentsForSessions,
  })
  return { service, prisma, deleteAttachmentsForSessions }
}

describe('AnonymousCleanupService 保留语义', () => {
  it('保留天数为 0 时表示永久保留：不查询、不删除匿名会话', async () => {
    const { service, prisma, deleteAttachmentsForSessions } = createHarness({
      retentionDays: 0,
      sessions: [{ id: 11 }],
    })

    await service.cleanup({ activeSessionId: 11 })

    expect(prisma.chatSession.findMany).not.toHaveBeenCalled()
    expect(deleteAttachmentsForSessions).not.toHaveBeenCalled()
    expect(prisma.chatSession.deleteMany).not.toHaveBeenCalled()
  })

  it('保留天数大于 0 时只删除过期会话，并排除当前活跃会话', async () => {
    const { service, prisma, deleteAttachmentsForSessions } = createHarness({
      retentionDays: 7,
      sessions: [{ id: 21 }],
    })

    const before = Date.now()
    await service.cleanup({ activeSessionId: 99 })
    const after = Date.now()

    expect(prisma.chatSession.findMany).toHaveBeenCalledTimes(1)
    const where = prisma.chatSession.findMany.mock.calls[0][0].where
    expect(where.anonymousKey).toEqual({ not: null })
    expect(where.id).toEqual({ not: 99 })
    const cutoffMs = where.OR[0].expiresAt.lt.getTime()
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000 - 1000)
    expect(cutoffMs).toBeLessThanOrEqual(after - 7 * 24 * 60 * 60 * 1000 + 1000)
    expect(deleteAttachmentsForSessions).toHaveBeenCalledWith([21])
    expect(prisma.chatSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [21] } } })
  })
})
