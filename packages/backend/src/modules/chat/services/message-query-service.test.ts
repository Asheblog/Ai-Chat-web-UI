import type { Request } from 'undici'
import { ChatMessageQueryService } from './message-query-service'

const buildService = () => {
  const prisma = {
    message: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    messageGroup: {
      findMany: jest.fn(),
    },
    systemSetting: {
      findUnique: jest.fn(),
    },
  }

  const determineChatImageBaseUrl = jest.fn(({ siteBaseUrl }: { request: Request; siteBaseUrl: string | null }) =>
    siteBaseUrl || 'http://localhost',
  )
  const resolveChatImageUrls = jest.fn((paths: string[], base: string) =>
    paths.map((p) => `${base}${p}`),
  )
  const parseToolLogsJson = jest.fn(() => [{ level: 'info', message: 'tool-event' }])

  const service = new ChatMessageQueryService({
    prisma: prisma as any,
    determineChatImageBaseUrl,
    resolveChatImageUrls,
    parseToolLogsJson,
  })

  const actor = { type: 'user', id: 1, role: 'ADMIN', identifier: 'user:1' } as const
  const request = new Request('http://example.com')

  return {
    prisma,
    determineChatImageBaseUrl,
    resolveChatImageUrls,
    parseToolLogsJson,
    service,
    actor,
    request,
  }
}

describe('ChatMessageQueryService', () => {
  it('lists messages with normalized images and tool events', async () => {
    const { prisma, service, actor, request, resolveChatImageUrls, parseToolLogsJson, determineChatImageBaseUrl } =
      buildService()

    prisma.message.findMany.mockResolvedValue([
      {
        id: 10,
        sessionId: 5,
        messageGroupId: null,
        role: 'assistant',
        content: 'hi',
        parentMessageId: null,
        variantIndex: null,
        attachments: [{ relativePath: '/img/a.png' }],
        clientMessageId: 'c1',
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: '{"events":[]}',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        streamStatus: null,
        streamCursor: null,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
      },
    ])
    prisma.messageGroup.findMany.mockResolvedValue([])
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'https://cdn.example.com' })

    const result = await service.listMessages({
      actor,
      sessionId: 5,
      page: 1,
      limit: 2,
      request,
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 5 },
      }),
    )
    expect(determineChatImageBaseUrl).toHaveBeenCalledWith({
      request,
      siteBaseUrl: 'https://cdn.example.com',
    })
    expect(resolveChatImageUrls).toHaveBeenCalledWith(['/img/a.png'], 'https://cdn.example.com')
    expect(parseToolLogsJson).toHaveBeenCalled()
    expect(result.messages[0].images).toEqual(['https://cdn.example.com/img/a.png'])
    expect(result.messages[0].toolEvents).toEqual([{ level: 'info', message: 'tool-event' }])
    expect(result.pagination).toEqual({ page: 1, limit: 2, total: 1, totalPages: 1 })
  })

  it('gets message by id respecting ownership', async () => {
    const { prisma, service, actor, request, resolveChatImageUrls } = buildService()
    prisma.message.findFirst.mockResolvedValue({
      id: 20,
      sessionId: 7,
      messageGroupId: null,
      role: 'assistant',
      content: 'ok',
      parentMessageId: 1,
      variantIndex: 0,
      attachments: [],
      clientMessageId: 'client-1',
      reasoning: 'because',
      reasoningDurationSeconds: 2,
      toolLogsJson: null,
      createdAt: new Date('2024-02-01T00:00:00Z'),
      updatedAt: new Date('2024-02-01T00:00:00Z'),
      streamStatus: 'streaming',
      streamCursor: 0,
      streamReasoning: null,
      streamError: null,
      usageMetrics: [],
    })
    prisma.systemSetting.findUnique.mockResolvedValue({ value: null })

    const message = await service.getMessageById({
      actor,
      sessionId: 7,
      messageId: 20,
      request,
    })

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 20,
          sessionId: 7,
          session: { userId: actor.id },
        }),
      }),
    )
    expect(message?.clientMessageId).toBe('client-1')
    expect(resolveChatImageUrls).toHaveBeenCalled()
  })

  it('returns null when message by client id is missing', async () => {
    const { prisma, service, actor, request, determineChatImageBaseUrl } = buildService()
    prisma.message.findFirst.mockResolvedValue(null)

    const result = await service.getMessageByClientId({
      actor,
      sessionId: 9,
      clientMessageId: 'missing',
      request,
    })

    expect(result).toBeNull()
    expect(determineChatImageBaseUrl).not.toHaveBeenCalled()
  })
})
