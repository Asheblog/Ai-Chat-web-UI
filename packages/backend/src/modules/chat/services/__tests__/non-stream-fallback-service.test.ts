import { NonStreamFallbackService } from '../non-stream-fallback-service'

describe('NonStreamFallbackService', () => {
  it('returns null on non-ok response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('err', { status: 500 }))
    const service = new NonStreamFallbackService({ fetchImpl })
    const result = await service.execute({
      provider: 'openai',
      baseUrl: 'http://api',
      modelRawId: 'gpt',
      messagesPayload: [],
      requestData: { foo: 'bar' },
      authHeader: {},
      extraHeaders: {},
      timeoutMs: 1000,
    })
    expect(result).toBeNull()
  })

  it('returns text and reasoning when successful', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: 'hello', reasoning_content: 'think' } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
        { status: 200 },
      ),
    )
    const service = new NonStreamFallbackService({ fetchImpl, logger: { warn: jest.fn() } })
    const result = await service.execute({
      provider: 'openai',
      baseUrl: 'http://api',
      modelRawId: 'gpt',
      messagesPayload: [],
      requestData: { foo: 'bar' },
      authHeader: { Authorization: 'Bearer x' },
      extraHeaders: {},
      timeoutMs: 1000,
    })
    expect(fetchImpl).toHaveBeenCalled()
    expect(result?.text).toBe('hello')
    expect(result?.reasoning).toBe('think')
    expect(result?.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2 })
  })

  it('builds ollama body and strips parts arrays', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    const service = new NonStreamFallbackService({ fetchImpl })
    await service.execute({
      provider: 'ollama',
      baseUrl: 'http://ollama',
      modelRawId: 'llm',
      messagesPayload: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      requestData: {},
      authHeader: {},
      extraHeaders: {},
      timeoutMs: 1000,
    })
    const [, options] = fetchImpl.mock.calls[0]
    const parsed = JSON.parse(options?.body as string)
    expect(parsed.model).toBe('llm')
    expect(parsed.messages[0].content).toContain('hi')
  })
})
jest.mock('../../../../utils/providers', () => ({
  convertOpenAIReasoningPayload: jest.fn((body: any) => ({ ...body, converted: true })),
}))
