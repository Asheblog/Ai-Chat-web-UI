jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'ADMIN',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    c.set('user', {
      id: 1,
      username: 'tester',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => next(),
}))
jest.mock('../../utils/providers', () => ({
  buildHeaders: jest.fn(async () => ({})),
  convertOpenAIReasoningPayload: (payload: any) => payload,
}))

import { createOpenAICompatApi } from '../openai-compatible'
import type { ModelResolverService } from '../../services/catalog/model-resolver-service'

const buildMockResolver = (): jest.Mocked<ModelResolverService> => ({
  resolveModelIdForUser: jest.fn(),
  resolveModelForRequest: jest.fn().mockImplementation(async () => ({
    rawModelId: 'gpt-4o',
    connection: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      authType: 'none',
      apiKey: '',
      headersJson: '',
    } as any,
  })),
})

describe('openai-compatible api', () => {
  it.each(['azure_openai', 'ollama'])('rejects retired %s for each generation API before fetching', async (provider) => {
    const resolver = buildMockResolver()
    resolver.resolveModelForRequest.mockResolvedValue({
      rawModelId: 'retired-model',
      connection: {
        provider,
        baseUrl: 'https://provider.example',
        authType: 'none',
        headersJson: '',
      },
    } as any)
    const fetchImpl = jest.fn()
    const app = createOpenAICompatApi({ modelResolverService: resolver, fetchImpl })
    for (const [route, body] of [
      ['/chat/completions', { messages: [{ role: 'user', content: 'hello' }] }],
      ['/responses', { input: 'hello' }],
      ['/embeddings', { input: 'hello' }],
    ] as const) {
      const response = await app.request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'retired-model', ...body }),
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses injected resolver and fetch for chat completions', async () => {
    const resolver = buildMockResolver()
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.example.com/v1/chat/completions')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ id: 'resp-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const app = createOpenAICompatApi({
      modelResolverService: resolver,
      fetchImpl,
    })

    const res = await app.request('http://localhost/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'demo-model',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(resolver.resolveModelForRequest).toHaveBeenCalledWith({
      actor: expect.objectContaining({ identifier: expect.any(String) }),
      userId: 1,
      modelId: 'demo-model',
    })
  })
})
