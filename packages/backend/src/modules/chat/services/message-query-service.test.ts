import type { Request } from 'undici'
import { ChatMessageQueryService } from './message-query-service'

const buildService = () => {
  const prisma = {
    message: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    messageGroup: {
      findMany: jest.fn(),
      count: jest.fn(),
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
  it('lists messages with normalized images, tool events and rich payload', async () => {
    const { prisma, service, actor, request, resolveChatImageUrls, parseToolLogsJson, determineChatImageBaseUrl } =
      buildService()
    parseToolLogsJson.mockReturnValue([
      {
        id: 'tool-1',
        tool: 'web_search',
        stage: 'result',
        createdAt: Date.now(),
        hits: [
          {
            title: 'Result A',
            url: 'https://example.com/a',
            imageUrl: 'https://example.com/a.png',
          },
        ],
        details: {
          assessedImages: [
            {
              url: 'https://cdn.example.com/evidence.png',
              confidence: 'high',
              title: 'Evidence',
            },
          ],
        },
      },
    ])

    prisma.message.count.mockResolvedValue(1)
    prisma.messageGroup.count.mockResolvedValue(0)
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
        toolLogsJson: JSON.stringify([
          {
            id: 'tool-1',
            tool: 'web_search',
            stage: 'result',
            query: 'result-a',
            createdAt: Date.now(),
            hits: [
              {
                title: 'Result A',
                url: 'https://example.com/a',
                imageUrl: 'https://example.com/a.png',
              },
            ],
          },
        ]),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        streamStatus: null,
        streamCursor: null,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [
          {
            url: 'https://cdn.example.com/generated/a.png',
            storagePath: null,
            base64: null,
            mime: 'image/png',
            width: 1024,
            height: 768,
            revisedPrompt: 'generated',
          },
        ],
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

    expect(prisma.message.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 5, messageGroupId: null },
      }),
    )
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 5, messageGroupId: null },
        take: 1,
      }),
    )
    expect(determineChatImageBaseUrl).toHaveBeenCalledWith({
      request,
      siteBaseUrl: 'https://cdn.example.com',
    })
    expect(resolveChatImageUrls).toHaveBeenCalledWith(['/img/a.png'], 'https://cdn.example.com')
    expect(parseToolLogsJson).toHaveBeenCalled()
    expect(result.messages[0].images).toEqual(['https://cdn.example.com/img/a.png'])
    expect(result.messages[0].toolEvents).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        tool: 'web_search',
        details: expect.objectContaining({ hitsCount: 1 }),
      }),
    ])
    expect(result.messages[0].toolEvents?.[0]?.hits).toBeUndefined()
    expect(result.messages[0].toolEvents?.[0]?.details).not.toHaveProperty('assessedImages')
    const richPayload = (result.messages[0] as any).richPayload
    expect(richPayload).toBeTruthy()
    expect(richPayload).toMatchObject({ layout: 'stack' })
    expect(richPayload.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'hi' })]),
    )
    expect(richPayload?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          source: 'attachment',
          url: 'https://cdn.example.com/img/a.png',
        }),
        expect.objectContaining({
          type: 'image',
          source: 'generated',
          url: 'https://cdn.example.com/generated/a.png',
        }),
        expect.objectContaining({
          type: 'image',
          source: 'external',
          url: 'https://cdn.example.com/evidence.png',
        }),
      ]),
    )
    expect(result.pagination).toEqual({ page: 1, limit: 2, total: 1, totalPages: 1 })
  })

  it('keeps full tool hits on getMessageById while listMessages projects them away', async () => {
    const { prisma, service, actor, request, parseToolLogsJson } = buildService()
    const fullEvents = [
      {
        id: 'tool-full',
        tool: 'web_search',
        stage: 'result' as const,
        createdAt: Date.now(),
        hits: [{ title: 'Full Hit', url: 'https://example.com/full' }],
        details: { engine: 'tavily' },
      },
    ]
    parseToolLogsJson.mockReturnValue(fullEvents)

    prisma.message.findFirst.mockResolvedValue({
      id: 30,
      sessionId: 5,
      messageGroupId: null,
      role: 'assistant',
      content: 'detail',
      parentMessageId: null,
      variantIndex: null,
      attachments: [],
      clientMessageId: 'c-full',
      reasoning: null,
      reasoningDurationSeconds: null,
      toolLogsJson: '[]',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      streamStatus: null,
      streamCursor: null,
      streamReasoning: null,
      streamError: null,
      usageMetrics: [],
      generatedImages: [],
    })
    prisma.systemSetting.findUnique.mockResolvedValue({ value: null })

    const detail = await service.getMessageById({
      actor,
      sessionId: 5,
      messageId: 30,
      request,
    })
    expect(detail?.toolEvents?.[0]?.hits).toEqual([
      expect.objectContaining({ title: 'Full Hit', url: 'https://example.com/full' }),
    ])
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

  it('lists latest page with SQL take and preserves compressed groups', async () => {
    const { prisma, service, actor, request } = buildService()
    prisma.message.count.mockResolvedValue(2)
    prisma.messageGroup.count.mockResolvedValue(1)
    prisma.systemSetting.findUnique.mockResolvedValue({ value: null })
    prisma.messageGroup.findMany.mockResolvedValue([
      {
        id: 7,
        sessionId: 5,
        summary: '摘要',
        compressedMessagesJson: JSON.stringify([
          { id: 1, role: 'user', content: 'old', createdAt: '2024-01-01T00:00:00.000Z' },
          { id: 2, role: 'assistant', content: 'old-a', createdAt: '2024-01-01T00:01:00.000Z' },
        ]),
        lastMessageId: 2,
        expanded: false,
        metadataJson: null,
        createdAt: new Date('2024-01-01T00:01:00Z'),
        updatedAt: new Date('2024-01-01T00:01:00Z'),
      },
    ])
    prisma.message.findMany.mockResolvedValue([
      {
        id: 3,
        sessionId: 5,
        messageGroupId: null,
        role: 'user',
        content: 'newer',
        parentMessageId: null,
        variantIndex: null,
        attachments: [],
        clientMessageId: null,
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        streamStatus: 'done',
        streamCursor: 0,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [],
      },
      {
        id: 4,
        sessionId: 5,
        messageGroupId: null,
        role: 'assistant',
        content: 'latest',
        parentMessageId: null,
        variantIndex: null,
        attachments: [],
        clientMessageId: null,
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: null,
        createdAt: new Date('2024-01-02T00:01:00Z'),
        updatedAt: new Date('2024-01-02T00:01:00Z'),
        streamStatus: 'done',
        streamCursor: 0,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [],
      },
    ])

    const result = await service.listMessages({
      actor,
      sessionId: 5,
      page: 'latest',
      limit: 3,
      request,
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 5, messageGroupId: null },
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    )
    expect(result.pagination).toEqual({ page: 1, limit: 3, total: 3, totalPages: 1 })
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]).toMatchObject({
      id: 'group:7',
      role: 'compressedGroup',
      content: '摘要',
    })
    expect(result.messages.map((m) => m.id)).toEqual(['group:7', 3, 4])
    expect(prisma.messageGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 5,
          cancelledAt: null,
        },
      }),
    )
    const groupWhere = prisma.messageGroup.findMany.mock.calls[0]?.[0]?.where
    expect(groupWhere).not.toHaveProperty('NOT')
  })

  it('excludes empty-summary groups from total without invalid Prisma NOT filter', async () => {
    const { prisma, service, actor, request } = buildService()
    prisma.message.count.mockResolvedValue(1)
    prisma.systemSetting.findUnique.mockResolvedValue({ value: null })
    prisma.messageGroup.findMany.mockResolvedValue([
      {
        id: 1,
        sessionId: 5,
        summary: '',
        compressedMessagesJson: '[]',
        lastMessageId: null,
        expanded: false,
        metadataJson: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        id: 2,
        sessionId: 5,
        summary: '  ',
        compressedMessagesJson: '[]',
        lastMessageId: null,
        expanded: false,
        metadataJson: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      },
    ])
    prisma.message.findMany.mockResolvedValue([
      {
        id: 10,
        sessionId: 5,
        messageGroupId: null,
        role: 'user',
        content: 'hi',
        parentMessageId: null,
        variantIndex: null,
        attachments: [],
        clientMessageId: null,
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        streamStatus: 'done',
        streamCursor: 0,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [],
      },
    ])

    const result = await service.listMessages({
      actor,
      sessionId: 5,
      page: 'latest',
      limit: 20,
      request,
    })

    expect(prisma.messageGroup.findMany.mock.calls[0]?.[0]?.where).toEqual({
      sessionId: 5,
      cancelledAt: null,
    })
    expect(result.pagination.total).toBe(1)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.id).toBe(10)
  })

  it('normalizes imageDescriptionsJson into imageDescriptions', async () => {
    const { prisma, service, actor, request } = buildService()
    prisma.message.count.mockResolvedValue(1)
    prisma.messageGroup.findMany.mockResolvedValue([])
    prisma.systemSetting.findUnique.mockResolvedValue({ value: null })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 30,
        sessionId: 5,
        messageGroupId: null,
        role: 'assistant',
        content: 'hi',
        parentMessageId: null,
        variantIndex: null,
        attachments: [],
        clientMessageId: null,
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: null,
        imageDescriptionsJson: JSON.stringify([{ description: '图', modelRawId: 'm' }]),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        streamStatus: null,
        streamCursor: null,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [],
      },
    ])

    const result = await service.listMessages({
      actor,
      sessionId: 5,
      page: 1,
      limit: 2,
      request,
    })

    expect(result.messages[0].imageDescriptions).toEqual([{ description: '图', modelRawId: 'm' }])
  })
})
