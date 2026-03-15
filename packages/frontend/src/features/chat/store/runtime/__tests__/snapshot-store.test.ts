import { beforeEach, describe, expect, it, vi } from 'vitest'

const STREAM_SNAPSHOT_STORAGE_KEY = 'aichat:stream-completions'

describe('snapshot-store merge behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps longer content when a terminal snapshot contains stale truncated content', async () => {
    const store = await import('../snapshot-store')
    const now = Date.now()

    store.persistCompletionSnapshot({
      sessionId: 1,
      messageId: 11,
      clientMessageId: 'c1',
      content: 'Hello World',
      reasoning: '',
      streamStatus: 'streaming',
      completedAt: now,
    })

    store.persistCompletionSnapshot({
      sessionId: 1,
      messageId: 11,
      clientMessageId: 'c1',
      content: 'Hello ',
      reasoning: '',
      streamStatus: 'done',
      completedAt: now + 1,
    })

    const snapshots = store.getSessionCompletionSnapshots(1)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.content).toBe('Hello World')

    const raw = window.localStorage.getItem(STREAM_SNAPSHOT_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw || '[]')
    expect(persisted[0]?.content).toBe('Hello World')
  })
})
