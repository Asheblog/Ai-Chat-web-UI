jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (_c: any, next: any) => next(),
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))
jest.mock('../../modules/chat/chat-common', () => ({ extendAnonymousSession: jest.fn() }))

import { createSharesApi } from '../shares'
import { createBattleApi } from '../battle'
import { chatSessionEventBus } from '../../modules/chat/services/chat-session-event-bus'

const decode = (value?: Uint8Array) => new TextDecoder().decode(value)
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
let sessionId = 8000

const setupChat = () => {
  const id = ++sessionId
  const service = {
    getShareByToken: jest.fn(async () => ({ isLive: true, sessionId: id, streamingMessageIds: [1] })),
    getMessageStreamStatuses: jest.fn(async () => [{ id: 1, streamStatus: 'streaming' }]),
    refreshLiveSharePayload: jest.fn(async () => {}),
  }
  const app = createSharesApi({ shareService: service as any })
  const publish = (type: 'content_delta' | 'message_complete' | 'stream_error') => {
    chatSessionEventBus.publish(id, { type, sessionId: id, messageId: 1, delta: 'later', ts: 1 })
  }
  return { id, service, app, publish }
}

describe('live share streams', () => {
  it('chat remains subscribed after ready and delivers later completion', async () => {
    const { app, id, publish } = setupChat()
    const response = await app.request('/token/stream')
    const reader = response.body!.getReader()
    expect(decode((await reader.read()).value)).toContain('share_ready')
    publish('content_delta')
    expect(decode((await reader.read()).value)).toContain('later')
    publish('message_complete')
    let remaining = ''
    for (;;) { const next = await reader.read(); if (next.done) break; remaining += decode(next.value) }
    expect(remaining).toContain('share_complete')
    expect(chatSessionEventBus.hasSubscribers(id)).toBe(false)
  })

  it.each(['message_complete', 'stream_error'] as const)('chat releases subscription on %s', async (type) => {
    const { app, id, publish } = setupChat()
    const response = await app.request('/token/stream')
    publish(type)
    await tick()
    await response.text()
    expect(chatSessionEventBus.hasSubscribers(id)).toBe(false)
  })

  it('chat cancels and unsubscribes during database initialization', async () => {
    const { app, id, service } = setupChat()
    let release!: (rows: { id: number; streamStatus: string }[]) => void
    service.getMessageStreamStatuses.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const response = await app.request('/token/stream')
    const cancellation = response.body!.cancel()
    await tick()
    expect(chatSessionEventBus.hasSubscribers(id)).toBe(false)
    release([{ id: 1, streamStatus: 'streaming' }])
    await cancellation
  })

  it('chat releases subscription if initialization fails', async () => {
    const { app, id, service } = setupChat()
    service.getMessageStreamStatuses.mockRejectedValue(new Error('database unavailable'))
    const response = await app.request('/token/stream')
    await response.text()
    expect(chatSessionEventBus.hasSubscribers(id)).toBe(false)
  })

  it.each(['run_complete', 'run_cancelled', 'error'])('battle stays open and releases subscription on %s', async (type) => {
    let listener!: (event: any) => void
    const unsubscribe = jest.fn()
    const service = {
      getShareByToken: jest.fn(async () => ({ battleRunId: 2, payload: { status: 'running' } })),
      subscribeRunEvents: jest.fn((_id, callback) => { listener = callback; return unsubscribe }),
    }
    const app = createBattleApi({ battleService: service as any })
    const response = await app.request('/shares/token/stream')
    const reader = response.body!.getReader()
    expect(decode((await reader.read()).value)).toContain('share_ready')
    listener({ type: 'attempt_delta', payload: { delta: 'later' } })
    expect(decode((await reader.read()).value)).toContain('later')
    listener({ type })
    for (;;) { if ((await reader.read()).done) break }
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('battle releases a subscription returned after a synchronous terminal event', async () => {
    const unsubscribe = jest.fn()
    const service = {
      getShareByToken: jest.fn(async () => ({ battleRunId: 2, payload: { status: 'running' } })),
      subscribeRunEvents: jest.fn((_id, callback) => {
        callback({ type: 'run_complete' })
        return unsubscribe
      }),
    }
    const app = createBattleApi({ battleService: service as any })
    const response = await app.request('/shares/token/stream')
    expect(await response.text()).toContain('share_complete')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each(['abort', 'cancel'])('battle releases a live subscription on %s', async (action) => {
    const unsubscribe = jest.fn()
    const controller = new AbortController()
    const service = {
      getShareByToken: jest.fn(async () => ({ battleRunId: 2, payload: { status: 'running' } })),
      subscribeRunEvents: jest.fn(() => unsubscribe),
    }
    const app = createBattleApi({ battleService: service as any })
    const response = await app.request('/shares/token/stream', { signal: controller.signal })
    if (action === 'abort') controller.abort()
    else await response.body!.cancel()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('battle execution continues after reader cancellation and records disconnect', async () => {
    let finish!: () => void
    const work = new Promise<void>((resolve) => { finish = resolve })
    const completed = jest.fn()
    const service = {
      executeRun: jest.fn(async (_actor, _payload, options) => {
        options.emitEvent({ type: 'run_start', payload: { id: 2 } })
        await work
        completed()
      }),
      logRunTrace: jest.fn(),
    }
    const app = createBattleApi({ battleService: service as any })
    const response = await app.request('/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'multi_model', prompt: { text: 'Q' }, expectedAnswer: { text: 'A' },
        judge: { modelId: 'judge' }, runsPerModel: 1, passK: 1, models: [{ modelId: 'model' }],
      }),
    })
    await response.body!.cancel()
    expect(service.logRunTrace).toHaveBeenCalledWith(2, 'battle:stream_aborted', expect.anything())
    expect(completed).not.toHaveBeenCalled()
    finish()
    await tick()
    expect(completed).toHaveBeenCalledTimes(1)
  })
})
