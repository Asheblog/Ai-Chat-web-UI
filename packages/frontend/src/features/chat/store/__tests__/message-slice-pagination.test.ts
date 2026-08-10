import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'
import * as chatApi from '@/features/chat/api'
import { messageKey } from '@/features/chat/store/utils'
import type { ChatSession, Message } from '@/types'

vi.mock('@/features/chat/api', () => ({
  getMessageByClientId: vi.fn(),
  getMessages: vi.fn(),
  getSessionArtifacts: vi.fn(),
  updateUserMessage: vi.fn(),
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

const buildMessages = (start: number, end: number, sessionId = 1): Message[] =>
  Array.from({ length: end - start + 1 }).map((_, idx) => {
    const id = start + idx
    return {
      id,
      sessionId,
      role: id % 2 === 0 ? 'assistant' : 'user',
      content: `message-${id}`,
      createdAt: new Date(Date.UTC(2026, 1, 20, 0, 0, id)).toISOString(),
    } as Message
  })

describe('message slice pagination', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(chatApi.getSessionArtifacts).mockResolvedValue([])
    vi.mocked(chatApi.getMessageByClientId).mockResolvedValue({ data: null } as any)
  })

  it('fetchMessages should default to latest page and mark hasOlder', async () => {
    const store = createChatStoreInstance()
    const session = buildSession(1)
    store.setState({
      sessions: [session],
      currentSession: session,
    })

    vi.mocked(chatApi.getMessages).mockResolvedValue({
      data: buildMessages(51, 100),
      pagination: {
        page: 2,
        totalPages: 2,
        limit: 50,
        total: 100,
      },
    } as any)

    await store.getState().fetchMessages(1)

    expect(chatApi.getMessages).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatApi.getMessages).mock.calls[0]?.[2]).toEqual({
      page: 'latest',
      limit: 20,
    })
    expect(store.getState().messageMetas.filter((meta) => meta.sessionId === 1)).toHaveLength(50)
    expect(store.getState().messagePaginationBySession[1]).toMatchObject({
      oldestLoadedPage: 2,
      newestLoadedPage: 2,
      totalPages: 2,
      hasOlder: true,
      isLoadingOlder: false,
    })
  })

  it('loadOlderMessages should prepend previous page and update pagination', async () => {
    const store = createChatStoreInstance()
    const session = buildSession(1)
    store.setState({
      sessions: [session],
      currentSession: session,
    })

    vi.mocked(chatApi.getMessages)
      .mockResolvedValueOnce({
        data: buildMessages(51, 100),
        pagination: {
          page: 2,
          totalPages: 2,
          limit: 50,
          total: 100,
        },
      } as any)
      .mockResolvedValueOnce({
        data: buildMessages(1, 50),
        pagination: {
          page: 1,
          totalPages: 2,
          limit: 50,
          total: 100,
        },
      } as any)

    await store.getState().fetchMessages(1)
    await store.getState().loadOlderMessages(1)

    expect(chatApi.getMessages).toHaveBeenCalledTimes(2)
    expect(vi.mocked(chatApi.getMessages).mock.calls[1]?.[2]).toEqual({
      page: 1,
      limit: 50,
    })

    const sessionMetas = store.getState().messageMetas.filter((meta) => meta.sessionId === 1)
    expect(sessionMetas).toHaveLength(100)
    expect(sessionMetas[0]?.id).toBe(1)
    expect(sessionMetas[99]?.id).toBe(100)
    expect(store.getState().messagePaginationBySession[1]).toMatchObject({
      oldestLoadedPage: 1,
      newestLoadedPage: 2,
      totalPages: 2,
      hasOlder: false,
      isLoadingOlder: false,
    })
  })

  it('editLastUserMessage should resolve placeholder id by clientMessageId before resend', async () => {
    const store = createChatStoreInstance()
    const session = buildSession(9)
    const clientMessageId = 'client-stop-before-start'
    const placeholderId = 1714000000000
    const realMessageId = 42
    const assistantId = placeholderId + 1
    const createdAt = new Date(Date.UTC(2026, 1, 20, 0, 0, 1)).toISOString()
    const resend = vi.fn().mockResolvedValue(undefined)
    store.setState({
      sessions: [session],
      currentSession: session,
      streamMessage: resend,
      messageMetas: [
        {
          id: placeholderId,
          sessionId: session.id,
          role: 'user',
          createdAt,
          clientMessageId,
          stableKey: `client:${clientMessageId}`,
        },
        {
          id: assistantId,
          sessionId: session.id,
          role: 'assistant',
          createdAt,
          parentMessageId: placeholderId,
          stableKey: 'assistant-local',
          streamStatus: 'cancelled',
        },
      ],
      messageBodies: {
        [messageKey(placeholderId)]: {
          id: placeholderId,
          stableKey: `client:${clientMessageId}`,
          content: 'old question',
          reasoning: '',
          version: 1,
          reasoningVersion: 0,
        },
        [messageKey(assistantId)]: {
          id: assistantId,
          stableKey: 'assistant-local',
          content: 'partial answer',
          reasoning: '',
          version: 1,
          reasoningVersion: 0,
        },
      },
      messageRenderCache: {
        [messageKey(placeholderId)]: {
          contentHtml: '<p>old question</p>',
          reasoningHtml: null,
          contentVersion: 1,
          reasoningVersion: 0,
          updatedAt: Date.now(),
        },
      },
    } as any)

    const notFoundError: any = new Error('Request failed with status code 404')
    notFoundError.response = {
      status: 404,
      data: { success: false, error: 'Message not found' },
    }
    vi.mocked(chatApi.updateUserMessage)
      .mockRejectedValueOnce(notFoundError)
      .mockResolvedValueOnce({
        success: true,
        data: { messageId: realMessageId, deletedAssistantMessageIds: [assistantId] },
      } as any)
    vi.mocked(chatApi.getMessageByClientId).mockResolvedValue({
      success: true,
      data: {
        message: {
          id: realMessageId,
          sessionId: session.id,
          role: 'user',
          content: 'old question',
          createdAt,
          clientMessageId,
        },
      },
    } as any)

    const ok = await store
      .getState()
      .editLastUserMessage(session.id, placeholderId, 'updated question')

    expect(ok).toBe(true)
    expect(chatApi.updateUserMessage).toHaveBeenNthCalledWith(
      1,
      session.id,
      placeholderId,
      'updated question',
    )
    expect(chatApi.getMessageByClientId).toHaveBeenCalledWith(session.id, clientMessageId)
    expect(chatApi.updateUserMessage).toHaveBeenNthCalledWith(
      2,
      session.id,
      realMessageId,
      'updated question',
    )
    expect(resend).toHaveBeenCalledWith(
      session.id,
      '',
      undefined,
      expect.objectContaining({
        replyToMessageId: realMessageId,
        replyToClientMessageId: clientMessageId,
      }),
    )

    const state = store.getState()
    expect(state.messageMetas.find((item) => messageKey(item.id) === messageKey(placeholderId))).toBeUndefined()
    expect(state.messageMetas.find((item) => messageKey(item.id) === messageKey(assistantId))).toBeUndefined()
    expect(state.messageBodies[messageKey(placeholderId)]).toBeUndefined()
    expect(state.messageBodies[messageKey(assistantId)]).toBeUndefined()
    expect(state.messageBodies[messageKey(realMessageId)]?.content).toBe('updated question')
  })

  it('editLastUserMessage should resolve before the reply stream completes', async () => {
    const store = createChatStoreInstance()
    const session = buildSession(7)
    const userId = 100
    const createdAt = new Date(Date.UTC(2026, 1, 20, 0, 0, 7)).toISOString()
    let resolveStream!: () => void
    const pendingStream = new Promise<void>((resolve) => {
      resolveStream = resolve
    })
    const resend = vi.fn(() => pendingStream)
    store.setState({
      sessions: [session],
      currentSession: session,
      streamMessage: resend,
      messageMetas: [
        {
          id: userId,
          sessionId: session.id,
          role: 'user',
          createdAt,
          stableKey: `user-${userId}`,
        },
      ],
      messageBodies: {
        [messageKey(userId)]: {
          id: userId,
          stableKey: `user-${userId}`,
          content: 'old question',
          reasoning: '',
          version: 1,
          reasoningVersion: 0,
        },
      },
    } as any)

    vi.mocked(chatApi.updateUserMessage).mockResolvedValue({ success: true } as any)

    const resultPromise = store
      .getState()
      .editLastUserMessage(session.id, userId, 'updated question')

    // 回复流尚未结束（pendingStream 未 resolve），编辑应已成功返回，
    // 这样调用方才能立即关闭编辑弹框，避免"回复完成后弹框再次闪现"。
    await expect(resultPromise).resolves.toBe(true)
    expect(resend).toHaveBeenCalledWith(
      session.id,
      '',
      undefined,
      expect.objectContaining({ replyToMessageId: userId }),
    )
    expect(store.getState().messageBodies[messageKey(userId)]?.content).toBe('updated question')

    resolveStream()
  })

  it('editLastUserMessage should swallow a rejected reply stream', async () => {
    const store = createChatStoreInstance()
    const session = buildSession(8)
    const userId = 100
    const createdAt = new Date(Date.UTC(2026, 1, 20, 0, 0, 8)).toISOString()
    const resend = vi.fn().mockRejectedValue(new Error('stream start failed'))
    store.setState({
      sessions: [session],
      currentSession: session,
      streamMessage: resend,
      messageMetas: [
        {
          id: userId,
          sessionId: session.id,
          role: 'user',
          createdAt,
          stableKey: `user-${userId}`,
        },
      ],
      messageBodies: {
        [messageKey(userId)]: {
          id: userId,
          stableKey: `user-${userId}`,
          content: 'old question',
          reasoning: '',
          version: 1,
          reasoningVersion: 0,
        },
      },
    } as any)

    vi.mocked(chatApi.updateUserMessage).mockResolvedValue({ success: true } as any)

    // 即使回复流在启动阶段就失败（streamMessage reject），编辑仍应成功返回，
    // 且被 .catch 兜底消化，不产生未处理的 Promise rejection。
    await expect(
      store.getState().editLastUserMessage(session.id, userId, 'updated question'),
    ).resolves.toBe(true)
    expect(resend).toHaveBeenCalledWith(
      session.id,
      '',
      undefined,
      expect.objectContaining({ replyToMessageId: userId }),
    )
  })
})
