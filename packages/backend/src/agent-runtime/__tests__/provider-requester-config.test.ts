import { ProviderRequester } from '../provider-requester'

describe('ProviderRequester retry configuration', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it.each([
    [429, 123],
    [503, 456],
  ])('uses the injected delay for HTTP %i', async (status, delay) => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response('ok'))
    const deps = {
      fetchImpl,
      logger: { warn: jest.fn() },
      retry: { upstream429Ms: 123, upstream5xxMs: 456 },
    }
    const requester = new ProviderRequester(deps)
    const pending = requester.requestWithBackoff({
      request: { url: 'https://provider.example/chat', headers: {}, body: {} },
      context: { sessionId: 1, provider: 'openai', route: '/test', timeoutMs: 30000 },
    })
    await jest.advanceTimersByTimeAsync(delay - 1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((await pending).status).toBe(200)
    expect(jest.getTimerCount()).toBe(0)
  })
})
