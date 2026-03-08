import type { Actor } from '../../types'
import { ShareService } from './share-service'

const baseDate = new Date('2024-01-01T00:00:00.000Z')

const createMockPrisma = () => ({
  chatSession: {
    findFirst: jest.fn(),
  },
  message: {
    findMany: jest.fn(),
  },
  systemSetting: {
    findUnique: jest.fn(),
  },
  chatShare: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
})

const createService = () => {
  const prisma = createMockPrisma()
  const logger = { error: jest.fn(), warn: jest.fn() }
  const service = new ShareService({ prisma: prisma as any, logger })
  return { service, prisma }
}

const userActor: Actor = {
  type: 'user',
  id: 1,
  username: 'demo',
  role: 'ADMIN',
  status: 'ACTIVE',
  identifier: 'user:1',
}

describe('ShareService', () => {
  it('creates share with provided title and expiry', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 20,
        sessionId: 11,
        role: 'assistant',
        content: 'Hello',
        reasoning: null,
        toolLogsJson: JSON.stringify([
          {
            id: 'tool-1',
            tool: 'web_search',
            stage: 'result',
            query: 'hello',
            createdAt: Date.now(),
            hits: [
              {
                title: 'Web Result',
                url: 'https://example.com',
                imageUrl: 'https://example.com/cover.png',
              },
            ],
          },
        ]),
        createdAt: baseDate,
        attachments: [{ relativePath: '/img/a.png' }],
        generatedImages: [
          {
            url: 'https://cdn.example.com/generated/1.png',
            storagePath: null,
            base64: null,
            mime: 'image/png',
            width: 640,
            height: 480,
            revisedPrompt: 'generated-1',
          },
        ],
      },
    ])
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    prisma.chatShare.create.mockResolvedValue({
      id: 99,
      sessionId: 11,
      token: 'token-1',
      title: 'Custom Title',
      messageIdsJson: '[20]',
      payloadJson: '{}',
      createdByUserId: 1,
      createdByAnonymousKey: null,
      createdAt: baseDate,
      expiresAt: new Date(baseDate.getTime() + 3600_000),
      revokedAt: null,
    })

    const result = await service.createShare(
      userActor,
      { sessionId: 11, messageIds: [20], title: 'Custom Title', expiresInHours: 24 },
      {},
    )

    expect(prisma.chatShare.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Custom Title',
          messageIdsJson: JSON.stringify([20]),
          expiresAt: expect.any(Date),
        }),
      }),
    )
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          generatedImages: expect.objectContaining({
            select: expect.any(Object),
          }),
        }),
      }),
    )
    const createPayload = prisma.chatShare.create.mock.calls[0]?.[0]
    const persistedPayload = JSON.parse(createPayload?.data?.payloadJson ?? '{}') as any
    expect(persistedPayload?.messages?.[0]?.richPayload).toMatchObject({ layout: 'side-by-side' })
    expect(persistedPayload?.messages?.[0]?.richPayload?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Hello' })]),
    )
    expect(persistedPayload?.messages?.[0]?.richPayload?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          source: 'attachment',
          url: expect.stringContaining('/img/a.png'),
        }),
        expect.objectContaining({
          type: 'image',
          source: 'generated',
          url: 'https://cdn.example.com/generated/1.png',
        }),
        expect.objectContaining({
          type: 'image',
          source: 'external',
          url: 'https://example.com/cover.png',
          sourceUrl: 'https://example.com',
        }),
      ]),
    )
    expect(result.title).toBe('Custom Title')
    expect(result.messageCount).toBe(1)
    const resultRichPayload = (result.messages[0] as any).richPayload
    expect(resultRichPayload).toMatchObject({ layout: 'side-by-side' })
    expect(resultRichPayload.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Hello' })]),
    )
  })

  it('lists shares with pagination metadata', async () => {
    const { service, prisma } = createService()
    prisma.chatShare.findMany.mockResolvedValue([
      {
        id: 1,
        sessionId: 11,
        token: 't1',
        title: 'Link A',
        messageIdsJson: '[10,11]',
        payloadJson: '{}',
        createdAt: baseDate,
        expiresAt: null,
        revokedAt: null,
        session: { title: 'Chat Title' },
      },
    ])
    prisma.chatShare.count.mockResolvedValue(1)

    const result = await service.listShares(userActor, { status: 'all', page: 1, limit: 5 })

    expect(prisma.chatShare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          session: { userId: 1 },
        }),
        take: 5,
      }),
    )
    expect(result.shares[0]).toMatchObject({
      title: 'Link A',
      sessionTitle: 'Chat Title',
      messageCount: 2,
    })
    expect(result.pagination.total).toBe(1)
  })

  it('updates share title and expiry', async () => {
    const { service, prisma } = createService()
    const shareRecord = {
      id: 5,
      sessionId: 11,
      token: 't2',
      title: 'Old',
      messageIdsJson: '[1]',
      payloadJson: '{}',
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
      session: { title: 'Chat Title' },
    }
    prisma.chatShare.findFirst.mockResolvedValue(shareRecord)
    prisma.chatShare.update.mockResolvedValue({
      ...shareRecord,
      title: 'Updated',
      expiresAt: new Date(baseDate.getTime() + 2 * 3600_000),
    })

    const result = await service.updateShare(userActor, 5, { title: 'Updated', expiresInHours: 2 })

    expect(prisma.chatShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          title: 'Updated',
          expiresAt: expect.any(Date),
        }),
      }),
    )
    expect(result.title).toBe('Updated')
    expect(result.expiresAt).toBeTruthy()
  })

  it('revokes share for owner', async () => {
    const { service, prisma } = createService()
    const shareRecord = {
      id: 8,
      sessionId: 11,
      token: 't3',
      title: 'Old Link',
      messageIdsJson: '[1]',
      payloadJson: '{}',
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
      session: { title: 'Chat Title' },
    }
    prisma.chatShare.findFirst.mockResolvedValue(shareRecord)
    prisma.chatShare.update.mockResolvedValue({
      ...shareRecord,
      revokedAt: new Date(baseDate.getTime() + 1000),
    })

    const result = await service.revokeShare(userActor, 8)

    expect(prisma.chatShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: { revokedAt: expect.any(Date) },
      }),
    )
    expect(result.revokedAt).toBeTruthy()
  })

  it('returns share metadata without messages when includeMessages=false', async () => {
    const { service, prisma } = createService()
    prisma.chatShare.findFirst.mockResolvedValue({
      id: 77,
      sessionId: 11,
      token: 'token-meta',
      title: 'Share Meta',
      payloadJson: JSON.stringify({
        sessionTitle: 'Session A',
        messages: [
          { id: 1, role: 'user', content: 'hello', createdAt: baseDate.toISOString() },
          { id: 2, role: 'assistant', content: 'world', createdAt: baseDate.toISOString() },
        ],
      }),
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
    })

    const result = await service.getShareByToken('token-meta', { includeMessages: false })

    expect(result).toMatchObject({
      id: 77,
      messageCount: 2,
      messages: [],
      sessionTitle: 'Session A',
    })
  })

  it('lists share messages with pagination', async () => {
    const { service, prisma } = createService()
    prisma.chatShare.findFirst.mockResolvedValue({
      id: 88,
      sessionId: 12,
      token: 'token-page',
      title: 'Share Page',
      payloadJson: JSON.stringify({
        sessionTitle: 'Session B',
        messages: [
          { id: 1, role: 'user', content: 'm1', createdAt: baseDate.toISOString() },
          { id: 2, role: 'assistant', content: 'm2', createdAt: baseDate.toISOString() },
          { id: 3, role: 'assistant', content: 'm3', createdAt: baseDate.toISOString() },
        ],
      }),
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
    })

    const result = await service.listShareMessagesByToken('token-page', { page: 2, limit: 2 })

    expect(result).toMatchObject({
      token: 'token-page',
      sessionId: 12,
      pagination: {
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      },
    })
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0]?.content).toBe('m3')
  })
})
