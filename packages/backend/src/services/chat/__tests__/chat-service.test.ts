import type { Actor } from '../../../types'
import { ChatService, ChatServiceError } from '../chat-service'

const createMockPrisma = () => ({
  chatSession: {
    findFirst: jest.fn(),
  },
})

const baseSession = {
  id: 1,
  userId: 1,
  anonymousKey: null,
  expiresAt: null,
  connectionId: 3,
  modelRawId: 'gpt-4o',
  title: 'Demo',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  reasoningEnabled: null,
  reasoningEffort: null,
  ollamaThink: null,
  connection: {
    id: 3,
    provider: 'openai',
    baseUrl: 'https://api',
    prefixId: 'openai',
  },
}

describe('ChatService', () => {
  const actor: Actor = {
    type: 'user',
    id: 1,
    username: 'demo',
    role: 'ADMIN',
    status: 'ACTIVE',
    identifier: 'user:1',
  }

  it('returns session with connection', async () => {
    const prisma = createMockPrisma()
    prisma.chatSession.findFirst.mockResolvedValue({ ...baseSession })
    const service = new ChatService({ prisma: prisma as any })

    const session = await service.getSessionWithConnection(actor, 1)

    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 1,
        userId: 1,
      },
      include: { connection: true },
    })
    expect(session.connection?.provider).toBe('openai')
  })

  it('throws when session missing', async () => {
    const prisma = createMockPrisma()
    prisma.chatSession.findFirst.mockResolvedValue(null)
    const service = new ChatService({ prisma: prisma as any })

    await expect(service.getSessionWithConnection(actor, 99)).rejects.toEqual(
      expect.objectContaining({ statusCode: 404 }),
    )
  })

  it('throws when session lacks model binding', async () => {
    const prisma = createMockPrisma()
    prisma.chatSession.findFirst.mockResolvedValue({
      ...baseSession,
      connectionId: null,
      modelRawId: null,
      connection: null,
    })
    const service = new ChatService({ prisma: prisma as any })

    await expect(service.getSessionWithConnection(actor, 1)).rejects.toEqual(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('ensures anonymous session access', async () => {
    const prisma = createMockPrisma()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 5 })
    const service = new ChatService({ prisma: prisma as any })

    const anon: Actor = {
      type: 'anonymous',
      key: 'anon-key',
      identifier: 'anon:anon-key',
      expiresAt: null,
    }

    const result = await service.ensureSessionAccess(anon, 5)

    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 5,
        anonymousKey: 'anon-key',
      },
      select: { id: true },
    })
    expect(result.id).toBe(5)
  })

  it('ensureSessionAccess throws for unknown session', async () => {
    const prisma = createMockPrisma()
    prisma.chatSession.findFirst.mockResolvedValue(null)
    const service = new ChatService({ prisma: prisma as any })

    await expect(service.ensureSessionAccess(actor, 2)).rejects.toBeInstanceOf(ChatServiceError)
  })
})
