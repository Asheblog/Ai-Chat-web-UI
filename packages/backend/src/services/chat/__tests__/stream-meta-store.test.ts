import { StreamMetaStore } from '../stream-meta-store'

describe('StreamMetaStore', () => {
  test('registers and retrieves stream meta by message id and client id', () => {
    const store = new StreamMetaStore()
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
    const store = new StreamMetaStore()
    const derived = store.deriveAssistantClientMessageId('client-x')
    expect(derived.endsWith(':assistant')).toBe(true)
    const ensured = store.ensureAssistantClientMessageId(null)
    expect(ensured).toMatch(/assistant:/)
    const resolved = store.resolveAssistantClientIdFromRequest('client-x')
    expect(resolved?.endsWith(':assistant')).toBe(true)
  })

  test('handles pending cancel markers', () => {
    const store = new StreamMetaStore()
    store.registerPendingCancelMarker({
      sessionId: 2,
      clientMessageId: 'x',
      messageId: 5,
    })
    expect(store.hasPendingStreamCancelKey(store.buildPendingCancelKeyByMessageId(2, 5))).toBe(true)
    store.clearPendingCancelMarkers({ sessionId: 2, messageId: 5, clientMessageId: 'x' })
    expect(store.hasPendingStreamCancelKey(store.buildPendingCancelKeyByMessageId(2, 5))).toBe(false)
  })
})
