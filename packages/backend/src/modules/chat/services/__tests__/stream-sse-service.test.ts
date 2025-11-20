import { StreamSseService } from '../stream-sse-service'

describe('StreamSseService', () => {
  const encoder = new TextEncoder()

  it('enqueues and logs downstream closed state', () => {
    const logs: any[] = []
    const controller = { enqueue: jest.fn() } as any
    const service = new StreamSseService()
    const emitter = service.createEmitter({
      controller,
      encoder,
      requestSignal: { aborted: false } as any,
      traceRecorder: { log: (e: string, payload: any) => logs.push({ e, payload }) } as any,
      streamLogBase: () => ({ sessionId: 1 }),
    })

    const delivered = emitter.enqueue('data: {"type":"content"}\n\n')
    expect(delivered).toBe(true)
    expect(controller.enqueue).toHaveBeenCalled()
    emitter.markClosed('test')
    emitter.enqueue('data: {"type":"another"}\n\n')
    expect(logs.find((l) => l.e === 'stream:downstream_closed')).toBeDefined()
  })

  it('starts heartbeat and emits keepalive', async () => {
    jest.useFakeTimers()
    const controller = { enqueue: jest.fn() } as any
    const service = new StreamSseService()
    let lastKeepalive = 0
    const emitter = service.createEmitter({
      controller,
      encoder,
      requestSignal: { aborted: false } as any,
      traceRecorder: { log: jest.fn() } as any,
      streamLogBase: () => ({}),
    })
    const stop = service.startHeartbeat({
      emitter,
      heartbeatIntervalMs: 1000,
      providerInitialGraceMs: 0,
      providerReasoningIdleMs: 0,
      reasoningKeepaliveIntervalMs: 1000,
      streamKeepaliveIntervalMs: 0,
      traceIdleTimeoutMs: null,
      getTimestamps: () => ({
        firstChunkAt: Date.now() - 2000,
        lastChunkAt: Date.now() - 2000,
        lastKeepaliveSentAt: lastKeepalive,
        requestStartedAt: Date.now() - 3000,
      }),
      setLastKeepaliveSentAt: (ts) => {
        lastKeepalive = ts
      },
      flushReasoningDelta: async () => {},
      flushVisibleDelta: async () => {},
      emitReasoningKeepalive: jest.fn(),
      emitStreamKeepalive: jest.fn(),
    })
    await jest.advanceTimersByTimeAsync(1100)
    stop()
    expect(controller.enqueue).toHaveBeenCalled()
    jest.useRealTimers()
  })
})
