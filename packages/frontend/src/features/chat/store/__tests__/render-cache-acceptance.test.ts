import { describe, expect, it } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'

const body = { id: 1, stableKey: 'first', content: 'one two', reasoning: '', version: 2, reasoningVersion: 0 }
const rendered = { contentHtml: '<p>one</p>', contentVersion: 1, reasoningVersion: 0, isStreaming: true, sourceContent: 'one', sourceStableKey: 'first' }

describe('source-aware render cache', () => {
  it('accepts a completed append snapshot while newer content is queued', () => {
    const store = createChatStoreInstance()
    store.setState({ messageBodies: { '1': body }, messageRenderCache: {} })
    store.getState().applyRenderedContent(1, rendered)
    expect(store.getState().messageRenderCache['1']?.contentHtml).toBe('<p>one</p>')
    expect(store.getState().messageRenderCache['1']?.contentVersion).toBe(1)
  })
  it.each([
    { ...body, content: 'replacement' },
    { ...body, stableKey: 'reused' },
    { ...body, version: 0 },
  ])('rejects results from a replaced source', (replacement) => {
    const store = createChatStoreInstance()
    store.setState({ messageBodies: { '1': replacement }, messageRenderCache: {} })
    store.getState().applyRenderedContent(1, rendered)
    expect(store.getState().messageRenderCache['1']).toBeUndefined()
  })
  it('never overwrites a newer cached version', () => {
    const store = createChatStoreInstance()
    const current = { contentHtml: '<p>one two</p>', reasoningHtml: null, contentVersion: 2, reasoningVersion: 0, updatedAt: 1 }
    store.setState({ messageBodies: { '1': body }, messageRenderCache: { '1': current } })
    store.getState().applyRenderedContent(1, rendered)
    expect(store.getState().messageRenderCache['1']).toBe(current)
  })
})
