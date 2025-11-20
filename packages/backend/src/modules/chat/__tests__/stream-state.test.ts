import { MemoryStreamMetaStore } from '../../../services/chat/stream-meta-store'
import {
  setStreamMetaStore,
  registerStreamMeta,
  getStreamMetaByKey,
  buildPendingCancelKeyByClientId,
  hasPendingStreamCancelKey,
  registerPendingCancelMarker,
  clearPendingCancelMarkers,
} from '../stream-state'

describe('stream-state delegations', () => {
  test('delegates to injected store', () => {
    const store = new MemoryStreamMetaStore()
    setStreamMetaStore(store)
    const meta = registerStreamMeta({
      sessionId: 10,
      actorIdentifier: 'user:10',
      clientMessageId: 'c10',
    })
    expect(meta?.clientMessageId).toBe('c10')
    const key = store.buildAgentStreamKey(10, 'c10')
    expect(getStreamMetaByKey(key)?.clientMessageId).toBe('c10')
  })

  test('pending cancel markers propagate to store', () => {
    const store = new MemoryStreamMetaStore()
    setStreamMetaStore(store)
    registerPendingCancelMarker({ sessionId: 11, clientMessageId: 'c11' })
    const key = buildPendingCancelKeyByClientId(11, 'c11')
    expect(hasPendingStreamCancelKey(key)).toBe(true)
    clearPendingCancelMarkers({ sessionId: 11, clientMessageId: 'c11' })
    expect(hasPendingStreamCancelKey(key)).toBe(false)
  })
})
