import { ChatCompletionServiceError, NonStreamChatService } from '../non-stream-chat-service'

const now = () => new Date('2024-01-01T00:00:00.000Z')

const buildService = () => {
  const prisma = {
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    chatSession: {
      count: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
    },
    usageMetric: {
      create: jest.fn(),
    },
  }
  prisma.message.create.mockResolvedValue({ id: 99 })

  const tokenizer = {
    truncateMessages: jest.fn(),
    countConversationTokens: jest.fn(),
  }

  const resolveContextLimit = jest.fn()
  const resolveCompletionLimit = jest.fn()
  const cleanupExpiredChatImages = jest.fn(() => Promise.resolve())
  const authUtils = { decryptApiKey: jest.fn(() => 'decrypted') }
  const logTraffic = jest.fn(() => Promise.resolve())

  const fetchImpl = jest.fn()

  const service = new NonStreamChatService({
    prisma: prisma as any,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    authUtils,
    logTraffic,
    fetchImpl,
    now,
  })

  return {
    prisma,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    authUtils,
    logTraffic,
    fetchImpl,
    service,
  }
}

const baseSession = {
  id: 1,
  connectionId: 10,
  modelRawId: 'gpt-4o-mini',
  reasoningEnabled: null,
  reasoningEffort: null,
  ollamaThink: null,
  connection: {
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    headersJson: null,
    authType: 'bearer',
    apiKey: 'secret',
    azureApiVersion: null,
  },
}

const basePayload = {
  sessionId: 1,
  content: 'hello',
  contextEnabled: true,
} as any

describe('NonStreamChatService', () => {
  it('executes provider call and persists results', async () => {
    const { service, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit, fetchImpl } =
      buildService()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.chatSession.count.mockResolvedValue(1)
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(120)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)
    const headers = new Headers()
    const mockJson = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'world' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      json: mockJson,
    })

    const result = await service.execute({
      session: baseSession as any,
      payload: basePayload,
      content: 'hello',
      images: [],
      quotaSnapshot: null,
    })

    expect(resolveContextLimit).toHaveBeenCalledWith({
      connectionId: 10,
      rawModelId: 'gpt-4o-mini',
      provider: 'openai',
    })
    expect(resolveCompletionLimit).toHaveBeenCalledWith({
      connectionId: 10,
      rawModelId: 'gpt-4o-mini',
      provider: 'openai',
    })
    expect(fetchImpl).toHaveBeenCalled()
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionId: 1, role: 'assistant', content: 'world' }),
      }),
    )
    expect(prisma.usageMetric.create).toHaveBeenCalled()
    expect(result.content).toBe('world')
    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      context_limit: 4000,
      context_remaining: 3880,
    })
  })

  it('throws ChatCompletionServiceError when provider response is not ok', async () => {
    const { service, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit, fetchImpl } =
      buildService()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.chatSession.count.mockResolvedValue(1)
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(50)
    resolveContextLimit.mockResolvedValue(2000)
    resolveCompletionLimit.mockResolvedValue(1000)
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers(),
      json: jest.fn(),
    })

    await expect(
      service.execute({
        session: baseSession as any,
        payload: basePayload,
        content: 'hello',
        images: [],
        quotaSnapshot: null,
      }),
    ).rejects.toThrow(ChatCompletionServiceError)
  })
})
