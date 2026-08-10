import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStoreInstance } from '@/features/chat/store'
import * as chatApi from '@/features/chat/api'
import { messageKey } from '@/features/chat/store/utils'
import type { ChatSession } from '@/types'

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

const buildEditState = (sessionId: number, userId: number, createdAt: string, streamMessage: unknown) =>
  ({
    sessions: [buildSession(sessionId)],
    currentSession: buildSession(sessionId),
    streamMessage,
    messageMetas: [
      {
        id: userId,
        sessionId,
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
  }) as any

describe('message slice edit timing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(chatApi.getSessionArtifacts).mockResolvedValue([])
    vi.mocked(chatApi.getMessageByClientId).mockResolvedValue({ data: null } as any)
  })

  it('editLastUserMessage should resolve before the reply stream completes', async () => {
    const store = createChatStoreInstance()
    const sessionId = 7
    const userId = 100
    const createdAt = new Date(Date.UTC(2026, 1, 20, 0, 0, sessionId)).toISOString()
    let resolveStream!: () => void
    const pendingStream = new Promise<void>((resolve) => {
      resolveStream = resolve
    })
    const resend = vi.fn(() => pendingStream)
    store.setState(buildEditState(sessionId, userId, createdAt, resend))

    vi.mocked(chatApi.updateUserMessage).mockResolvedValue({ success: true } as any)

    const resultPromise = store
      .getState()
      .editLastUserMessage(sessionId, userId, 'updated question')

    // 回复流尚未结束（pendingStream 未 resolve），编辑应已成功返回，
    // 这样调用方才能立即关闭编辑弹框，避免"回复完成后弹框再次闪现"。
    await expect(resultPromise).resolves.toBe(true)
    expect(resend).toHaveBeenCalledWith(
      sessionId,
      '',
      undefined,
      expect.objectContaining({ replyToMessageId: userId }),
    )
    expect(store.getState().messageBodies[messageKey(userId)]?.content).toBe('updated question')

    resolveStream()
  })

  it('editLastUserMessage should swallow a rejected reply stream', async () => {
    const store = createChatStoreInstance()
    const sessionId = 8
    const userId = 100
    const createdAt = new Date(Date.UTC(2026, 1, 20, 0, 0, sessionId)).toISOString()
    const resend = vi.fn().mockRejectedValue(new Error('stream start failed'))
    store.setState(buildEditState(sessionId, userId, createdAt, resend))

    vi.mocked(chatApi.updateUserMessage).mockResolvedValue({ success: true } as any)

    // 即使回复流在启动阶段就失败（streamMessage reject），编辑仍应成功返回，
    // 且被 .catch 兜底消化，不产生未处理的 Promise rejection。
    await expect(
      store.getState().editLastUserMessage(sessionId, userId, 'updated question'),
    ).resolves.toBe(true)
    expect(resend).toHaveBeenCalledWith(
      sessionId,
      '',
      undefined,
      expect.objectContaining({ replyToMessageId: userId }),
    )
  })
})
