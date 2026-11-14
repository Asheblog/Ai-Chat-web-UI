import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession } from '@/types'
import { createChatStoreInstance } from '@/features/chat/store'
import { messageKey } from '@/features/chat/store/utils'
import { getSessionCompletionSnapshots } from '@/features/chat/store/runtime/snapshot-store'
import * as chatApi from '@/features/chat/api'

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

const { mockSettingsState, mockAuthState, mockModelsState, mockPythonPreferenceState, mockWebPreferenceState } =
  vi.hoisted(() => ({
    mockSettingsState: {
      systemSettings: { chatMaxConcurrentStreams: 2, reasoningEnabled: true },
    },
    mockAuthState: {
      updateQuota: vi.fn(),
      actorState: 'authenticated' as const,
      user: { id: 1, role: 'ADMIN', contextEnabled: false },
    },
    mockModelsState: { models: [] as any[], isLoading: false, error: null, fetchAll: vi.fn(), setOne: vi.fn() },
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

vi.mock('@/features/chat/api', () => ({
  streamChat: vi.fn(),
  getMessages: vi.fn(),
  getSessionArtifacts: vi.fn().mockResolvedValue([]),
  getUsage: vi.fn().mockResolvedValue({ data: { totals: null, last_round: null, current: null } }),
  getSessionsUsage: vi.fn().mockResolvedValue({ data: [] }),
  getMessageByClientId: vi.fn().mockResolvedValue({ data: null }),
  getMessageProgress: vi.fn(),
  updateUserMessage: vi.fn(),
  cancelAgentStream: vi.fn().mockResolvedValue(undefined),
  cancelStream: vi.fn(),
}))

vi.mock('@/store/settings-store', () => ({ useSettingsStore: createMockZustandStore(mockSettingsState) }))
vi.mock('@/store/auth-store', () => ({ useAuthStore: createMockZustandStore(mockAuthState) }))
vi.mock('@/store/models-store', () => ({ useModelsStore: createMockZustandStore(mockModelsState) }))
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

describe('terminal outcome hydration (live complete / local stop)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('carries complete stopReason/finalAnswerGenerated into meta, body and refresh snapshot', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 101 })
    store.setState({ sessions: [session], currentSession: session })

    vi.mocked(chatApi.streamChat).mockImplementation(async function* mockStream() {
      yield { type: 'start', messageId: 501, assistantMessageId: 502, assistantClientMessageId: 'assistant-502' }
      yield { type: 'content', content: '工具已执行完毕' }
      yield { type: 'complete', stopReason: 'stop_tools', finalAnswerGenerated: false }
    })

    await store.getState().streamMessage(session.id, '跑一下工具')
    await flushMicrotasks()

    const state = store.getState()
    const meta = state.messageMetas.find((item) => item.role === 'assistant')
    expect(meta?.streamStatus).toBe('done')
    expect(meta?.stopReason).toBe('stop_tools')
    expect(meta?.finalAnswerGenerated).toBe(false)
    const body = state.messageBodies[messageKey(meta!.id)]
    expect(body?.stopReason).toBe('stop_tools')
    expect(body?.finalAnswerGenerated).toBe(false)

    const snapshots = getSessionCompletionSnapshots(session.id)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({ stopReason: 'stop_tools', finalAnswerGenerated: false })
  })

  it('does not invent terminal fields when complete omits them', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 102 })
    store.setState({ sessions: [session], currentSession: session })

    vi.mocked(chatApi.streamChat).mockImplementation(async function* mockStream() {
      yield { type: 'start', messageId: 511, assistantMessageId: 512 }
      yield { type: 'content', content: '普通回答' }
      yield { type: 'complete' }
    })

    await store.getState().streamMessage(session.id, '普通提问')
    await flushMicrotasks()

    const state = store.getState()
    const meta = state.messageMetas.find((item) => item.role === 'assistant')
    expect(meta?.streamStatus).toBe('done')
    expect(meta?.stopReason).toBeUndefined()
    expect(meta?.finalAnswerGenerated).toBeUndefined()
    const body = state.messageBodies[messageKey(meta!.id)]
    expect(body?.stopReason).toBeUndefined()
    expect(body?.finalAnswerGenerated).toBeUndefined()
  })

  it('does not fabricate finalAnswerGenerated for a locally stopped stream', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 106 })
    store.setState({ sessions: [session], currentSession: session })

    let abortReject: ((reason?: any) => void) | null = null
    let notifyReady: (() => void) | null = null
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve
    })
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'

    vi.mocked(chatApi.streamChat).mockImplementation(async function* streamUntilAbort() {
      yield { type: 'start', messageId: 601, assistantMessageId: 602 }
      yield { type: 'content', content: '部分内容' }
      await new Promise((_resolve, reject) => {
        abortReject = reject
        notifyReady?.()
      })
    })
    vi.mocked(chatApi.cancelStream).mockImplementation(() => {
      abortReject?.(abortError)
    })

    const pending = store.getState().streamMessage(session.id, '停止我')
    await ready
    store.getState().stopStreaming()
    await pending
    await flushMicrotasks()

    const meta = store.getState().messageMetas.find((item) => item.role === 'assistant')
    expect(meta?.streamStatus).toBe('cancelled')
    expect(meta?.finalAnswerGenerated).toBeUndefined()
    expect(meta?.stopReason).toBeUndefined()
  })
})
