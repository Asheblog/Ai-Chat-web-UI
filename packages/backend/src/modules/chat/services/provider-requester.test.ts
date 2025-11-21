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
    const logger = { warn: jest.fn() }
    const requester = new ProviderRequester({ fetchImpl: fetchImpl as any, logger })
    const traceRecorder = { log: jest.fn() }
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
    return { requester, fetchImpl, traceRecorder, logger, context, request }
  }

  it('retries on 429 then succeeds', async () => {
    const { requester, fetchImpl, traceRecorder, context, request, logger } = build()
    fetchImpl
      .mockResolvedValueOnce(new Response('{}', { status: 429, statusText: 'too many' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200, statusText: 'ok' }))

    const onReady = jest.fn()
    const onClear = jest.fn()
    const promise = requester.requestWithBackoff({
      request,
      context,
      onControllerReady: onReady,
      onControllerClear: onClear,
      traceRecorder: traceRecorder as any,
      traceContext: { provider: context.provider },
    })
    await jest.runAllTimersAsync()
    const resp = await promise
    expect(resp.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(traceRecorder.log).toHaveBeenCalledWith(
      'http:provider_request',
      expect.objectContaining({ attempt: 1, provider: context.provider }),
    )
    expect(traceRecorder.log).toHaveBeenCalledWith(
      'http:provider_retry',
      expect.objectContaining({ attempt: 1, status: 429 }),
    )
    expect(logger.warn).toHaveBeenCalled()
    expect(onReady).toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })

  it('clears controller on error', async () => {
    const { requester, fetchImpl, context, request, traceRecorder } = build()
    fetchImpl.mockRejectedValueOnce(new Error('network'))
    const onReady = jest.fn()
    const onClear = jest.fn()
    await expect(
      requester.requestWithBackoff({
        request,
        context,
        onControllerReady: onReady,
        onControllerClear: onClear,
        traceRecorder: traceRecorder as any,
      }),
    ).rejects.toThrow('network')
    expect(onReady).toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })
})
