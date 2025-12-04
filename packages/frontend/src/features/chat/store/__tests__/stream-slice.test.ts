import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession } from '@/types'
import { createChatStoreInstance } from '@/features/chat/store'
import { messageKey } from '@/features/chat/store/utils'
import { apiClient } from '@/lib/api'

function createMockZustandStore<T extends Record<string, any>>(state: T) {
  let storeState = state
  const store = ((selector?: (slice: T) => any) =>
    selector ? selector(storeState) : storeState) as any
  store.getState = () => storeState
  store.setState = (partial: Partial<T> | ((current: T) => Partial<T>)) => {
    const next = typeof partial === 'function' ? partial(storeState) : partial
    storeState = { ...storeState, ...next }
  }
  store.subscribe = () => () => {}
  store.destroy = () => {}
  return store
}

const {
  mockSettingsState,
  mockAuthState,
  mockModelsState,
  mockPythonPreferenceState,
  mockWebPreferenceState,
} = vi.hoisted(() => ({
  mockSettingsState: {
    contextEnabled: true,
    systemSettings: {
      chatMaxConcurrentStreams: 2,
      reasoningEnabled: true,
    },
  },
  mockAuthState: {
    updateQuota: vi.fn(),
    actorState: 'authenticated' as const,
    user: { id: 1, role: 'ADMIN' },
  },
  mockModelsState: {
    models: [] as any[],
    isLoading: false,
    error: null,
    fetchAll: vi.fn(),
    setOne: vi.fn(),
  },
  mockPythonPreferenceState: {
    lastSelection: null as boolean | null,
    setLastSelection: vi.fn(),
    clear: vi.fn(),
  },
  mockWebPreferenceState: {
    lastSelection: true as boolean | null,
    setLastSelection: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  apiClient: {
    streamChat: vi.fn(),
    getUsage: vi.fn().mockResolvedValue({ data: { totals: null, last_round: null, current: null } }),
    getSessionsUsage: vi.fn().mockResolvedValue({ data: [] }),
    getMessageByClientId: vi.fn().mockResolvedValue({ data: null }),
    cancelAgentStream: vi.fn().mockResolvedValue(undefined),
    cancelStream: vi.fn(),
  },
}))

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: createMockZustandStore(mockSettingsState),
}))

vi.mock('@/store/auth-store', () => ({
  useAuthStore: createMockZustandStore(mockAuthState),
}))

vi.mock('@/store/models-store', () => ({
  useModelsStore: createMockZustandStore(mockModelsState),
}))

vi.mock('@/store/python-tool-preference-store', () => ({
  usePythonToolPreferenceStore: createMockZustandStore(mockPythonPreferenceState),
}))

vi.mock('@/store/web-search-preference-store', () => ({
  useWebSearchPreferenceStore: createMockZustandStore(mockWebPreferenceState),
}))

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const createSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
  ({
    id: 1,
    userId: 1,
    title: 'Mock Session',
    createdAt: new Date().toISOString(),
    connectionId: 1,
    modelLabel: 'gpt-mock',
    modelRawId: 'gpt-mock',
    ...overrides,
  }) as ChatSession

describe('stream slice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
  })

  it('streams and flushes assistant content on completion', async () => {
    const store = createChatStoreInstance()
    const session = createSession()
    store.setState({
      sessions: [session],
      currentSession: session,
    })

    vi.mocked(apiClient.streamChat).mockImplementation(async function* mockStream() {
      yield { type: 'start', messageId: session.id + 100, assistantMessageId: session.id + 200 }
      yield { type: 'content', content: 'Hello ' }
      yield { type: 'content', content: 'World' }
      yield { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
      yield { type: 'complete' }
    })

    await store.getState().streamMessage(session.id, 'Say hi')
    await flushMicrotasks()

    expect(apiClient.streamChat).toHaveBeenCalledTimes(1)
    expect(apiClient.getUsage).toHaveBeenCalledWith(session.id)
    expect(apiClient.getSessionsUsage).toHaveBeenCalledTimes(1)

    const state = store.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.activeStreamSessionId).toBeNull()
    const assistantMeta = state.messageMetas.find((meta) => meta.role === 'assistant')
    expect(assistantMeta).toBeTruthy()
    expect(assistantMeta?.streamStatus).toBe('done')
    expect(assistantMeta?.isPlaceholder).toBeFalsy()
    if (!assistantMeta) {
      throw new Error('assistant meta missing')
    }
    const assistantBodyKey = messageKey(assistantMeta.id)
    expect(state.messageBodies[assistantBodyKey]?.content).toBe('Hello World')
  })

  it('cancels active stream via stopStreaming and marks assistant message', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 42 })
    store.setState({
      sessions: [session],
      currentSession: session,
    })

    let abortReject: ((reason?: any) => void) | null = null
    let notifyReady: (() => void) | null = null
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve
    })

    const abortError = new Error('aborted')
    abortError.name = 'AbortError'

    vi.mocked(apiClient.streamChat).mockImplementation(async function* streamUntilAbort() {
      yield { type: 'start', messageId: 999, assistantMessageId: 1000 }
      yield { type: 'content', content: 'partial' }
      await new Promise((_resolve, reject) => {
        abortReject = reject
        notifyReady?.()
      })
    })

    vi.mocked(apiClient.cancelStream).mockImplementation(() => {
      abortReject?.(abortError)
    })

    const pending = store.getState().streamMessage(session.id, 'stop me')
    await ready
    store.getState().stopStreaming()
    await pending
    await flushMicrotasks()

    expect(apiClient.cancelAgentStream).toHaveBeenCalledTimes(1)
    expect(apiClient.cancelStream).toHaveBeenCalledTimes(1)
    const state = store.getState()
    expect(state.isStreaming).toBe(false)
    const assistantMeta = state.messageMetas.find((meta) => meta.role === 'assistant')
    expect(assistantMeta).toBeTruthy()
    if (!assistantMeta) {
      throw new Error('assistant meta missing')
    }
    expect(assistantMeta.streamStatus).toBe('cancelled')
    expect(state.error).toBeNull()
  })
})
