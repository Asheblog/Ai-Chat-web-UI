import { MemoryStreamMetaStore } from '../stream-meta-store'

describe('StreamMetaStore', () => {
  test('registers and retrieves stream meta by message id and client id', () => {
    const store = new MemoryStreamMetaStore()
    const meta = store.registerStreamMeta({
      sessionId: 1,
      actorIdentifier: 'user:1',
      clientMessageId: 'c1',
      assistantMessageId: 99,
    })
    expect(meta).toBeTruthy()
    expect(store.findStreamMetaByClientMessageId(1, 'c1')?.assistantMessageId).toBe(99)
    expect(store.findStreamMetaByMessageId(1, 99)?.clientMessageId).toBe('c1')
  })

  test('assigns assistant client id and resolves derived ids', () => {
    const store = new MemoryStreamMetaStore()
    const derived = store.deriveAssistantClientMessageId('client-x')
    expect(derived.endsWith(':assistant')).toBe(true)
    const ensured = store.ensureAssistantClientMessageId(null)
    expect(ensured).toMatch(/assistant:/)
    const resolved = store.resolveAssistantClientIdFromRequest('client-x')
    expect(resolved?.endsWith(':assistant')).toBe(true)
  })

  test('handles pending cancel markers', () => {
    const store = new MemoryStreamMetaStore()
    store.registerPendingCancelMarker({
      sessionId: 2,
      clientMessageId: 'x',
      messageId: 5,
    })
    expect(store.hasPendingStreamCancelKey(store.buildPendingCancelKeyByMessageId(2, 5))).toBe(true)
    store.clearPendingCancelMarkers({ sessionId: 2, messageId: 5, clientMessageId: 'x' })
    expect(store.hasPendingStreamCancelKey(store.buildPendingCancelKeyByMessageId(2, 5))).toBe(false)
  })

  test('enforces actor concurrency limit', () => {
    const store = new MemoryStreamMetaStore()
    const first = store.registerStreamMeta({
      sessionId: 1,
      actorIdentifier: 'actor-1',
      clientMessageId: 'alpha',
      assistantMessageId: 10,
      maxActorStreams: 1,
    })
    expect(first).toBeTruthy()
    const blocked = store.registerStreamMeta({
      sessionId: 1,
      actorIdentifier: 'actor-1',
      clientMessageId: 'beta',
      assistantMessageId: 11,
      maxActorStreams: 1,
    })
    expect(blocked).toBeNull()
    store.releaseStreamMeta(first)
    const allowed = store.registerStreamMeta({
      sessionId: 1,
      actorIdentifier: 'actor-1',
      clientMessageId: 'gamma',
      assistantMessageId: 12,
      maxActorStreams: 1,
    })
    expect(allowed).toBeTruthy()
  })

  test('accepts stop tools only for a live run on the owning actor', () => {
    const store = new MemoryStreamMetaStore()
    expect(store.requestStopTools(null)).toEqual({ accepted: false, reason: 'no_active_run' })

    const meta = store.registerStreamMeta({
      sessionId: 3,
      actorIdentifier: 'user:3',
      clientMessageId: 'stop-1',
      assistantMessageId: 30,
    })
    expect(meta).toBeTruthy()
    expect(store.shouldStopTools(meta)).toBe(false)

    expect(store.requestStopTools(meta)).toEqual({ accepted: true, reason: 'stop_tools' })
    expect(store.shouldStopTools(meta)).toBe(true)
    expect(store.requestStopTools(meta)).toEqual({ accepted: true, reason: 'already_requested' })
    expect(meta?.cancelled).toBe(false)
  })

  test('stop tools state dies with the run and never leaks into the next run', () => {
    const store = new MemoryStreamMetaStore()
    const first = store.registerStreamMeta({
      sessionId: 4,
      actorIdentifier: 'user:4',
      clientMessageId: 'stop-2',
      assistantMessageId: 40,
    })
    store.requestStopTools(first)
    store.releaseStreamMeta(first)

    expect(store.requestStopTools(first)).toEqual({ accepted: false, reason: 'no_active_run' })

    const next = store.registerStreamMeta({
      sessionId: 4,
      actorIdentifier: 'user:4',
      clientMessageId: 'stop-3',
      assistantMessageId: 41,
    })
    expect(store.shouldStopTools(next)).toBe(false)

    const unrelated = store.registerStreamMeta({
      sessionId: 5,
      actorIdentifier: 'user:5',
      clientMessageId: 'stop-4',
    })
    store.requestStopTools(next)
    expect(store.shouldStopTools(unrelated)).toBe(false)
  })
})
