import { ChatImageService } from './chat-image-service'

const createPrisma = (attachments: Array<{ id: number; relativePath: string }> = []) => {
  const prisma = {
    messageAttachment: {
      findMany: jest.fn(async () => attachments),
      deleteMany: jest.fn(async () => ({ count: attachments.length })),
    },
  }
  return prisma as any
}

const DAY_MS = 24 * 60 * 60 * 1000

describe('ChatImageService.cleanupExpired 保留语义', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('保留天数为 0 时表示永久保留：不查询、不删除任何附件', async () => {
    const prisma = createPrisma([{ id: 1, relativePath: '2026/01/01/a.png' }])
    const service = new ChatImageService({ prisma, storageRoot: '/tmp/does-not-exist' })

    await service.cleanupExpired(0)

    expect(prisma.messageAttachment.findMany).not.toHaveBeenCalled()
    expect(prisma.messageAttachment.deleteMany).not.toHaveBeenCalled()
  })

  it('保留天数大于 0 时按 cutoff 清理过期附件', async () => {
    const prisma = createPrisma([{ id: 2, relativePath: '2026/01/01/b.png' }])
    const service = new ChatImageService({ prisma, storageRoot: '/tmp/does-not-exist' })

    const before = Date.now()
    await service.cleanupExpired(30)
    const after = Date.now()

    expect(prisma.messageAttachment.findMany).toHaveBeenCalledTimes(1)
    const arg = prisma.messageAttachment.findMany.mock.calls[0][0]
    const cutoffMs = arg.where.message.createdAt.lt.getTime()
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 30 * DAY_MS - 1000)
    expect(cutoffMs).toBeLessThanOrEqual(after - 30 * DAY_MS + 1000)
    expect(prisma.messageAttachment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } })
  })

  it('非法保留天数回落到默认天数，而不是当成 0', async () => {
    const prisma = createPrisma([])
    const service = new ChatImageService({ prisma, storageRoot: '/tmp/does-not-exist' })

    await service.cleanupExpired(Number.NaN)

    expect(prisma.messageAttachment.findMany).toHaveBeenCalledTimes(1)
  })
})
