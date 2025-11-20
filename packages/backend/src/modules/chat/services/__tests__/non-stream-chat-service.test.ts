jest.mock('../../../../utils/providers', () => ({
  buildHeaders: jest.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer mocked',
  })),
  convertOpenAIReasoningPayload: (body: any) => body,
}))

import { ChatCompletionServiceError, NonStreamChatService } from '../non-stream-chat-service'
import type { PreparedChatRequest } from '../chat-request-builder'

const buildPrepared = (): PreparedChatRequest => ({
  promptTokens: 120,
  contextLimit: 4000,
  contextRemaining: 3880,
  appliedMaxTokens: 1500,
  contextEnabled: true,
  systemSettings: {},
  providerRequest: {
    providerLabel: 'openai',
    providerHost: 'api.example.com',
    url: 'https://api.example.com/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    authHeader: { Authorization: 'Bearer token' },
    extraHeaders: {},
    body: { model: 'gpt-4o-mini', stream: true },
    timeoutMs: 300000,
  },
  messagesPayload: [],
  baseRequestBody: { model: 'gpt-4o-mini', stream: true },
  reasoning: {
    enabled: true,
    effort: 'medium',
    ollamaThink: false,
  },
})

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

const now = () => new Date('2024-01-01T00:00:00.000Z')

const buildService = (overrides?: { prepared?: PreparedChatRequest; fetchOk?: boolean }) => {
  const prisma = {
    message: {
      create: jest.fn(),
    },
    chatSession: {
      count: jest.fn().mockResolvedValue(1),
    },
    usageMetric: {
      create: jest.fn(),
    },
  }
  prisma.message.create.mockResolvedValue({ id: 99 })

  const logTraffic = jest.fn(() => Promise.resolve())
  const fetchImpl = jest.fn()
  const prepared = overrides?.prepared ?? buildPrepared()
  const requestBuilder = {
    prepare: jest.fn().mockResolvedValue(prepared),
  }

  if (overrides?.fetchOk === false) {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'error',
      headers: new Headers(),
      json: jest.fn(),
    })
  } else {
    const headers = new Headers()
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'world' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    })
  }

  const service = new NonStreamChatService({
    prisma: prisma as any,
    logTraffic,
    fetchImpl,
    now,
    requestBuilder: requestBuilder as any,
  })

  return {
    prisma,
    service,
    fetchImpl,
    requestBuilder,
  }
}

describe('NonStreamChatService', () => {
  it('executes provider call and persists results', async () => {
    const { service, prisma, requestBuilder } = buildService()
    const result = await service.execute({
      session: baseSession as any,
      payload: basePayload,
      content: 'hello',
      images: [],
      quotaSnapshot: null,
    })

    expect(requestBuilder.prepare).toHaveBeenCalled()
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionId: 1, content: 'world' }),
      }),
    )
    expect(prisma.usageMetric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 1,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        }),
      }),
    )
    expect(result).toEqual({
      content: 'world',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        context_limit: 4000,
        context_remaining: 3880,
      },
      quotaSnapshot: null,
    })
  })

  it('throws ChatCompletionServiceError when provider response is not ok', async () => {
    const { service } = buildService({ fetchOk: false })
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
