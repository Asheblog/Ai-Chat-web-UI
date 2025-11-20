jest.mock('../../../../utils/providers', () => ({
  buildHeaders: jest.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer mocked',
  })),
  convertOpenAIReasoningPayload: (body: any) => body,
}))

import { ChatRequestBuilder } from '../chat-request-builder'

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

const buildBuilder = () => {
  const prisma = {
    message: {
      findMany: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
    },
  }
  const tokenizer = {
    truncateMessages: jest.fn(),
    countConversationTokens: jest.fn(),
  }
  const resolveContextLimit = jest.fn()
  const resolveCompletionLimit = jest.fn()
  const cleanupExpiredChatImages = jest.fn(() => Promise.resolve())
  const authUtils = { decryptApiKey: jest.fn(() => 'decoded') }

  const builder = new ChatRequestBuilder({
    prisma: prisma as any,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    authUtils,
  })

  return {
    prisma,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    authUtils,
    builder,
  }
}

describe('ChatRequestBuilder', () => {
  it('builds stream request with web search prefix', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([
      { role: 'assistant', content: 'hi', createdAt: new Date('2024-01-01T00:00:00Z') },
    ])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '123000' },
      { key: 'reasoning_enabled', value: 'true' },
    ])
    tokenizer.truncateMessages.mockResolvedValue([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'hello' },
    ])
    tokenizer.countConversationTokens.mockResolvedValue(120)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: 'hello', features: { web_search: true } } as any,
      content: 'hello',
      images: [],
      mode: 'stream',
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionId: 1 }),
      }),
    )
    expect(prepared.promptTokens).toBe(120)
    expect(prepared.providerRequest.url).toContain('/chat/completions')
    expect(prepared.providerRequest.headers.Authorization).toBe('Bearer mocked')
    expect(prepared.messagesPayload[0].role).toBe('system')
    expect(prepared.baseRequestBody.stream).toBe(true)
    expect(prepared.reasoning.enabled).toBe(true)
  })

  it('applies history upper bound and completion mode for azure provider', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([
      { role: 'assistant', content: 'old', createdAt: new Date('2024-01-01T00:00:00Z') },
    ])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '600000' },
      { key: 'reasoning_enabled', value: 'false' },
      { key: 'ollama_think', value: 'true' },
    ])
    tokenizer.truncateMessages.mockResolvedValue([
      { role: 'assistant', content: 'old' },
      { role: 'user', content: 'replay' },
    ])
    tokenizer.countConversationTokens.mockResolvedValue(80)
    resolveContextLimit.mockResolvedValue(2000)
    resolveCompletionLimit.mockResolvedValue(500)

    const azureSession = {
      ...baseSession,
      connection: {
        ...baseSession.connection,
        provider: 'azure_openai',
        azureApiVersion: '2023-12-01',
      },
    }

    const upperBound = new Date('2024-01-01T00:00:00Z')
    const prepared = await builder.prepare({
      session: azureSession as any,
      payload: { sessionId: 1, content: 'replay', reasoningEnabled: false } as any,
      content: 'replay',
      images: [],
      mode: 'completion',
      historyUpperBound: upperBound,
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: upperBound },
        }),
      }),
    )
    expect(prepared.reasoning.enabled).toBe(false)
    expect(prepared.providerRequest.url).toContain('/openai/deployments/')
    expect(prepared.providerRequest.body.stream).toBe(false)
  })
})
