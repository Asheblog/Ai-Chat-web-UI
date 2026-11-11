import { ProviderRequester } from '../../../agent-runtime/provider-requester'

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

  it('normalizes anthropic SSE into openai chunks', async () => {
    const { requester, fetchImpl, context, request } = build()
    ;(context as any).provider = 'anthropic'
    request.url = 'http://model/messages'
    request.body = { stream: true } as any
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":3,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      '',
    ].join('\n')
    fetchImpl.mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )

    const response = await requester.requestWithBackoff({ request, context })
    const text = await response.text()
    expect(text).toContain('"content":"hello"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text).toContain('"prompt_tokens":3')
    expect(text).toContain('data: [DONE]')
  })

  it('normalizes anthropic non-stream json', async () => {
    const { requester, fetchImpl, context, request } = build()
    ;(context as any).provider = 'anthropic'
    request.url = 'http://model/messages'
    request.body = { stream: false } as any
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          content: [{ type: 'text', text: 'hello' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const response = await requester.requestWithBackoff({ request, context })
    const json: any = await response.json()
    expect(json.choices[0].message.content).toBe('hello')
    expect(json.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })
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
