import { AuthContextService } from '../auth-context-service'

const createMockPrisma = () => {
  return {
    user: {
      findUnique: jest.fn(),
    },
  }
}

const mockAuthUtils = {
  extractTokenFromHeader: jest.fn((header?: string | null) => (header || '').replace('Bearer ', '') || null),
  verifyToken: jest.fn((token: string) => (token === 'valid' ? { userId: 1 } : null)),
}

const mockGetQuotaPolicy = jest.fn(async () => ({
  anonymousDailyQuota: 1,
  defaultUserDailyQuota: 100,
  anonymousRetentionDays: 7,
}))

const createService = (prisma: any, overrides: Partial<ConstructorParameters<typeof AuthContextService>[0]> = {}) =>
  new AuthContextService({
    prisma,
    authUtils: mockAuthUtils as any,
    getQuotaPolicy: mockGetQuotaPolicy as any,
    randomBytesFn: () => Buffer.from('random-key-1234567890', 'utf-8'),
    now: () => new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  })

describe('AuthContextService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('resolves active user from token', async () => {
    const prisma = createMockPrisma()
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      status: 'ACTIVE',
      preferredModelId: 'm1',
      preferredConnectionId: 2,
      preferredModelRawId: 'raw',
      avatarPath: 'avatar.png',
    })
    const service = createService(prisma)

    const result = await service.resolveActor({ authHeader: 'Bearer valid' })

    expect(result.actor?.type).toBe('user')
    expect(result.actor && result.actor.preferredModel?.modelId).toBe('m1')
    expect(mockAuthUtils.verifyToken).toHaveBeenCalled()
  })

  test('rejects inactive user', async () => {
    const prisma = createMockPrisma()
    prisma.user.findUnique.mockResolvedValue({
      id: 2,
      username: 'bob',
      role: 'USER',
      status: 'DISABLED',
    })
    const service = createService(prisma)

    const result = await service.resolveActor({ authHeader: 'Bearer valid' })

    expect(result.actor).toBeNull()
    expect(result.status).toBe(403)
    expect(result.clearAuth).toBe(true)
  })

  test('rejects when anonymous disabled', async () => {
    const prisma = createMockPrisma()
    const service = createService(prisma, {
      getQuotaPolicy: async () => ({
        anonymousDailyQuota: 0,
        defaultUserDailyQuota: 10,
        anonymousRetentionDays: 1,
      }),
    })

    const result = await service.resolveActor({ authHeader: null })

    expect(result.actor).toBeNull()
    expect(result.status).toBe(401)
    expect(result.clearAnon).toBe(true)
  })

  test('generates anonymous actor when enabled', async () => {
    const prisma = createMockPrisma()
    const service = createService(prisma)

    const result = await service.resolveActor({ authHeader: null, anonCookie: null })

    expect(result.actor?.type).toBe('anonymous')
    expect(result.actor && result.actor.identifier.startsWith('anon:')).toBe(true)
    expect(result.anonCookie?.key).toBeDefined()
    expect(result.anonCookie?.retentionDays).toBe(7)
  })

  test('uses existing anon cookie when valid', async () => {
    const prisma = createMockPrisma()
    const service = createService(prisma)

    const result = await service.resolveActor({ authHeader: null, anonCookie: 'anon_valid_key' })

    expect(result.actor?.type).toBe('anonymous')
    expect(result.actor?.identifier).toBe('anon:anon_valid_key')
    expect(result.anonCookie?.key).toBe('anon_valid_key')
  })
})
