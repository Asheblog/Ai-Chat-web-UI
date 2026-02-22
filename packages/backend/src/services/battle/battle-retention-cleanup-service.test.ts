import { BattleRetentionCleanupService } from './battle-retention-cleanup-service'

const NOW_ISO = '2026-02-22T00:00:00.000Z'

const createService = (overrides?: {
  retentionDays?: string
  throttleMs?: number
  batchSize?: number
}) => {
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(async () => ({ value: overrides?.retentionDays ?? '15' })),
    },
    battleRun: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    $transaction: jest.fn(),
  } as any

  const tx = {
    battleShare: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    battleResult: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    battleRun: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  }

  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx))

  const imageService = {
    deleteImages: jest.fn(async () => {}),
  }

  const scheduleVacuum = jest.fn()

  const service = new BattleRetentionCleanupService({
    prisma,
    imageService: imageService as any,
    scheduleVacuum,
    throttleMs: overrides?.throttleMs ?? 60_000,
    batchSize: overrides?.batchSize ?? 50,
    now: () => new Date(NOW_ISO),
  })

  return {
    service,
    prisma,
    tx,
    imageService,
    scheduleVacuum,
  }
}

describe('BattleRetentionCleanupService', () => {
  it('battle_retention_days=0 时跳过清理', async () => {
    const { service, prisma, scheduleVacuum } = createService({ retentionDays: '0' })
    const result = await service.triggerIfDue()

    expect(result).toEqual(
      expect.objectContaining({
        retentionDays: 0,
        deletedRuns: 0,
        deletedResults: 0,
        deletedShares: 0,
        deletedImages: 0,
        vacuumScheduled: false,
      }),
    )
    expect(prisma.battleRun.findMany).not.toHaveBeenCalled()
    expect(scheduleVacuum).not.toHaveBeenCalled()
  })

  it('仅按 createdAt 清理终态 run，并同步删除 share/result/run', async () => {
    const { service, prisma, tx, imageService, scheduleVacuum } = createService({ retentionDays: '15' })
    prisma.battleRun.findMany
      .mockResolvedValueOnce([
        {
          id: 1001,
          promptImagesJson: '["battle/2026/01/01/a.png"]',
          expectedAnswerImagesJson: '["battle/2026/01/01/b.png"]',
        },
        {
          id: 1002,
          promptImagesJson: '["battle/2026/01/02/c.png","battle/2026/01/01/a.png"]',
          expectedAnswerImagesJson: '[]',
        },
      ])
      .mockResolvedValueOnce([])
    tx.battleShare.deleteMany.mockResolvedValueOnce({ count: 2 })
    tx.battleResult.deleteMany.mockResolvedValueOnce({ count: 6 })
    tx.battleRun.deleteMany.mockResolvedValueOnce({ count: 2 })

    const result = await service.triggerIfDue()

    const findArg = prisma.battleRun.findMany.mock.calls[0][0]
    expect(findArg.where.status.in).toEqual(expect.arrayContaining(['completed', 'error', 'cancelled']))
    expect(findArg.where.createdAt.lt.getTime()).toBe(new Date('2026-02-07T00:00:00.000Z').getTime())
    expect(findArg.take).toBe(50)

    expect(tx.battleShare.deleteMany).toHaveBeenCalledWith({ where: { battleRunId: { in: [1001, 1002] } } })
    expect(tx.battleResult.deleteMany).toHaveBeenCalledWith({ where: { battleRunId: { in: [1001, 1002] } } })
    expect(tx.battleRun.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [1001, 1002] },
        }),
      }),
    )
    expect(imageService.deleteImages).toHaveBeenCalledWith([
      'battle/2026/01/01/a.png',
      'battle/2026/01/01/b.png',
      'battle/2026/01/02/c.png',
    ])
    expect(scheduleVacuum).toHaveBeenCalledTimes(1)
    expect(result).toEqual(
      expect.objectContaining({
        retentionDays: 15,
        deletedRuns: 2,
        deletedResults: 6,
        deletedShares: 2,
        deletedImages: 3,
        vacuumScheduled: true,
      }),
    )
  })

  it('并发触发时只执行一次清理流程（单飞）', async () => {
    const { service, prisma } = createService({ throttleMs: 0 })
    let resolveSetting: ((value: any) => void) | null = null
    const pendingSetting = new Promise<any>((resolve) => {
      resolveSetting = resolve
    })
    prisma.systemSetting.findUnique.mockReturnValueOnce(pendingSetting)

    const first = service.triggerIfDue()
    const second = service.triggerIfDue()

    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1)
    resolveSetting?.({ value: '0' })

    await Promise.all([first, second])
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1)
  })
})
