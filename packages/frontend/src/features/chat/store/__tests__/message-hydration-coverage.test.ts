import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession, Message, MessageBody, MessageMeta } from '@/types'
import { createChatStoreInstance } from '@/features/chat/store'
import { createChatStoreRuntime } from '@/features/chat/store/runtime'
import { messageKey } from '@/features/chat/store/utils'
import { persistCompletionSnapshot } from '@/features/chat/store/runtime/snapshot-store'
import type { ToolLogCoverage } from '@aichat/shared/tool-operations'
import * as chatApi from '@/features/chat/api'

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

// 覆盖信息是服务端产物：本文件用结构等价的 fixture 断言“逐层透传、缺失不臆造”，
// 不在此固化 shared 内部字段实现。
const coverageFixture = (overrides: Partial<ToolLogCoverage> = {}): ToolLogCoverage => ({
  trace: {
    status: 'complete',
    startedAt: Date.UTC(2026, 10, 14, 2, 0, 0),
    turnEndedAt: Date.UTC(2026, 10, 14, 2, 2, 0),
  },
  persisted: {
    status: 'partial',
    droppedRecords: 2,
    truncatedFields: 1,
    asOf: Date.UTC(2026, 10, 14, 2, 2, 0),
  },
  projection: { status: 'unknown' },
  ...overrides,
})

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

const baseMeta = (sessionId: number, messageId: number, extra: Partial<MessageMeta> = {}): MessageMeta => ({
  id: messageId,
  sessionId,
  role: 'assistant',
  stableKey: `assistant-${messageId}`,
  createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
  streamStatus: 'streaming',
  ...extra,
})

const baseBody = (messageId: number, extra: Partial<MessageBody> = {}): MessageBody => ({
  id: messageId,
  stableKey: `assistant-${messageId}`,
  content: '',
  reasoning: '',
  version: 0,
  reasoningVersion: 0,
  ...extra,
})

const seed = (
  store: ReturnType<typeof createChatStoreInstance>,
  sessionId: number,
  messageId: number,
  metaExtra: Partial<MessageMeta> = {},
  bodyExtra: Partial<MessageBody> = {},
) => {
  const session = createSession({ id: sessionId })
  store.setState({
    sessions: [session],
    currentSession: session,
    messageMetas: [baseMeta(sessionId, messageId, metaExtra)],
    messageBodies: { [messageKey(messageId)]: baseBody(messageId, bodyExtra) },
    messageRenderCache: {},
    isStreaming: true,
    activeStreamSessionId: sessionId,
  })
  return { key: messageKey(messageId) }
}

const progress = (partial: Record<string, any>): Message => ({
  role: 'assistant',
  createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
  streamStatus: 'streaming',
  ...partial,
} as unknown as Message)

