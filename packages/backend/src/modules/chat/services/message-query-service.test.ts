import type { Request } from 'undici'
import { ChatMessageQueryService, invalidateSiteBaseUrlCache } from './message-query-service'

const buildService = (options: { realToolLogParser?: boolean } = {}) => {
  invalidateSiteBaseUrlCache()
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
  const parseToolLogsPayload = jest.fn((_raw?: string | null, _options?: { mode?: string }) => ({
    entries: [{ level: 'info', message: 'tool-event' }] as any[],
    coverage: {
      trace: { status: 'unknown' as const },
      persisted: { status: 'unknown' as const },
      projection: { status: 'unknown' as const },
    },
  }))

  const service = new ChatMessageQueryService({
    prisma: prisma as any,
    determineChatImageBaseUrl,
    resolveChatImageUrls,
    ...(options.realToolLogParser ? {} : { parseToolLogsPayload }),
  })

  const actor = { type: 'user', id: 1, role: 'ADMIN', identifier: 'user:1' } as const
  const request = new Request('http://example.com')

  return {
    prisma,
    determineChatImageBaseUrl,
    resolveChatImageUrls,
    parseToolLogsPayload,
    service,
    actor,
    request,
  }
}

describe('ChatMessageQueryService', () => {
  it('lists messages with normalized images, tool events and rich payload', async () => {
    const { prisma, service, actor, request, resolveChatImageUrls, parseToolLogsPayload, determineChatImageBaseUrl } =
      buildService()
    parseToolLogsPayload.mockReturnValue({
      coverage: {
        trace: { status: 'unknown' as const },
        persisted: { status: 'unknown' as const },
        projection: { status: 'unknown' as const },
      },
      entries: [
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
      ],
    })

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
        select: expect.objectContaining({
          generatedImages: {
            select: expect.not.objectContaining({ base64: true }),
          },
        }),
      }),
    )
    expect(determineChatImageBaseUrl).toHaveBeenCalledWith({
      request,
      siteBaseUrl: 'https://cdn.example.com',
    })
    expect(resolveChatImageUrls).toHaveBeenCalledWith(['/img/a.png'], 'https://cdn.example.com')
    expect(parseToolLogsPayload).toHaveBeenCalledWith(expect.any(String), { mode: 'history-list' })
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
    expect(richPayload).toMatchObject({ layout: 'side-by-side' })
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
      ]),
    )
    expect(richPayload?.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'external' })]),
    )
    expect(result.pagination).toEqual({ page: 1, limit: 2, total: 1, totalPages: 1 })
  })

  it('keeps full tool hits on getMessageById while listMessages projects them away', async () => {
    const { prisma, service, actor, request, parseToolLogsPayload } = buildService()
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
    parseToolLogsPayload.mockReturnValue({
      entries: fullEvents,
      coverage: {
        trace: { status: 'unknown' as const },
        persisted: { status: 'unknown' as const },
        projection: { status: 'complete' as const },
      },
    })

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

  it('does not expose imageDescriptions on messages', async () => {
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
        // 历史行携带已删除列的数据：消息投影不得再暴露转写描述
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

    expect(result.messages[0]).not.toHaveProperty('imageDescriptions')
  })
})

