import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession, MessageMeta } from '@/types'
import { createChatStoreInstance } from '@/features/chat/store'
import { messageKey } from '@/features/chat/store/utils'
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
    mockSettingsState: { systemSettings: { chatMaxConcurrentStreams: 2, reasoningEnabled: true } },
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
  getUsage: vi.fn().mockResolvedValue({ data: { totals: null, last_round: null, current: null } }),
  getSessionsUsage: vi.fn().mockResolvedValue({ data: [] }),
  getMessageByClientId: vi.fn().mockResolvedValue({ data: null }),
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

const createSession = (): ChatSession =>
  ({
    id: 301,
    userId: 1,
    title: 'Mock Session',
    createdAt: new Date().toISOString(),
    connectionId: 1,
    modelLabel: 'gpt-mock',
    modelRawId: 'gpt-mock',
  }) as ChatSession

const createGate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

type StreamFactory = () => AsyncGenerator<any, void, unknown>

const gatedStream = (
  gate: Promise<void>,
  payload: { userMessageId: number; assistantMessageId: number; toolId: string; tool: string; content: string },
): StreamFactory =>
  async function* mockStream() {
    yield { type: 'start', messageId: payload.userMessageId, assistantMessageId: payload.assistantMessageId }
    yield { type: 'tool_call', id: payload.toolId, tool: payload.tool, stage: 'start', status: 'running' }
    yield { type: 'content', content: payload.content }
    await gate
    yield { type: 'complete' }
  }

describe('stopStreaming(target) stale-meta fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
  })

  it('cancels a refreshed stale streaming message and clears the streaming flag', () => {
    const store = createChatStoreInstance()
    const session = createSession()
    store.setState({
      sessions: [session],
      currentSession: session,
      messageMetas: [
        {
          id: 71,
          sessionId: session.id,
          role: 'assistant',
          stableKey: 'stale-71',
          createdAt: new Date(Date.UTC(2026, 10, 14, 2, 0, 0)).toISOString(),
          streamStatus: 'streaming',
        },
      ],
      messageBodies: {
        [messageKey(71)]: {
          id: 71,
          stableKey: 'stale-71',
          content: '刷新后仍在生成的历史消息',
          reasoning: '',
          version: 1,
          reasoningVersion: 0,
        },
      },
      isStreaming: true,
      activeStreamSessionId: session.id,
    })

    store.getState().stopStreaming({ sessionId: session.id, messageId: 71 })

    const state = store.getState()
    expect(state.messageMetas.find((meta) => meta.id === 71)?.streamStatus).toBe('cancelled')
    expect(state.isStreaming).toBe(false)
    expect(state.activeStreamSessionId).toBeNull()
    expect(vi.mocked(chatApi.cancelAgentStream)).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ messageId: 71 }),
    )
  })

  it('never cancels same-id stale messages from another session', () => {
    const store = createChatStoreInstance()
    const session = createSession()
    const createdAt = new Date(Date.UTC(2026, 10, 14, 2, 0, 0)).toISOString()
    store.setState({
      sessions: [session],
      currentSession: session,
      messageMetas: [
        {
          id: 91,
          sessionId: session.id,
          role: 'assistant',
          stableKey: 'session-301-91',
          createdAt,
          streamStatus: 'streaming',
        },
        {
          id: 91,
          sessionId: 402,
          role: 'assistant',
          stableKey: 'session-402-91',
          createdAt,
          streamStatus: 'streaming',
        },
      ],
      isStreaming: true,
      activeStreamSessionId: session.id,
    })

    store.getState().stopStreaming({ sessionId: session.id, messageId: 91 })

    const state = store.getState()
    expect(state.messageMetas.find((meta) => meta.sessionId === session.id)?.streamStatus).toBe(
      'cancelled',
    )
    expect(state.messageMetas.find((meta) => meta.sessionId === 402)?.streamStatus).toBe(
      'streaming',
    )
  })
})

