import { Hono } from 'hono'
import { registerChatCompletionRoutes } from '../completion'
import type { NonStreamChatService } from '../../services/non-stream-chat-service'
import type { PrismaClient } from '@prisma/client'

jest.mock('../../services/message-service', () => ({
  createUserMessageWithQuota: jest.fn(async () => ({
    userMessage: { id: 1, content: 'hi' },
    quotaSnapshot: null,
    messageWasReused: false,
  })),
}))
jest.mock('../../../../utils/providers', () => ({
  convertOpenAIReasoningPayload: (payload: any) => payload,
}))
jest.mock('../../../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'USER',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    await next()
  },
}))

const mockPrisma = (session: any) => {
  return {
    chatSession: {
      findFirst: jest.fn().mockResolvedValue(session),
    },
  } as unknown as PrismaClient
}

describe('completion route factory', () => {
  it('uses injected services for completion', async () => {
    const nonStreamService: jest.Mocked<NonStreamChatService> = {
      execute: jest.fn().mockResolvedValue({
        content: 'ok',
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          context_limit: 100,
          context_remaining: 98,
        },
        quotaSnapshot: null,
      }),
    }

    const app = new Hono()
    registerChatCompletionRoutes(app, {
      prisma: mockPrisma({
        id: 9,
        connectionId: 1,
        connection: { id: 1, provider: 'openai', baseUrl: 'http://x', authType: 'none' },
        modelRawId: 'gpt-4o',
      }),
      nonStreamService,
      conversationCompressionService: {
        compressIfNeeded: jest.fn(),
      } as any,
    })

    const res = await app.request('http://localhost/completion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 9,
        content: 'hello',
      }),
    })

    expect(res.status).toBe(200)
    expect(nonStreamService.execute).toHaveBeenCalled()
  })
})
