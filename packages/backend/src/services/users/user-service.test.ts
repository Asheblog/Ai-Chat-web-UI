import type { UsageQuotaSnapshot } from '../../types'
import { UserService, UserServiceError } from './user-service'

const buildService = () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    usageQuota: {
      upsert: jest.fn(),
    },
  }

  const authUtils = {
    validateUsername: jest.fn(() => true),
    validatePassword: jest.fn(() => true),
    hashPassword: jest.fn(async () => 'hashed'),
  }

  const quotaSnapshot: UsageQuotaSnapshot = {
    scope: 'USER',
    identifier: 'user:1',
    dailyLimit: 10,
    usedCount: 0,
    remaining: 10,
    lastResetAt: new Date('2024-01-01T00:00:00Z'),
    unlimited: false,
    customDailyLimit: null,
    usingDefaultLimit: true,
  }

  const inspectActorQuota = jest.fn(async () => quotaSnapshot)

  const now = () => new Date('2024-01-01T00:00:00Z')

  const service = new UserService({
    prisma: prisma as any,
    authUtils,
    inspectActorQuota,
    now,
  })

  return { prisma, authUtils, inspectActorQuota, service, quotaSnapshot }
}

describe('UserService', () => {
  it('rejects duplicate usernames when creating users', async () => {
    const { prisma, service, authUtils } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({ id: 1 })
    await expect(service.createUser({ username: 'dup', password: 'Password1!' }, 1)).rejects.toThrow(UserServiceError)
    expect(authUtils.hashPassword).not.toHaveBeenCalled()
  })

  it('prevents demoting the last active admin when updating role', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 2 }) // ensureUser for target
    prisma.user.count.mockResolvedValueOnce(0)

    await expect(service.updateRole(2, 'USER', 1)).rejects.toThrow('At least one active admin is required')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('resets quota usage when resetUsed flag is true', async () => {
    const { prisma, service, quotaSnapshot } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 5,
      username: 'demo',
      role: 'USER',
      status: 'ACTIVE',
    })

    const result = await service.updateQuota(5, { dailyLimit: 3, resetUsed: true }, 1)

    expect(prisma.usageQuota.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope_identifier: { scope: 'USER', identifier: 'user:5' } },
        update: expect.objectContaining({
          customDailyLimit: 3,
          usedCount: 0,
        }),
      }),
    )
    expect(result.quota).toBe(quotaSnapshot)
  })
})
