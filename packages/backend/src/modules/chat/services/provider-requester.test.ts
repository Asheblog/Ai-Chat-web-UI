import { ProviderRequester } from './provider-requester'

describe('ProviderRequester', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(global, 'setTimeout')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const build = () => {
    const fetchImpl = jest.fn()
    const logTraffic = jest.fn(async () => {})
    const logger = { warn: jest.fn() }
    const requester = new ProviderRequester({ fetchImpl: fetchImpl as any, logTraffic, logger })
    const context = {
      sessionId: 1,
      provider: 'openai',
      route: '/api/chat/stream',
      timeoutMs: 1000,
    }
    const request = {
      url: 'http://model/chat',
      headers: { Authorization: 'Bearer X' },
      body: { a: 1 },
    }
    return { requester, fetchImpl, logTraffic, logger, context, request }
  }

  it('retries on 429 then succeeds', async () => {
    const { requester, fetchImpl, logTraffic, context, request, logger } = build()
    fetchImpl
      .mockResolvedValueOnce(new Response('{}', { status: 429, statusText: 'too many' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200, statusText: 'ok' }))

    const onReady = jest.fn()
    const onClear = jest.fn()
    const promise = requester.requestWithBackoff({ request, context, onControllerReady: onReady, onControllerClear: onClear })
    await jest.runAllTimersAsync()
    const resp = await promise
    expect(resp.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logTraffic).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
    expect(onReady).toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })

  it('clears controller on error', async () => {
    const { requester, fetchImpl, context, request } = build()
    fetchImpl.mockRejectedValueOnce(new Error('network'))
    const onReady = jest.fn()
    const onClear = jest.fn()
    await expect(
      requester.requestWithBackoff({ request, context, onControllerReady: onReady, onControllerClear: onClear }),
    ).rejects.toThrow('network')
    expect(onReady).toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })
})
