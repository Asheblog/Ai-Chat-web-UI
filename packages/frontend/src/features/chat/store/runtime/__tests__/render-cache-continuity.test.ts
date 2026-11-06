import { describe, expect, it } from 'vitest'
import { createStreamBufferRuntime } from '../stream-buffer'

describe('stream render cache continuity', () => {
  it('preserves the last rendered snapshot during append-only stream flushes', () => {
    const cache = { contentHtml: '<p>first</p>', reasoningHtml: null, contentVersion: 1, reasoningVersion: 0, updatedAt: 1 }
    let state: any = {
      messageMetas: [{ id: 1, stableKey: 'assistant-1', role: 'assistant' }],
      messageBodies: { '1': { id: 1, stableKey: 'assistant-1', content: 'first', reasoning: '', version: 1, reasoningVersion: 0 } },
      messageRenderCache: { '1': cache },
    }
    const runtime = createStreamBufferRuntime({
      set: ((update: any) => { state = { ...state, ...update(state) } }) as any,
      unregisterActiveStream: () => {}, persistSnapshotForStream: () => {},
    })
    runtime.flushStreamBuffer({ assistantId: 1, content: 'first', reasoning: '', pendingContent: ' second', pendingReasoning: '', pendingMeta: {} } as any)
    expect(state.messageBodies['1'].content).toBe('first second')
    expect(state.messageRenderCache['1']).toBe(cache)
  })
})