describe('ChatMessageQueryService tool log coverage', () => {
  const baseMessage = (overrides: Record<string, unknown> = {}) => ({
    id: 40,
    sessionId: 5,
    messageGroupId: null,
    role: 'assistant',
    content: 'answer',
    parentMessageId: null,
    variantIndex: null,
    attachments: [],
    clientMessageId: 'c40',
    reasoning: null,
    reasoningDurationSeconds: null,
    toolLogsJson: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    streamStatus: 'done',
    streamCursor: 6,
    streamReasoning: null,
    streamError: null,
    usageMetrics: [],
    generatedImages: [],
    ...overrides,
  })

  const envelopeJson = JSON.stringify({
    v: 2,
    entries: [
      {
        id: 'call_1',
        callId: 'call_1',
        tool: 'web_search',
        stage: 'result',
        status: 'success',
        createdAt: 1000,
        details: { parentCallId: null, engine: 'tavily' },
      },
    ],
    coverage: {
      trace: { status: 'unknown' },
      persisted: { status: 'partial', asOf: 1000, droppedRecords: 2, truncatedFields: 3 },
      projection: { status: 'unknown' },
    },
    runResult: { stopReason: 'stop_tools', finalAnswerGenerated: false },
  })

  const setupList = async (message: Record<string, unknown>) => {
    const deps = buildService({ realToolLogParser: true })
    deps.prisma.message.count.mockResolvedValue(1)
    deps.prisma.messageGroup.findMany.mockResolvedValue([])
    deps.prisma.message.findMany.mockResolvedValue([message])
    deps.prisma.systemSetting.findUnique.mockResolvedValue({ value: null })
    const result = await deps.service.listMessages({
      actor: deps.actor,
      sessionId: 5,
      page: 1,
      limit: 10,
      request: deps.request,
    })
    return result.messages[0]
  }

  it('历史列表逐字透出 persisted 缺口与终止字段', async () => {
    const message = await setupList(baseMessage({ toolLogsJson: envelopeJson }))

    expect(message.toolLogCoverage?.persisted).toMatchObject({
      status: 'partial',
      droppedRecords: 2,
      truncatedFields: 3,
      asOf: 1000,
    })
    expect(message.toolLogCoverage?.trace.status).toBe('unknown')
    expect(message.toolLogCoverage?.projection.status).toBe('complete')
    expect(message.stopReason).toBe('stop_tools')
    expect(message.finalAnswerGenerated).toBe(false)
    expect(message.toolEvents?.[0]).toMatchObject({ id: 'call_1', callId: 'call_1' })
  })

  it('列表投影裁掉 hits 时 projection 标记 partial 并计量字段', async () => {
    const message = await setupList(
      baseMessage({
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [
            {
              id: 'call_1',
              tool: 'web_search',
              stage: 'result',
              status: 'success',
              createdAt: 1000,
              hits: [{ title: 't', url: 'https://example.com/a', snippet: 's' }],
              details: { engine: 'tavily' },
            },
          ],
          coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
        }),
      }),
    )

    expect(message.toolEvents?.[0].hits).toBeUndefined()
    expect(message.toolEvents?.[0].details).toMatchObject({ engine: 'tavily', hitsCount: 1 })
    expect(message.toolLogCoverage?.projection.status).toBe('partial')
    expect(message.toolLogCoverage?.projection.truncatedFields).toBeGreaterThan(0)
  })

  it('详情路径保留全部条目且投影为 complete', async () => {
    const deps = buildService({ realToolLogParser: true })
    deps.prisma.message.findFirst.mockResolvedValue(baseMessage({ toolLogsJson: envelopeJson }))
    deps.prisma.systemSetting.findUnique.mockResolvedValue({ value: null })

    const message = await deps.service.getMessageById({
      actor: deps.actor,
      sessionId: 5,
      messageId: 40,
      request: deps.request,
    })

    expect(message?.toolEvents?.[0].id).toBe('call_1')
    expect(message?.toolLogCoverage?.projection.status).toBe('complete')
    expect(message?.toolLogCoverage?.persisted.status).toBe('partial')
    expect(message?.stopReason).toBe('stop_tools')
  })

  it('无工具日志的消息不下发覆盖与终止字段', async () => {
    const message = await setupList(baseMessage({ toolLogsJson: null }))
    expect(message.toolEvents).toEqual([])
    expect(message.toolLogCoverage).toBeUndefined()
    expect(message.stopReason).toBeUndefined()
    expect(message.finalAnswerGenerated).toBeUndefined()
  })

  it('旧数组日志只声明 unknown 覆盖，不冒充完整', async () => {
    const message = await setupList(
      baseMessage({
        toolLogsJson: JSON.stringify([
          { id: 'call_1', tool: 'get_time_info', stage: 'result', createdAt: 1000 },
        ]),
      }),
    )
    expect(message.toolLogCoverage?.persisted.status).toBe('unknown')
    expect(message.toolLogCoverage?.trace.status).toBe('unknown')
    expect(message.stopReason).toBeUndefined()
  })
})

describe('ChatMessageQueryService 无工具记录时的运行结果', () => {
  it('空 entries 信封的终止字段照样透出，且不下发覆盖', async () => {
    const deps = buildService({ realToolLogParser: true })
    deps.prisma.message.count.mockResolvedValue(1)
    deps.prisma.messageGroup.findMany.mockResolvedValue([])
    deps.prisma.systemSetting.findUnique.mockResolvedValue({ value: null })
    deps.prisma.message.findMany.mockResolvedValue([
      {
        id: 41,
        sessionId: 5,
        messageGroupId: null,
        role: 'assistant',
        content: '未生成最终回答',
        parentMessageId: null,
        variantIndex: null,
        attachments: [],
        clientMessageId: 'c41',
        reasoning: null,
        reasoningDurationSeconds: null,
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [],
          coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
          runResult: { stopReason: 'budget_exhausted', finalAnswerGenerated: false },
        }),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        streamStatus: 'done',
        streamCursor: 6,
        streamReasoning: null,
        streamError: null,
        usageMetrics: [],
        generatedImages: [],
      },
    ])

    const result = await deps.service.listMessages({
      actor: deps.actor,
      sessionId: 5,
      page: 1,
      limit: 10,
      request: deps.request,
    })

    const message = result.messages[0]
    expect(message.toolEvents).toEqual([])
    expect(message.toolLogCoverage).toBeUndefined()
    expect(message.stopReason).toBe('budget_exhausted')
    expect(message.finalAnswerGenerated).toBe(false)
  })
})
