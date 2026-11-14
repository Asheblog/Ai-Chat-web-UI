import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession, Message, MessageBody, MessageMeta } from '@/types'
import { createChatStoreInstance } from '@/features/chat/store'
import { createChatStoreRuntime } from '@/features/chat/store/runtime'
import { messageKey } from '@/features/chat/store/utils'
import { persistCompletionSnapshot } from '@/features/chat/store/runtime/snapshot-store'
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

const seedStreamingAssistant = (
  store: ReturnType<typeof createChatStoreInstance>,
  opts: {
    sessionId: number
    messageId: number
    meta?: Partial<MessageMeta>
    body?: Partial<MessageBody>
  },
) => {
  const session = createSession({ id: opts.sessionId })
  const stableKey = `assistant-${opts.messageId}`
  const meta: MessageMeta = {
    id: opts.messageId,
    sessionId: opts.sessionId,
    role: 'assistant',
    stableKey,
    createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
    streamStatus: 'streaming',
    ...opts.meta,
  }
  const body: MessageBody = {
    id: opts.messageId,
    stableKey,
    content: '',
    reasoning: '',
    version: 0,
    reasoningVersion: 0,
    ...opts.body,
  }
  store.setState({
    sessions: [session],
    currentSession: session,
    messageMetas: [meta],
    messageBodies: { [messageKey(opts.messageId)]: body },
    messageRenderCache: {},
    isStreaming: true,
    activeStreamSessionId: opts.sessionId,
  })
  return { key: messageKey(opts.messageId), meta, body }
}

const progressMessage = (partial: Partial<Message> & Pick<Message, 'content' | 'sessionId' | 'id'>): Message =>
  ({
    role: 'assistant',
    createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
    streamStatus: 'streaming',
    ...partial,
  }) as Message

describe('terminal outcome hydration after refresh (snapshot / history / progress)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('restores terminal fields from the local snapshot after refresh', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const { key, meta, body } = seedStreamingAssistant(store, { sessionId: 103, messageId: 91 })

    persistCompletionSnapshot({
      sessionId: 103,
      messageId: 91,
      clientMessageId: null,
      content: '预算耗尽前的回答',
      reasoning: '',
      streamStatus: 'done',
      stopReason: 'budget_exhausted',
      finalAnswerGenerated: false,
      completedAt: Date.now(),
    })
    runtime.applyBufferedSnapshots(103)

    const state = store.getState()
    const nextMeta = state.messageMetas.find((item) => messageKey(item.id) === key)
    expect(nextMeta?.stopReason).toBe('budget_exhausted')
    expect(nextMeta?.finalAnswerGenerated).toBe(false)
    const nextBody = state.messageBodies[key]
    expect(nextBody?.stopReason).toBe('budget_exhausted')
    expect(nextBody?.finalAnswerGenerated).toBe(false)
    expect(nextBody?.content).toBe('预算耗尽前的回答')
    expect(meta.streamStatus).toBe('streaming')
    expect(body.content).toBe('')
  })

  it('hydrates terminal fields from history messages', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 104 })
    store.setState({ sessions: [session], currentSession: session })

    vi.mocked(chatApi.getMessages).mockResolvedValue({
      data: [
        {
          id: 61,
          sessionId: 104,
          role: 'assistant',
          content: '历史回答',
          createdAt: new Date(Date.UTC(2026, 1, 20, 0, 0, 61)).toISOString(),
          stopReason: 'budget_exhausted',
          finalAnswerGenerated: false,
        },
      ],
      pagination: { page: 1, totalPages: 1, limit: 20, total: 1 },
    } as any)

    await store.getState().fetchMessages(104)

    const state = store.getState()
    const meta = state.messageMetas.find((item) => item.sessionId === 104)
    expect(meta?.stopReason).toBe('budget_exhausted')
    expect(meta?.finalAnswerGenerated).toBe(false)
    const body = state.messageBodies[messageKey(61)]
    expect(body?.stopReason).toBe('budget_exhausted')
    expect(body?.finalAnswerGenerated).toBe(false)
  })

  it('keeps known terminal fields when a progress snapshot omits them', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const { key } = seedStreamingAssistant(store, {
      sessionId: 105,
      messageId: 92,
      meta: { stopReason: 'stop_tools', finalAnswerGenerated: false },
      body: { stopReason: 'stop_tools', finalAnswerGenerated: false, content: '短' },
    })

    runtime.applyServerMessageSnapshot(
      progressMessage({ id: 92, sessionId: 105, content: '短正文继续增长' }),
    )

    const state = store.getState()
    const meta = state.messageMetas.find((item) => messageKey(item.id) === key)
    expect(meta?.stopReason).toBe('stop_tools')
    expect(meta?.finalAnswerGenerated).toBe(false)
    expect(state.messageBodies[key]?.stopReason).toBe('stop_tools')
    expect(state.messageBodies[key]?.finalAnswerGenerated).toBe(false)
  })
})
