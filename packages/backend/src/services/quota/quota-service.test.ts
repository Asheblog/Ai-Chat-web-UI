import { QuotaService } from './quota-service'

type StoreRecord = {
  id: number
  scope: string
  identifier: string
  usedCount: number
  lastResetAt: Date | null
  customDailyLimit: number | null
  userId?: number | null
}

const createMockPrisma = () => {
  const store = new Map<string, StoreRecord>()
  let id = 1

  const findByScopeId = (scope: string, identifier: string) => store.get(`${scope}:${identifier}`) ?? null
  const findById = (targetId: number) => [...store.values()].find((r) => r.id === targetId) ?? null

  const usageQuota = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.scope_identifier) {
        const { scope, identifier } = where.scope_identifier
        return findByScopeId(scope, identifier)
      }
      if (where.id) {
        return findById(where.id)
      }
      return null
    }),
    create: jest.fn(async ({ data }: any) => {
      const record: StoreRecord = {
        id: id++,
        ...data,
        usedCount: data.usedCount ?? 0,
        lastResetAt: data.lastResetAt ?? null,
        customDailyLimit: data.customDailyLimit ?? null,
      }
      store.set(`${record.scope}:${record.identifier}`, record)
      return { ...record }
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const existing = findById(where.id)
      if (!existing) throw new Error('Record not found')
      const updated: StoreRecord = {
        ...existing,
        ...data,
      }
      store.set(`${updated.scope}:${updated.identifier}`, updated)
      return { ...updated }
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const existing = findByScopeId(where.scope_identifier.scope, where.scope_identifier.identifier)
      if (existing) {
        const updated: StoreRecord = {
          ...existing,
          ...update,
        }
        store.set(`${updated.scope}:${updated.identifier}`, updated)
        return { ...updated }
      }
      const created = await usageQuota.create({ data: create })
      return created
    }),
  }

  const prisma = {
    usageQuota,
    $transaction: async (fn: any) => fn(prisma),
  }

  return { prisma: prisma as any, store }
}

const userActor = {
  type: 'user' as const,
  id: 1,
  username: 'tester',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  identifier: 'user:1',
}

const anonActor = {
  type: 'anonymous' as const,
  key: 'anon-key',
  identifier: 'anon:anon-key',
  expiresAt: null as Date | null,
}

const defaultPolicy = {
  anonymousDailyQuota: 1,
  defaultUserDailyQuota: 1,
  anonymousRetentionDays: 1,
}

describe('QuotaService', () => {
  test('consumes quota and updates usage', async () => {
    const { prisma } = createMockPrisma()
    const service = new QuotaService({
      prisma: prisma as any,
      getQuotaPolicy: async () => defaultPolicy,
      now: () => new Date('2024-01-01T00:00:00Z'),
    })

    const result = await service.consumeActorQuota(userActor)

    expect(result.success).toBe(true)
    expect(result.snapshot.usedCount).toBe(1)
  })

  test('blocks when exceeding limit', async () => {
    const { prisma } = createMockPrisma()
    const service = new QuotaService({
      prisma: prisma as any,
      getQuotaPolicy: async () => defaultPolicy,
      now: () => new Date('2024-01-01T00:00:00Z'),
    })

    await service.consumeActorQuota(userActor)
    const over = await service.consumeActorQuota(userActor)

    expect(over.success).toBe(false)
    expect(over.reason).toBe('OVER_LIMIT')
    expect(over.snapshot.remaining).toBe(0)
  })

  test('inspect resets next day without mutation', async () => {
    const { prisma, store } = createMockPrisma()
    const day1 = new Date('2024-01-01T01:00:00Z')
    const day2 = new Date('2024-01-02T01:00:00Z')
    const service = new QuotaService({
      prisma: prisma as any,
      getQuotaPolicy: async () => defaultPolicy,
      now: () => day1,
    })

    await service.consumeActorQuota(anonActor, { now: day1 })
    const before = store.values().next().value as StoreRecord
    expect(before.usedCount).toBe(1)

    const snapshot = await service.inspectActorQuota(anonActor, { now: day2 })
    expect(snapshot.usedCount).toBe(0)
    expect(snapshot.lastResetAt.toISOString()).toBe(day2.toISOString())
  })

  test('syncSharedAnonymousQuota upserts and resets usage', async () => {
    const { prisma, store } = createMockPrisma()
    const service = new QuotaService({
      prisma: prisma as any,
      getQuotaPolicy: async () => defaultPolicy,
      now: () => new Date('2024-01-03T00:00:00Z'),
    })

    await service.syncSharedAnonymousQuota({ resetUsed: true })

    const record = [...store.values()].find((r) => r.identifier === 'anon:shared')
    expect(record).toBeDefined()
    expect(record?.usedCount).toBe(0)
    expect(record?.lastResetAt?.toISOString()).toBe('2024-01-03T00:00:00.000Z')
  })
})
