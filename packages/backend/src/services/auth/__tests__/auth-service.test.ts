import { AuthService, AuthServiceError } from '../auth-service'

const createMockPrisma = () => {
  return {
    user: {
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    systemSetting: {
      findUnique: jest.fn(),
    },
  }
}

const mockAuthUtils = {
  validateUsername: jest.fn(() => true),
  validatePassword: jest.fn(() => true),
  hashPassword: jest.fn(async (value: string) => `hashed:${value}`),
  verifyPassword: jest.fn(async (value: string, stored: string) => stored === `hashed:${value}`),
  generateToken: jest.fn(() => 'jwt-token'),
}

const mockInspectQuota = jest.fn(async () => ({
  scope: 'USER',
  identifier: 'user:1',
  dailyLimit: 10,
  usedCount: 0,
  remaining: 10,
  lastResetAt: new Date('2024-01-01T00:00:00Z'),
  unlimited: false,
  customDailyLimit: null,
  usingDefaultLimit: true,
}))

const stubDetermineBaseUrl = jest.fn(() => 'http://example.com')
const stubResolveAvatarUrl = jest.fn((path: string | null) => (path ? `http://example.com/${path}` : null))

const createService = (prisma: any) =>
  new AuthService({
    prisma,
    authUtils: mockAuthUtils,
    inspectActorQuota: mockInspectQuota as any,
    determineProfileImageBaseUrl: stubDetermineBaseUrl as any,
    resolveProfileImageUrl: stubResolveAvatarUrl as any,
    now: () => new Date('2024-01-02T00:00:00Z'),
  })

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('register grants admin and token for first user', async () => {
    const prisma = createMockPrisma()
    prisma.user.count.mockResolvedValue(0)
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      status: 'ACTIVE',
      avatarPath: null,
    })
    const service = createService(prisma)

    const result = await service.register({ username: 'alice', password: 'Password123' })

    expect(result.user.role).toBe('ADMIN')
    expect(result.user.status).toBe('ACTIVE')
    expect(result.token).toBe('jwt-token')
    expect(prisma.user.create).toHaveBeenCalled()
  })

  test('register rejects when registration is disabled', async () => {
    const prisma = createMockPrisma()
    prisma.user.count.mockResolvedValue(1)
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' })
    const service = createService(prisma)

    await expect(service.register({ username: 'bob', password: 'Password123' })).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  test('login blocks pending users', async () => {
    const prisma = createMockPrisma()
    prisma.user.findUnique.mockResolvedValue({
      id: 2,
      username: 'eve',
      hashedPassword: 'hashed:secret',
      role: 'USER',
      status: 'PENDING',
      rejectionReason: 'waiting',
      avatarPath: null,
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
    })
    const service = createService(prisma)

    await expect(service.login({ username: 'eve', password: 'secret', request: new Request('http://localhost') }))
      .rejects
      .toEqual(expect.objectContaining<AuthServiceError>({ statusCode: 423 }))
  })

  test('login returns avatar url and token for active user', async () => {
    const prisma = createMockPrisma()
    prisma.user.findUnique.mockResolvedValue({
      id: 3,
      username: 'neo',
      hashedPassword: 'hashed:matrix',
      role: 'USER',
      status: 'ACTIVE',
      rejectionReason: null,
      avatarPath: 'avatar.png',
      preferredModelId: 'gpt-4',
      preferredConnectionId: 9,
      preferredModelRawId: 'gpt-4o',
    })
    const service = createService(prisma)

    const result = await service.login({ username: 'neo', password: 'matrix', request: new Request('http://localhost') })

    expect(result.token).toBe('jwt-token')
    expect(result.user.avatarUrl).toBe('http://example.com/avatar.png')
    expect(result.quota).toBeTruthy()
  })

  test('updatePassword validates and persists new hash', async () => {
    const prisma = createMockPrisma()
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      username: 'trinity',
      role: 'USER',
      status: 'ACTIVE',
      hashedPassword: 'hashed:oldpass',
    })
    prisma.user.update.mockResolvedValue({})
    const service = createService(prisma)

    const result = await service.updatePassword({
      userId: 4,
      currentPassword: 'oldpass',
      newPassword: 'newpass123',
    })

    expect(result.user.id).toBe(4)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { hashedPassword: 'hashed:newpass123' },
    })
  })

  test('resolveActorContext returns merged actor context', async () => {
    const prisma = createMockPrisma()
    const createdAt = new Date('2024-03-01T00:00:00Z')
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 5,
        username: 'morpheus',
        role: 'ADMIN',
        status: 'ACTIVE',
        createdAt,
        preferredModelId: 'm1',
        preferredConnectionId: 2,
        preferredModelRawId: 'raw',
        avatarPath: 'icon.png',
      })
      .mockResolvedValueOnce({ createdAt })
    const service = createService(prisma)

    const actor = {
      type: 'user' as const,
      id: 5,
      username: 'morpheus',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      identifier: 'user:5',
    }

    const result = await service.resolveActorContext(actor, new Request('http://localhost'))

    expect(result.actor).toMatchObject({ id: 5 })
    expect(result.user?.avatarUrl).toBe('http://example.com/icon.png')
    expect(result.preferredModel?.modelId).toBe('m1')
    expect(result.quota).toBeTruthy()
  })
})
