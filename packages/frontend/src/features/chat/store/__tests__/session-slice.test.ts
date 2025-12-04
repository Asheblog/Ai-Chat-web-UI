import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'
import type { ChatSession } from '@/types'
import { apiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  apiClient: {
    getSessions: vi.fn(),
    getSessionsUsage: vi.fn(),
    updateSession: vi.fn(),
  },
}))

const mockSessions = (count = 2): ChatSession[] =>
  Array.from({ length: count }).map((_, idx) => ({
    id: idx + 1,
    title: `Session ${idx + 1}`,
    createdAt: new Date().toISOString(),
    modelLabel: 'gpt-test',
    modelRawId: 'gpt-test',
    connectionId: 1,
  })) as ChatSession[]

describe('session slice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchSessions should load sessions list and stop loading flag', async () => {
    const store = createChatStoreInstance()
    const sessions = mockSessions()
    vi.mocked(apiClient.getSessions).mockResolvedValue({ data: sessions })
    vi.mocked(apiClient.getSessionsUsage).mockResolvedValue({ data: [] })

    await store.getState().fetchSessions()

    expect(apiClient.getSessions).toHaveBeenCalledTimes(1)
    expect(apiClient.getSessionsUsage).toHaveBeenCalledTimes(1)
    expect(store.getState().sessions).toEqual(sessions)
    expect(store.getState().isSessionsLoading).toBe(false)
    expect(store.getState().error).toBeNull()
  })

  it('updateSessionPrefs should persist and sync state', async () => {
    const store = createChatStoreInstance()
    const sessions = mockSessions()
    store.setState({
      sessions,
      currentSession: sessions[0],
    })
    vi.mocked(apiClient.updateSession).mockResolvedValue({ success: true })

    const result = await store.getState().updateSessionPrefs(sessions[0].id, {
      reasoningEnabled: false,
      reasoningEffort: 'low',
    })

    expect(result).toBe(true)
    const updated = store.getState().sessions[0]
    expect(updated.reasoningEnabled).toBe(false)
    expect(updated.reasoningEffort).toBe('low')
    expect(store.getState().currentSession?.reasoningEnabled).toBe(false)
  })
})
