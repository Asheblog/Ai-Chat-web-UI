import { ConversationCompressionService } from "../conversation-compression-service"
import { Tokenizer } from "../../../../utils/tokenizer"

type MockPrisma = {
  systemSetting: {
    findMany: jest.Mock
  }
  message: {
    findMany: jest.Mock
    updateMany: jest.Mock
  }
  messageGroup: {
    create: jest.Mock
    updateMany: jest.Mock
    findFirst: jest.Mock
    update: jest.Mock
  }
  $transaction: jest.Mock
}

const buildMessages = (count: number) =>
  Array.from({ length: count }, (_, idx) => {
    const id = idx + 1
    return {
      id,
      role: id % 2 === 0 ? "assistant" : "user",
      content: `message-${id}`,
      createdAt: new Date(`2026-01-${String(Math.min(id, 28)).padStart(2, "0")}T00:00:00.000Z`),
    }
  })

const baseSession = {
  id: 12,
  connectionId: 99,
  modelRawId: "gpt-4o-mini",
  connection: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    authType: "bearer",
    apiKey: "encrypted",
    headersJson: "",
    azureApiVersion: null,
  },
}

const createHarness = () => {
  const prisma: MockPrisma = {
    systemSetting: {
      findMany: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    messageGroup: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  }

  prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) =>
    callback({
      message: {
        updateMany: prisma.message.updateMany,
      },
      messageGroup: {
        create: prisma.messageGroup.create,
        update: prisma.messageGroup.update,
      },
    }),
  )

  const resolveContextLimit = jest.fn().mockResolvedValue(1000)
  const authUtils = {
    decryptApiKey: jest.fn(() => "sk-test"),
  }
  const fetchFn = jest.fn()

  const service = new ConversationCompressionService({
    prisma: prisma as any,
    resolveContextLimit,
    authUtils,
    fetchFn,
  })

  return {
    prisma,
    resolveContextLimit,
    authUtils,
    fetchFn,
    service,
  }
}

describe("ConversationCompressionService", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("compresses old messages and stores a summary group", async () => {
    const { prisma, fetchFn, service } = createHarness()

    prisma.systemSetting.findMany.mockResolvedValue([
      { key: "context_compression_enabled", value: "true" },
      { key: "context_compression_threshold_ratio", value: "0.5" },
      { key: "context_compression_tail_messages", value: "4" },
      { key: "provider_timeout_ms", value: "120000" },
    ])
    prisma.message.findMany.mockResolvedValue(buildMessages(10))
    prisma.messageGroup.create.mockResolvedValue({ id: 88 })
    prisma.message.updateMany.mockResolvedValue({ count: 6 })
    fetchFn.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "用户需要持续推进重构并验证压缩上下文效果。" } }],
        }),
        { status: 200 },
      ),
    )

    const countSpy = jest.spyOn(Tokenizer, "countConversationTokens")
    countSpy
      .mockResolvedValueOnce(900)
      .mockResolvedValueOnce(600)
      .mockResolvedValueOnce(80)

    const truncateSpy = jest.spyOn(Tokenizer, "truncateMessages")
    truncateSpy.mockImplementation(async (messages: any[]) => messages)

    const result = await service.compressIfNeeded({
      session: baseSession as any,
      actorContent: "继续执行实施计划",
      protectedMessageId: 10,
      historyUpperBound: new Date("2026-01-10T00:00:00.000Z"),
    })

    expect(result.applied).toBe(true)
    expect(result.payload).toMatchObject({
      groupId: 88,
      compressedCount: 6,
      thresholdTokens: 500,
      beforeTokens: 900,
      afterTokens: 380,
      tailMessages: 4,
    })

    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [1, 2, 3, 4, 5, 6] },
        }),
      }),
    )

    const createPayload = prisma.messageGroup.create.mock.calls[0][0]
    expect(createPayload.data.summary).toContain("重构")
    expect(JSON.parse(createPayload.data.compressedMessagesJson)).toHaveLength(6)

    const metadata = JSON.parse(createPayload.data.metadataJson)
    expect(metadata).toMatchObject({
      source: "auto",
      thresholdRatio: 0.5,
      thresholdTokens: 500,
      beforeTokens: 900,
      tailMessages: 4,
      compressedCount: 6,
      contextLimit: 1000,
    })
  })

  it("skips compression when tokens are below threshold", async () => {
    const { prisma, service } = createHarness()

    prisma.systemSetting.findMany.mockResolvedValue([
      { key: "context_compression_enabled", value: "true" },
      { key: "context_compression_threshold_ratio", value: "0.5" },
      { key: "context_compression_tail_messages", value: "12" },
    ])
    prisma.message.findMany.mockResolvedValue(buildMessages(16))

    jest.spyOn(Tokenizer, "countConversationTokens").mockResolvedValue(320)

    const result = await service.compressIfNeeded({
      session: baseSession as any,
      actorContent: "短对话",
      protectedMessageId: 16,
      historyUpperBound: new Date("2026-01-16T00:00:00.000Z"),
    })

    expect(result).toEqual({ applied: false, reason: "below_threshold" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("updates expanded state for an existing group", async () => {
    const { prisma, service } = createHarness()
    prisma.messageGroup.updateMany.mockResolvedValue({ count: 1 })

    const updated = await service.updateGroupExpanded({
      sessionId: 12,
      groupId: 101,
      expanded: true,
    })

    expect(updated).toBe(true)
    expect(prisma.messageGroup.updateMany).toHaveBeenCalledWith({
      where: {
        id: 101,
        sessionId: 12,
        cancelledAt: null,
      },
      data: {
        expanded: true,
      },
    })
  })

  it("cancels compression group and restores grouped messages", async () => {
    const { prisma, service } = createHarness()

    prisma.messageGroup.findFirst.mockResolvedValue({ id: 7 })
    prisma.message.updateMany.mockResolvedValue({ count: 3 })
    prisma.messageGroup.update.mockResolvedValue({ id: 7 })

    const result = await service.cancelGroup({
      sessionId: 12,
      groupId: 7,
    })

    expect(result).toEqual({ cancelled: true, releasedCount: 3 })
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 12,
        messageGroupId: 7,
      },
      data: {
        messageGroupId: null,
      },
    })
    expect(prisma.messageGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
      }),
    )
  })
})