describe('toolLogCoverage hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('hydrates coverage and tool events from history messages', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 201 })
    store.setState({ sessions: [session], currentSession: session })
    const coverage = coverageFixture()

    vi.mocked(chatApi.getMessages).mockResolvedValue({
      data: [
        {
          id: 11,
          sessionId: 201,
          role: 'assistant',
          content: '带覆盖信息的历史回答',
          createdAt: new Date(Date.UTC(2026, 1, 20, 0, 0, 11)).toISOString(),
          toolLogCoverage: coverage,
          toolEvents: [
            {
              id: 'call-11-1',
              tool: 'web_search',
              stage: 'result',
              status: 'success',
              createdAt: Date.now(),
            },
          ],
        },
      ],
      pagination: { page: 1, totalPages: 1, limit: 20, total: 1 },
    } as any)

    await store.getState().fetchMessages(201)

    const state = store.getState()
    const meta = state.messageMetas.find((item) => item.sessionId === 201)
    expect(meta?.toolLogCoverage).toEqual(coverage)
    const body = state.messageBodies[messageKey(11)]
    expect(body?.toolLogCoverage).toEqual(coverage)
    expect(body?.toolEvents).toHaveLength(1)
  })

  it('never marks legacy messages without coverage as complete', async () => {
    const store = createChatStoreInstance()
    const session = createSession({ id: 202 })
    store.setState({ sessions: [session], currentSession: session })

    vi.mocked(chatApi.getMessages).mockResolvedValue({
      data: [
        {
          id: 21,
          sessionId: 202,
          role: 'assistant',
          content: '旧消息',
          createdAt: new Date(Date.UTC(2026, 1, 20, 0, 0, 21)).toISOString(),
          toolEvents: [{ id: 'legacy-1', tool: 'web_search', stage: 'result', createdAt: Date.now() }],
        },
      ],
      pagination: { page: 1, totalPages: 1, limit: 20, total: 1 },
    } as any)

    await store.getState().fetchMessages(202)

    const state = store.getState()
    const meta = state.messageMetas.find((item) => item.sessionId === 202)
    expect(meta?.toolLogCoverage).toBeUndefined()
    const body = state.messageBodies[messageKey(21)]
    expect(body?.toolLogCoverage).toBeUndefined()
    expect(body?.toolEvents).toHaveLength(1)
  })

  it('applies a coverage-only progress update to body and meta', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const before = coverageFixture()
    const after = coverageFixture({
      persisted: { status: 'complete', asOf: Date.UTC(2026, 10, 14, 2, 5, 0) },
      projection: { status: 'complete' },
    })
    const { key } = seed(store, 203, 31, { toolLogCoverage: before }, { content: '同一段正文', toolLogCoverage: before })

    runtime.applyServerMessageSnapshot(
      progress({ id: 31, sessionId: 203, content: '同一段正文', toolLogCoverage: after }),
    )

    const state = store.getState()
    expect(state.messageBodies[key]?.toolLogCoverage).toEqual(after)
    const meta = state.messageMetas.find((item) => messageKey(item.id) === key)
    expect(meta?.toolLogCoverage).toEqual(after)
  })

  it('keeps known coverage when a progress snapshot omits it', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const coverage = coverageFixture()
    const { key } = seed(
      store,
      204,
      41,
      { toolLogCoverage: coverage },
      { content: '短', toolLogCoverage: coverage },
    )

    runtime.applyServerMessageSnapshot(progress({ id: 41, sessionId: 204, content: '短正文继续增长' }))

    const state = store.getState()
    expect(state.messageBodies[key]?.toolLogCoverage).toEqual(coverage)
    expect(state.messageMetas.find((item) => messageKey(item.id) === key)?.toolLogCoverage).toEqual(coverage)
    expect(state.messageBodies[key]?.content).toBe('短正文继续增长')
  })

  it('keeps server coverage when a local refresh snapshot has none', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const coverage = coverageFixture()
    const { key } = seed(store, 205, 51, { toolLogCoverage: coverage }, { toolLogCoverage: coverage })

    persistCompletionSnapshot({
      sessionId: 205,
      messageId: 51,
      clientMessageId: null,
      content: '刷新后补回的流式正文',
      reasoning: '',
      streamStatus: 'streaming',
      completedAt: Date.now(),
    })
    runtime.applyBufferedSnapshots(205)

    const state = store.getState()
    expect(state.messageBodies[key]?.content).toBe('刷新后补回的流式正文')
    expect(state.messageBodies[key]?.toolLogCoverage).toEqual(coverage)
    expect(state.messageMetas.find((item) => messageKey(item.id) === key)?.toolLogCoverage).toEqual(coverage)
  })

  it('does not promote unknown coverage when live tool events arrive', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const coverage = coverageFixture({ persisted: { status: 'unknown' }, projection: { status: 'partial' } })
    const { key } = seed(store, 206, 61, { toolLogCoverage: coverage }, { toolLogCoverage: coverage })

    runtime.applyServerMessageSnapshot(
      progress({
        id: 61,
        sessionId: 206,
        content: '',
        toolEvents: [
          { id: 'live-61-1', tool: 'python_run', stage: 'start', status: 'running', createdAt: Date.now() },
        ],
      }),
    )

    const state = store.getState()
    expect(state.messageBodies[key]?.toolEvents).toHaveLength(1)
    expect(state.messageBodies[key]?.toolLogCoverage).toEqual(coverage)
    expect(state.messageMetas.find((item) => messageKey(item.id) === key)?.toolLogCoverage).toEqual(coverage)
  })

  it('falls back to snapshot coverage only when the server payload had none', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const coverage = coverageFixture({ trace: { status: 'partial' } })
    const { key } = seed(store, 207, 71)

    persistCompletionSnapshot({
      sessionId: 207,
      messageId: 71,
      clientMessageId: null,
      content: '流式未完成正文',
      reasoning: '',
      streamStatus: 'streaming',
      toolLogCoverage: coverage,
      completedAt: Date.now(),
    })
    runtime.applyBufferedSnapshots(207)

    const state = store.getState()
    expect(state.messageBodies[key]?.toolLogCoverage).toEqual(coverage)
    expect(state.messageMetas.find((item) => messageKey(item.id) === key)?.toolLogCoverage).toEqual(coverage)
  })
})
