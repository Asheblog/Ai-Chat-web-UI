import type { Actor } from '../../../types'
import { SessionService, SessionServiceError } from '../session-service'

const createMockPrisma = () => ({
  chatSession: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  connection: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  modelCatalog: {
    findFirst: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
  message: {
    deleteMany: jest.fn(),
  },
})

const createService = (overrides?: {
  ensureAnonymousSession?: ReturnType<typeof jest.fn>
  modelResolverService?: { resolveModelForRequest: jest.Mock }
}) => {
  const prisma = createMockPrisma()
  const ensureAnonymousSession =
    overrides?.ensureAnonymousSession ?? jest.fn().mockResolvedValue(null)
  const modelResolverService =
    overrides?.modelResolverService ??
    ({
      resolveModelForRequest: jest.fn().mockResolvedValue({
        connection: { id: 99, provider: 'openai', baseUrl: 'https://api', prefixId: 'openai' },
        rawModelId: 'gpt-4o',
      }),
    } as any)
  const logger = { warn: jest.fn(), error: jest.fn() }
  const service = new SessionService({
    prisma: prisma as any,
    ensureAnonymousSession,
    modelResolverService: modelResolverService as any,
    logger,
  })
  return { service, prisma, ensureAnonymousSession, modelResolverService }
}

const baseDate = new Date('2024-01-01T00:00:00.000Z')

describe('SessionService', () => {
  it('creates session using explicit connection and updates preferences', async () => {
    const { service, prisma, modelResolverService } = createService()
    const actor: Actor = {
      type: 'user',
      id: 1,
      username: 'demo',
      role: 'ADMIN',
      status: 'ACTIVE',
      identifier: 'user:1',
    }

    const connection = { id: 22, provider: 'openai', baseUrl: 'https://api', prefixId: 'openai' }
    modelResolverService.resolveModelForRequest.mockResolvedValue({
      connection,
      rawModelId: 'gpt-4o',
    })
    prisma.chatSession.create.mockResolvedValue({
      id: 10,
      userId: 1,
      anonymousKey: null,
      expiresAt: null,
      connectionId: 22,
      modelRawId: 'gpt-4o',
      title: 'Hello',
      createdAt: baseDate,
      reasoningEnabled: null,
      reasoningEffort: null,
      ollamaThink: null,
      systemPrompt: null,
      knowledgeBaseIdsJson: '[1,2,2]',
      connection,
      messages: [],
    })
    prisma.user.update.mockResolvedValue({})

    const result = await service.createSession(actor, {
      modelId: 'openai.gpt-4o',
      title: 'Hello',
      connectionId: 22,
      rawId: 'gpt-4o',
      knowledgeBaseIds: [3, 5, 5, -1],
    })

    expect(modelResolverService.resolveModelForRequest).toHaveBeenCalledWith({
      actor,
      userId: 1,
      modelId: 'openai.gpt-4o',
      connectionId: 22,
      rawId: 'gpt-4o',
    })
    expect(prisma.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          connectionId: 22,
          modelRawId: 'gpt-4o',
          title: 'Hello',
          knowledgeBaseIdsJson: JSON.stringify([3, 5]),
        }),
      }),
    )
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        preferredModelId: 'openai.gpt-4o',
        preferredConnectionId: 22,
        preferredModelRawId: 'gpt-4o',
      },
    })
    expect(result.modelLabel).toBe('openai.gpt-4o')
    expect(result.knowledgeBaseIds).toEqual([1, 2])
  })

  it('creates anonymous session using catalog fallback', async () => {
    const ensureAnonymousSession = jest.fn().mockResolvedValue({
      anonymousKey: 'anon-key',
      expiresAt: baseDate,
    })
    const connection = { id: 30, provider: 'ollama', baseUrl: 'http://ollama', prefixId: 'llama' }
    const { service, prisma, modelResolverService } = createService({
      ensureAnonymousSession,
      modelResolverService: {
        resolveModelForRequest: jest.fn().mockResolvedValue({
          connection,
          rawModelId: 'llama-3',
        }),
      } as any,
    })
    const actor: Actor = {
      type: 'anonymous',
      key: 'anon-key',
      identifier: 'anon:anon-key',
      expiresAt: null,
    }

    prisma.chatSession.create.mockResolvedValue({
      id: 11,
      userId: null,
      anonymousKey: 'anon-key',
      expiresAt: baseDate,
      connectionId: 30,
      modelRawId: 'llama-3',
      title: 'New Chat',
      createdAt: baseDate,
      reasoningEnabled: true,
      reasoningEffort: 'low',
      ollamaThink: false,
      systemPrompt: null,
      knowledgeBaseIdsJson: '[]',
      connection,
      messages: [],
    })

    const result = await service.createSession(actor, {
      modelId: 'llama.llama-3',
      reasoningEnabled: true,
      reasoningEffort: 'low',
    })

    expect(ensureAnonymousSession).toHaveBeenCalledWith(actor)
    expect(modelResolverService.resolveModelForRequest).toHaveBeenCalledWith({
      actor,
      userId: null,
      modelId: 'llama.llama-3',
      connectionId: undefined,
      rawId: undefined,
    })
    expect(prisma.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          anonymousKey: 'anon-key',
          expiresAt: baseDate,
          reasoningEnabled: true,
          reasoningEffort: 'low',
        }),
      }),
    )
    expect(result.connectionId).toBe(30)
    expect(result.modelLabel).toBe('llama.llama-3')
  })

  it('throws when switching model for missing session', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue(null)

    const actor: Actor = {
      type: 'user',
      id: 9,
      username: 'ghost',
      role: 'USER',
      status: 'ACTIVE',
      identifier: 'user:9',
    }

    await expect(
      service.switchSessionModel(actor, 99, { modelId: 'invalid' }),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('lists sessions with normalized pagination response', async () => {
    const { service, prisma } = createService()
    const actor: Actor = {
      type: 'anonymous',
      key: 'anon',
      identifier: 'anon:anon',
      expiresAt: null,
    }

    prisma.chatSession.findMany.mockResolvedValue([
      {
        id: 1,
        userId: null,
        anonymousKey: 'anon',
        expiresAt: null,
        connectionId: 1,
        modelRawId: 'gpt-4o',
        title: 'Chat',
        createdAt: baseDate,
        reasoningEnabled: null,
        reasoningEffort: 'weird',
        ollamaThink: null,
        systemPrompt: null,
        knowledgeBaseIdsJson: '[4,6,6,0]',
        connection: { id: 1, provider: 'openai', baseUrl: 'https://api', prefixId: 'openai' },
        messages: [
          {
            content: '最后一条消息内容',
            createdAt: new Date('2024-01-01T00:05:00.000Z'),
          },
        ],
      },
    ])
    prisma.chatSession.count.mockResolvedValue(1)

    const result = await service.listSessions(actor, { page: -1, limit: 0 })

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { anonymousKey: 'anon' },
        skip: 0,
        take: 20,
      }),
    )
    expect(result.sessions[0].modelLabel).toBe('openai.gpt-4o')
    expect(result.sessions[0].reasoningEffort).toBeNull()
    expect(result.sessions[0].knowledgeBaseIds).toEqual([4, 6])
    expect(result.sessions[0].lastMessagePreview).toBe('最后一条消息内容')
    expect(result.sessions[0].lastMessageAt).toBe('2024-01-01T00:05:00.000Z')
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    })
  })

  it('throws user-friendly error when model cannot be resolved', async () => {
    const { service, modelResolverService } = createService({
      modelResolverService: {
        resolveModelForRequest: jest.fn().mockResolvedValue(null),
      } as any,
    })

    const actor: Actor = {
      type: 'user',
      id: 5,
      username: 'tester',
      role: 'USER',
      status: 'ACTIVE',
      identifier: 'user:5',
    }

    await expect(
      service.createSession(actor, { modelId: 'missing-model' }),
    ).rejects.toBeInstanceOf(SessionServiceError)
    expect(modelResolverService.resolveModelForRequest).toHaveBeenCalled()
  })
})
