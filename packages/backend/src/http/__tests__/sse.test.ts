import { createSseResponse, type SseStreamContext } from '../sse'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SSE lifecycle', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })

  it('finishes finite work with one terminal marker', async () => {
    const response = createSseResponse((ctx) => { ctx.send({ type: 'complete' }); ctx.close() })
    expect(await response.text()).toBe('data: {"type":"complete"}\n\ndata: [DONE]\n\n')
  })

  it('cancels immediately and clears heartbeat while background work continues', async () => {
    jest.useFakeTimers()
    const work = deferred()
    const finished = jest.fn()
    const onAbort = jest.fn()
    let context!: SseStreamContext
    const response = createSseResponse(async (ctx) => {
      context = ctx
      ctx.startHeartbeat(100)
      await work.promise
      ctx.send({ type: 'late' })
      finished()
    }, { onAbort })
    const cancelled = response.body!.cancel()
    await Promise.resolve()
    expect(context.isClosed()).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(finished).not.toHaveBeenCalled()
    work.resolve()
    await cancelled
    await Promise.resolve()
    context.startHeartbeat(100)
    expect(jest.getTimerCount()).toBe(0)
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('does not start work for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = jest.fn()
    const onAbort = jest.fn()
    const response = createSseResponse(run, { signal: controller.signal, onAbort })
    expect(await response.text()).toBe('')
    expect(run).not.toHaveBeenCalled()
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('closes and stops heartbeat on abort before the producer settles', async () => {
    jest.useFakeTimers()
    const work = deferred()
    const controller = new AbortController()
    let context!: SseStreamContext
    const response = createSseResponse(async (ctx) => {
      context = ctx
      ctx.startHeartbeat(100)
      await work.promise
    }, { signal: controller.signal })
    controller.abort()
    expect(context.isClosed()).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
    work.resolve()
    expect(await response.text()).toBe('')
  })

  it('runs all cleanups once, including registrations after close', async () => {
    const cleanup = jest.fn()
    const lateCleanup = jest.fn()
    const onAbort = jest.fn()
    const controller = new AbortController()
    const response = createSseResponse(async (ctx) => {
      ctx.onClose(() => { throw new Error('cleanup failed') })
      ctx.onClose(cleanup)
      ctx.onClose(cleanup)
      ctx.close()
      ctx.close()
      ctx.onClose(lateCleanup)
      await ctx.closed
    }, { signal: controller.signal, onAbort })
    expect(await response.text()).toBe('data: [DONE]\n\n')
    controller.abort()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(lateCleanup).toHaveBeenCalledTimes(1)
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('releases heartbeat and subscriptions even if the error handler throws', async () => {
    jest.useFakeTimers()
    const cleanup = jest.fn()
    const onError = jest.fn(() => { throw new Error('handler failed') })
    const failure = new Error('producer failed')
    const response = createSseResponse((ctx) => {
      ctx.startHeartbeat(100)
      ctx.onClose(cleanup)
      throw failure
    }, { onError })
    await response.text()
    expect(onError).toHaveBeenCalledWith(failure, expect.anything())
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('treats enqueue failure as a disconnect and cannot restart heartbeat', async () => {
    jest.useFakeTimers()
    const cleanup = jest.fn()
    const onAbort = jest.fn()
    jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue').mockImplementationOnce(() => {
      throw new Error('downstream closed')
    })
    const response = createSseResponse(async (ctx) => {
      ctx.startHeartbeat(100)
      ctx.onClose(cleanup)
      expect(ctx.send({ type: 'update' })).toBe(false)
      ctx.startHeartbeat(100)
      await ctx.closed
    }, { onAbort })
    expect(await response.text()).toBe('')
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
