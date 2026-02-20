import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'
import * as chatApi from '@/features/chat/api'
import type { ChatSession, Message } from '@/types'

vi.mock('@/features/chat/api', () => ({
  getMessages: vi.fn(),
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
    vi.clearAllMocks()
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
      limit: 50,
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
})
