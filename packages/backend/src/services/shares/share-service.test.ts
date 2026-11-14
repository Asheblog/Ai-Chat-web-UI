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
  it('rejects cancelled/expired deep-research messages from shares', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 21,
        sessionId: 11,
        role: 'assistant',
        content: '深度研究已取消',
        reasoning: null,
        streamStatus: 'cancelled',
        toolLogsJson: JSON.stringify([
          {
            id: 'plan-1',
            tool: 'research_plan',
            stage: 'error',
            status: 'rejected',
            phase: 'rejected',
            summary: '深度研究已取消',
            createdAt: Date.now(),
          },
        ]),
        createdAt: baseDate,
        attachments: [],
        generatedImages: [],
      },
    ])
    prisma.systemSetting.findUnique.mockResolvedValue(null)

    await expect(
      service.createShare(
        userActor,
        { sessionId: 11, messageIds: [21], expiresInHours: 24 },
        {},
      ),
    ).rejects.toMatchObject({ message: '已取消或已过期的深度研究消息不能分享' })
    expect(prisma.chatShare.create).not.toHaveBeenCalled()
  })

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
            details: {
              leadImageUrl: 'https://example.com/cover.png',
              images: [{ url: 'https://example.com/cover.png' }],
            },
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
      ]),
    )
    expect(persistedPayload?.messages?.[0]?.richPayload?.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'external' })]),
    )
    const persistedToolDetails = persistedPayload?.messages?.[0]?.toolEvents?.[0]?.details
    expect(persistedToolDetails?.images).toEqual([{ url: 'https://example.com/cover.png' }])
    // 分享面原样透传历史 tool details，不剥离旧字段；本用例只锁正向透传。
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

describe('ShareService tool log coverage', () => {
  const baseMessage = (overrides: Record<string, unknown> = {}) => ({
    id: 31,
    sessionId: 11,
    role: 'assistant',
    content: '分享正文',
    reasoning: null,
    streamStatus: 'done',
    toolLogsJson: null,
    createdAt: baseDate,
    attachments: [],
    generatedImages: [],
    ...overrides,
  })

  const mockCreate = (prisma: ReturnType<typeof createMockPrisma>) => {
    prisma.chatShare.create.mockResolvedValue({
      id: 101,
      sessionId: 11,
      token: 'token-share',
      title: 'Share',
      messageIdsJson: '[31]',
      payloadJson: '{}',
      createdByUserId: 1,
      createdByAnonymousKey: null,
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
    })
  }

  it('v2 信封里的 rejected 研究计划同样阻断分享', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    prisma.message.findMany.mockResolvedValue([
      baseMessage({
        id: 21,
        streamStatus: 'cancelled',
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [
            {
              id: 'plan-1',
              tool: 'research_plan',
              stage: 'error',
              status: 'rejected',
              createdAt: 1000,
            },
          ],
          coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
        }),
      }),
    ])

    await expect(
      service.createShare(userActor, { sessionId: 11, messageIds: [21], expiresInHours: 24 }, {}),
    ).rejects.toMatchObject({ message: '已取消或已过期的深度研究消息不能分享' })
    expect(prisma.chatShare.create).not.toHaveBeenCalled()
  })

  it('快照保留 rejected/aborted 语义，并透出覆盖与终止字段', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    mockCreate(prisma)
    prisma.message.findMany.mockResolvedValue([
      baseMessage({
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [
            {
              id: 'call_p',
              callId: 'call_p',
              tool: 'web_search',
              stage: 'error',
              status: 'aborted',
              phase: 'aborted',
              source: 'builtin',
              createdAt: 1000,
              endedAt: 1100,
              error: 'Request was cancelled',
              details: { parentCallId: 'root', fallbackUsed: 'search_snippet' },
            },
          ],
          coverage: {
            trace: { status: 'unknown' },
            persisted: { status: 'partial', asOf: 1100, droppedRecords: 2 },
            projection: { status: 'unknown' },
          },
          runResult: { stopReason: 'stop_tools', finalAnswerGenerated: false },
        }),
      }),
    ])

    const result = await service.createShare(
      userActor,
      { sessionId: 11, messageIds: [31], expiresInHours: 24 },
      {},
    )

    const snapshot = result.messages[0]
    expect(snapshot.toolEvents?.[0]).toMatchObject({
      id: 'call_p',
      callId: 'call_p',
      status: 'aborted',
      phase: 'aborted',
      source: 'builtin',
      error: 'Request was cancelled',
      details: { parentCallId: 'root', fallbackUsed: 'search_snippet' },
    })
    expect(snapshot.toolLogCoverage?.persisted).toMatchObject({
      status: 'partial',
      droppedRecords: 2,
    })
    expect(snapshot.toolLogCoverage?.trace.status).toBe('unknown')
    expect(snapshot.toolLogCoverage?.projection.status).toBe('complete')
    expect(snapshot.stopReason).toBe('stop_tools')
    expect(snapshot.finalAnswerGenerated).toBe(false)

    const persisted = JSON.parse(prisma.chatShare.create.mock.calls[0]?.[0]?.data?.payloadJson)
    expect(persisted.messages[0].stopReason).toBe('stop_tools')
    expect(persisted.messages[0].toolLogCoverage.persisted.status).toBe('partial')
  })

  it('旧数组日志只声明 unknown 覆盖，不下发终止字段', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    mockCreate(prisma)
    prisma.message.findMany.mockResolvedValue([
      baseMessage({
        toolLogsJson: JSON.stringify([
          { id: 'tool-1', tool: 'web_search', stage: 'result', createdAt: 1000 },
        ]),
      }),
    ])

    const result = await service.createShare(
      userActor,
      { sessionId: 11, messageIds: [31], expiresInHours: 24 },
      {},
    )

    const snapshot = result.messages[0]
    expect(snapshot.toolLogCoverage?.persisted.status).toBe('unknown')
    expect(snapshot.stopReason).toBeUndefined()
    expect(snapshot.finalAnswerGenerated).toBeUndefined()
    expect(snapshot.toolEvents?.[0].status).toBe('success')
  })
})