describe('stopStreaming(target) isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
  })

  it('stops only the targeted run when two runs share a session', async () => {
    const store = createChatStoreInstance()
    const session = createSession()
    store.setState({ sessions: [session], currentSession: session })

    const gateA = createGate()
    const gateB = createGate()

    vi.mocked(chatApi.streamChat)
      .mockImplementationOnce(
        gatedStream(gateA.promise, { userMessageId: 3011, assistantMessageId: 3012, toolId: 'tool-A', tool: 'web_search', content: 'A 正在执行' }),
      )
      .mockImplementationOnce(
        gatedStream(gateB.promise, { userMessageId: 3021, assistantMessageId: 3022, toolId: 'tool-B', tool: 'python_run', content: 'B 正在执行' }),
      )

    const pendingA = store.getState().streamMessage(session.id, 'A')
    await flushMicrotasks()
    const pendingB = store.getState().streamMessage(session.id, 'B')
    await flushMicrotasks()

    expect(store.getState().activeStreamCount).toBe(2)
    expect(store.getState().toolEvents.map((event) => event.id)).toEqual(
      expect.arrayContaining(['tool-A', 'tool-B']),
    )

    store.getState().stopStreaming({ sessionId: session.id, messageId: 3022 })

    const stopped = store.getState()
    const metaA = stopped.messageMetas.find((meta) => meta.id === 3012)
    const metaB = stopped.messageMetas.find((meta) => meta.id === 3022)
    expect(metaB?.streamStatus).toBe('cancelled')
    expect(metaA?.streamStatus).toBe('streaming')
    expect(stopped.activeStreamCount).toBe(1)
    expect(stopped.isStreaming).toBe(true)
    expect(stopped.toolEvents.map((event) => event.id)).toEqual(['tool-A'])
    expect(vi.mocked(chatApi.cancelAgentStream)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatApi.cancelAgentStream)).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ messageId: 3022 }),
    )
    expect(vi.mocked(chatApi.cancelStream)).toHaveBeenCalledTimes(1)

    // 被停止的 run 结束收尾后，仍在运行的 A 保持 streaming 标记。
    gateB.release()
    await pendingB
    await flushMicrotasks()
    const afterB = store.getState()
    expect(afterB.messageMetas.find((meta) => meta.id === 3012)?.streamStatus).toBe('streaming')
    expect(afterB.activeStreamCount).toBe(1)
    expect(afterB.isStreaming).toBe(true)

    gateA.release()
    await pendingA
    await flushMicrotasks()
    const finished = store.getState()
    expect(finished.messageMetas.find((meta) => meta.id === 3012)?.streamStatus).toBe('done')
    expect(finished.activeStreamCount).toBe(0)
    expect(finished.isStreaming).toBe(false)
  })

  it('does not stop any run when the target does not exist', async () => {
    const store = createChatStoreInstance()
    const session = createSession()
    store.setState({ sessions: [session], currentSession: session })

    const gateA = createGate()
    vi.mocked(chatApi.streamChat).mockImplementationOnce(
      gatedStream(gateA.promise, { userMessageId: 3111, assistantMessageId: 3112, toolId: 'tool-A', tool: 'web_search', content: 'A 正在执行' }),
    )

    const pendingA = store.getState().streamMessage(session.id, 'A')
    await flushMicrotasks()

    const staleMeta: MessageMeta = {
      id: 999_999,
      sessionId: session.id,
      role: 'assistant',
      stableKey: 'stale-999999',
      createdAt: new Date().toISOString(),
      streamStatus: 'streaming',
    }
    store.setState((state) => ({ messageMetas: [...state.messageMetas, staleMeta] }))

    store.getState().stopStreaming({ sessionId: session.id, messageId: 555_555 })

    const state = store.getState()
    expect(vi.mocked(chatApi.cancelAgentStream)).not.toHaveBeenCalled()
    expect(vi.mocked(chatApi.cancelStream)).not.toHaveBeenCalled()
    expect(state.activeStreamCount).toBe(1)
    expect(state.messageMetas.find((meta) => meta.id === 3112)?.streamStatus).toBe('streaming')
    expect(state.messageMetas.find((meta) => meta.id === 999_999)?.streamStatus).toBe('streaming')
    expect(state.toolEvents.map((event) => event.id)).toEqual(['tool-A'])

    gateA.release()
    await pendingA
    await flushMicrotasks()
  })
})
