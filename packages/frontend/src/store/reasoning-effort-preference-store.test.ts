import { beforeEach, describe, expect, it } from 'vitest'
import { useReasoningEffortPreferenceStore as store } from './reasoning-effort-preference-store'

describe('思考强度偏好持久化', () => {
  beforeEach(() => { localStorage.clear(); store.getState().clear() })

  it.each(['max', 'unset'] as const)('刷新后从持久化存储恢复 %s', async (effort) => {
    store.getState().setLastSelection(effort)
    const saved = localStorage.getItem('reasoning-effort-preference')!
    store.setState({ lastSelection: null })
    localStorage.setItem('reasoning-effort-preference', saved)
    await store.persist.rehydrate()
    expect(store.getState().lastSelection).toBe(effort)
  })
})
