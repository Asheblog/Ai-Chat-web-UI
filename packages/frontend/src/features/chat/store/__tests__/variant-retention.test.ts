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

const {
  mockSettingsState,
  mockAuthState,
  mockModelsState,
  mockPythonPreferenceState,
  mockWebPreferenceState,
} = vi.hoisted(() => ({
  mockSettingsState: {
    systemSettings: {
      chatMaxConcurrentStreams: 2,
      reasoningEnabled: true,
    },
  },
  mockAuthState: {
    updateQuota: vi.fn(),
    actorState: 'authenticated' as const,
    user: { id: 1, role: 'ADMIN', contextEnabled: false },
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

vi.mock('@/features/chat/api', () => ({
  streamChat: vi.fn(),
  getUsage: vi.fn().mockResolvedValue({ data: { totals: null, last_round: null, current: null } }),
  getSessionsUsage: vi.fn().mockResolvedValue({ data: [] }),
  getMessageByClientId: vi.fn().mockResolvedValue({ data: null }),
  cancelAgentStream: vi.fn().mockResolvedValue(undefined),
  cancelStream: vi.fn(),
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

const userMeta = (sessionId: number, id: number): MessageMeta => ({
  id,
  sessionId,
  stableKey: `msg:${id}`,
  role: 'user',
  createdAt: new Date(2026, 0, 1).toISOString(),
})

const assistantVariant = (
  sessionId: number,
  id: number,
  parentId: number,
  variantIndex: number,
): MessageMeta => ({
  id,
  sessionId,
  stableKey: `msg:${id}`,
  role: 'assistant',
  parentMessageId: parentId,
  variantIndex,
  createdAt: new Date(2026, 0, 1 + variantIndex).toISOString(),
  streamStatus: 'done',
})

describe('回答版本全部保留（前端）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.systemSettings.chatMaxConcurrentStreams = 2
  })

  it('重新生成第 7 个版本时保留全部历史版本，并把选择指向新版本', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 7 })
    const parentId = 70
    const existingVariants = [1, 2, 3, 4, 5, 6].map((index) =>
      assistantVariant(session.id, 700 + index, parentId, index),
    )

    store.setState({
      sessions: [session],
      currentSession: session,
      messageMetas: [userMeta(session.id, parentId), ...existingVariants],
      messageBodies: {},
      messageRenderCache: {},
    })

    vi.mocked(chatApi.streamChat).mockImplementation(async function* mockStream() {
      yield {
        type: 'start',
        messageId: parentId,
        assistantMessageId: 999,
        assistantClientMessageId: 'assistant-client-7',
      }
      yield { type: 'content', content: '第 7 个版本' }
      yield { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }
      yield { type: 'complete' }
    })

    await store.getState().streamMessage(session.id, '', undefined, { replyToMessageId: parentId })
    await flushMicrotasks()

    const state = store.getState()
    const variants = state.messageMetas.filter(
      (meta) => meta.role === 'assistant' && meta.parentMessageId === parentId,
    )

    // 旧实现在超过 5 个版本时会本地删掉最旧版本及其正文/渲染缓存
    expect(variants).toHaveLength(7)
    for (const meta of existingVariants) {
      expect(state.messageMetas.some((candidate) => messageKey(candidate.id) === messageKey(meta.id))).toBe(true)
    }
    expect(variants.map((meta) => messageKey(meta.id))).toContain('999')
    expect(state.assistantVariantSelections[messageKey(parentId)]).toBe(999)
    expect(state.error).toBeNull()
  })
})
