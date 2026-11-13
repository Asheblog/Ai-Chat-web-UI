import { AuthContextService } from '../auth-context-service'
import { AUTH_TOKEN_TTL_SECONDS } from '../../../utils/auth'

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
  generateToken: jest.fn(() => 'renewed-token'),
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
      personalPrompt: 'stay sharp',
      contextEnabled: false,
    })
    const service = createService(prisma)

    const result = await service.resolveActor({ authHeader: 'Bearer valid' })

    expect(result.actor?.type).toBe('user')
    expect(result.actor && result.actor.preferredModel?.modelId).toBe('m1')
    expect(result.actor && result.actor.personalPrompt).toBe('stay sharp')
    expect(result.actor && result.actor.contextEnabled).toBe(false)
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

  describe('sliding token renewal', () => {
    const nowSeconds = Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000)
    const activeUser = { id: 1, username: 'alice', role: 'USER', status: 'ACTIVE' }

    const createServiceWithPayload = (payload: unknown, generateToken = jest.fn(() => 'renewed-token')) => {
      const prisma = createMockPrisma()
      prisma.user.findUnique.mockResolvedValue(activeUser)
      const verifyToken = jest.fn(() => payload)
      const service = createService(prisma, {
        authUtils: { ...mockAuthUtils, verifyToken, generateToken } as any,
      })
      return { service, generateToken }
    }

    test('renews the token when less than half of the TTL remains', async () => {
      const { service, generateToken } = createServiceWithPayload({
        userId: 1,
        username: 'alice',
        role: 'USER',
        iat: nowSeconds - 20 * 3600,
        exp: nowSeconds + 3600,
      })

      const result = await service.resolveActor({ authHeader: 'Bearer stale' })

      expect(result.actor?.type).toBe('user')
      expect(generateToken).toHaveBeenCalledWith({ userId: 1, username: 'alice', role: 'USER' })
      expect(result.authCookie).toEqual({ token: 'renewed-token', maxAge: AUTH_TOKEN_TTL_SECONDS })
    })

    test('keeps the existing token while more than half of the TTL remains', async () => {
      const { service, generateToken } = createServiceWithPayload({
        userId: 1,
        username: 'alice',
        role: 'USER',
        iat: nowSeconds - 3600,
        exp: nowSeconds + 20 * 3600,
      })

      const result = await service.resolveActor({ authHeader: 'Bearer fresh' })

      expect(result.actor?.type).toBe('user')
      expect(generateToken).not.toHaveBeenCalled()
      expect(result.authCookie).toBeNull()
    })

    test('upgrades legacy tokens that carry neither exp nor iat', async () => {
      const { service, generateToken } = createServiceWithPayload({
        userId: 1,
        username: 'alice',
        role: 'USER',
      })

      const result = await service.resolveActor({ authHeader: 'Bearer legacy' })

      expect(result.actor?.type).toBe('user')
      expect(generateToken).toHaveBeenCalled()
      expect(result.authCookie?.token).toBe('renewed-token')
    })

    test('never leaks a renewal for rejected users', async () => {
      const prisma = createMockPrisma()
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, status: 'DISABLED' })
      const generateToken = jest.fn(() => 'renewed-token')
      const service = createService(prisma, {
        authUtils: { ...mockAuthUtils, generateToken } as any,
      })

      const result = await service.resolveActor({ authHeader: 'Bearer valid' })

      expect(result.actor).toBeNull()
      expect(result.authCookie).toBeUndefined()
      expect(generateToken).not.toHaveBeenCalled()
    })
  })
})
