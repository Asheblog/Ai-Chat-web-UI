import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'
import { createChatStoreRuntime } from '@/features/chat/store/runtime'
import { messageKey } from '@/features/chat/store/utils'
import type { ChatSession, Message, MessageBody, MessageMeta } from '@/types'

vi.mock('@/features/chat/api', () => ({
  getMessageProgress: vi.fn(),
  getMessageByClientId: vi.fn(),
  getMessages: vi.fn(),
  getSessionArtifacts: vi.fn(),
}))

const buildSession = (id = 1): ChatSession =>
  ({
    id,
    title: `Session ${id}`,
    createdAt: new Date(Date.UTC(2026, 1, 20, 0, 0, id)).toISOString(),
    modelLabel: 'gpt-test',
    modelRawId: 'gpt-test',
    connectionId: 1,
  }) as ChatSession

const seedStreamingAssistant = (
  store: ReturnType<typeof createChatStoreInstance>,
  opts: {
    content: string
    reasoning: string
    version?: number
    reasoningVersion?: number
    withStaleRenderCache?: boolean
  },
) => {
  const session = buildSession(1)
  const meta: MessageMeta = {
    id: 42,
    sessionId: 1,
    role: 'assistant',
    stableKey: 'assistant-42',
    createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
    streamStatus: 'streaming',
    reasoningStatus: 'streaming',
  }
  const key = messageKey(42)
  const body: MessageBody = {
    id: 42,
    stableKey: 'assistant-42',
    content: opts.content,
    reasoning: opts.reasoning,
    reasoningPlayedLength: opts.reasoning.length,
    version: opts.version ?? 1,
    reasoningVersion: opts.reasoningVersion ?? 5,
  }
  store.setState({
    sessions: [session],
    currentSession: session,
    messageMetas: [meta],
    messageBodies: { [key]: body },
    messageRenderCache: opts.withStaleRenderCache
      ? {
          [key]: {
            contentHtml: `<p>${opts.content}</p>`,
            reasoningHtml: null,
            contentVersion: body.version,
            reasoningVersion: body.reasoningVersion,
            updatedAt: Date.now(),
            isStreaming: true,
          },
        }
      : {},
    isStreaming: true,
    activeStreamCount: 0,
    activeStreamSessionId: 1,
  })
  return key
}

const progressMessage = (partial: Partial<Message> & Pick<Message, 'content'>): Message =>
  ({
    id: 42,
    sessionId: 1,
    role: 'assistant',
    createdAt: new Date(Date.UTC(2026, 1, 20, 0, 1, 0)).toISOString(),
    streamStatus: 'streaming',
    streamReasoning: '完整推理过程继续增长中……',
    ...partial,
  }) as Message

describe('progress resume after refresh (COT → body)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('applies growing body content from progress snapshots after refresh', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const key = seedStreamingAssistant(store, {
      content: '',
      reasoning: '思考中……',
      version: 0,
      reasoningVersion: 3,
    })

    runtime.applyServerMessageSnapshot(
      progressMessage({
        content: '正文第一段',
        streamReasoning: '思考中……已完成推理',
      }),
    )
    expect(store.getState().messageBodies[key]?.content).toBe('正文第一段')

    runtime.applyServerMessageSnapshot(
      progressMessage({
        content: '正文第一段，并且继续输出更多内容',
        streamReasoning: '思考中……已完成推理',
      }),
    )
    expect(store.getState().messageBodies[key]?.content).toBe(
      '正文第一段，并且继续输出更多内容',
    )
  })

  it('invalidates stale markdown render cache when progress content grows while streaming', () => {
    const store = createChatStoreInstance()
    const runtime = createChatStoreRuntime(store.setState, store.getState)
    const key = seedStreamingAssistant(store, {
      content: '短正文',
      reasoning: 'COT 已接近结束',
      version: 2,
      reasoningVersion: 8,
      withStaleRenderCache: true,
    })

    expect(store.getState().messageRenderCache[key]?.contentHtml).toContain('短正文')

    runtime.applyServerMessageSnapshot(
      progressMessage({
        content: '短正文，后续又增长了一大段，用户刷新后应能继续看到',
        streamReasoning: 'COT 已接近结束',
      }),
    )

    // 与 live SSE flushStreamBuffer 对称：内容增长时必须丢掉旧 HTML，
    // 否则 MessageBubble 宽松缓存会继续展示截断正文。
    expect(store.getState().messageBodies[key]?.content).toContain('后续又增长')
    expect(store.getState().messageRenderCache[key]).toBeUndefined()
  })
})