describe('ShareService 无工具记录时的运行结果', () => {
  it('空 entries 信封的终止字段进入分享快照', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    prisma.chatShare.create.mockResolvedValue({
      id: 102,
      sessionId: 11,
      token: 'token-empty',
      title: 'Share',
      messageIdsJson: '[32]',
      payloadJson: '{}',
      createdByUserId: 1,
      createdByAnonymousKey: null,
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
    })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 32,
        sessionId: 11,
        role: 'assistant',
        content: '工具被停止后的回答',
        reasoning: null,
        streamStatus: 'done',
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [],
          coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
          runResult: { stopReason: 'stop_tools', finalAnswerGenerated: true },
        }),
        createdAt: baseDate,
        attachments: [],
        generatedImages: [],
      },
    ])

    const result = await service.createShare(
      userActor,
      { sessionId: 11, messageIds: [32], expiresInHours: 24 },
      {},
    )

    const snapshot = result.messages[0]
    expect(snapshot.stopReason).toBe('stop_tools')
    expect(snapshot.finalAnswerGenerated).toBe(true)
    expect(snapshot.toolLogCoverage).toBeUndefined()
    expect(snapshot.toolEvents).toBeUndefined()
  })
})

describe('N1：share 投影不丢 hit 字段', () => {
  const hitFixture = {
    title: 'Result A',
    url: 'https://example.com/a',
    snippet: 'desc',
    engine: 'tavily',
    rank: 2,
    sourceEngines: ['tavily', 'brave'],
    mergeScore: 0.87,
    publishedDate: '2026-01-01',
    siteName: 'Example',
    authority: 3,
    query: 'safety engineer',
    queryLanguage: 'en',
  }

  it('分享快照与其持久化 payload 都保留 hit 的契约字段，且投影仍为 complete', async () => {
    const { service, prisma } = createService()
    prisma.chatSession.findFirst.mockResolvedValue({ id: 11, title: 'Chat A' })
    prisma.systemSetting.findUnique.mockResolvedValue(null)
    prisma.chatShare.create.mockResolvedValue({
      id: 103,
      sessionId: 11,
      token: 'token-hits',
      title: 'Share',
      messageIdsJson: '[33]',
      payloadJson: '{}',
      createdByUserId: 1,
      createdByAnonymousKey: null,
      createdAt: baseDate,
      expiresAt: null,
      revokedAt: null,
    })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 33,
        sessionId: 11,
        role: 'assistant',
        content: '带来源的回答',
        reasoning: null,
        streamStatus: 'done',
        toolLogsJson: JSON.stringify({
          v: 2,
          entries: [
            {
              id: 'call_1',
              tool: 'web_search',
              stage: 'result',
              status: 'success',
              createdAt: 1000,
              hits: [hitFixture],
              details: { engine: 'tavily' },
            },
          ],
          coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
        }),
        createdAt: baseDate,
        attachments: [],
        generatedImages: [],
      },
    ])

    const result = await service.createShare(
      userActor,
      { sessionId: 11, messageIds: [33], expiresInHours: 24 },
      {},
    )

    const snapshotHit = result.messages[0].toolEvents?.[0].hits?.[0] as unknown as Record<string, unknown>
    expect(snapshotHit).toMatchObject(hitFixture)
    expect(result.messages[0].toolLogCoverage?.projection.status).toBe('complete')

    const persisted = JSON.parse(prisma.chatShare.create.mock.calls[0]?.[0]?.data?.payloadJson)
    expect(persisted.messages[0].toolEvents[0].hits[0]).toMatchObject(hitFixture)
  })
})
