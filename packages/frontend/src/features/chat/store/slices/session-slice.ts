import {
  createSessionByModelId,
  deleteSession as deleteSessionApi,
  getSessions,
  updateSession as updateSessionApi,
  updateSessionModel as updateSessionModelApi,
} from '@/features/chat/api'
import { cancelStream, cancelAgentStream } from '@/features/chat/api/streaming'
import type { ChatSession } from '@/types'
import type { ModelItem } from '@/store/models-store'
import type { SessionSlice } from '../types'
import type { ChatSliceCreator } from '../types'
import { createInitialShareSelection, messageKey } from '../utils'

const sortSessions = (sessions: ChatSession[]) => {
  return [...sessions].sort((a, b) => {
    const pa = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
    const pb = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
    if (pa !== pb) return pb - pa
    const ca = new Date(a.createdAt).getTime() || 0
    const cb = new Date(b.createdAt).getTime() || 0
    return cb - ca
  })
}

export const createSessionSlice: ChatSliceCreator<SessionSlice & {
  currentSession: ChatSession | null
  sessions: ChatSession[]
  isSessionsLoading: boolean
  error: string | null
}> = (set, get, runtime) => {
  let fetchSessionsInFlight: Promise<void> | null = null

  return {
  currentSession: null,
  sessions: [],
  isSessionsLoading: false,
  error: null,

  fetchSessions: async () => {
    if (fetchSessionsInFlight) return fetchSessionsInFlight
    set({ isSessionsLoading: true, error: null })
    fetchSessionsInFlight = (async () => {
      try {
        const response = await getSessions()
        set({
          sessions: sortSessions(response.data || []),
          isSessionsLoading: false,
        })
        get().fetchSessionsUsage().catch(() => {})
      } catch (error: any) {
        set({
          error: error?.response?.data?.error || error?.message || '获取会话列表失败',
          isSessionsLoading: false,
        })
      } finally {
        fetchSessionsInFlight = null
      }
    })()
    return fetchSessionsInFlight
  },

  createSession: async (modelId, title, connectionId, rawId, systemPrompt) => {
    runtime.stopAllMessagePollers()
    set({ isSessionsLoading: true, error: null })
    try {
      const response = await createSessionByModelId(
        modelId,
        title,
        connectionId,
        rawId,
        systemPrompt ?? undefined,
      )
      const newSession = response.data as ChatSession
      set((state) => ({
        sessions: sortSessions([newSession, ...state.sessions]),
        currentSession: newSession,
        messagesHydrated: { ...state.messagesHydrated, [newSession.id]: true },
        messagePaginationBySession: {
          ...state.messagePaginationBySession,
          [newSession.id]: {
            oldestLoadedPage: 1,
            newestLoadedPage: 1,
            totalPages: 1,
            limit: 50,
            hasOlder: false,
            isLoadingOlder: false,
          },
        },
        isMessagesLoading: false,
        isSessionsLoading: false,
        isStreaming: false,
        shareSelection: createInitialShareSelection(),
      }))
      return newSession
    } catch (error: any) {
      set({
        error: error?.response?.data?.error || error?.message || '创建会话失败',
        isSessionsLoading: false,
      })
      return null
    }
  },

  selectSession: (sessionId: number) => {
    runtime.stopAllMessagePollers()
    const snapshot = get()
    const { sessions, messagesHydrated } = snapshot
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const alreadyCurrent = snapshot.currentSession?.id === sessionId
    const alreadyHydrated = messagesHydrated[sessionId] === true
    const hasSessionMessages = snapshot.messageMetas.some((meta) => meta.sessionId === sessionId)

    if (alreadyCurrent && alreadyHydrated) {
      set(() => ({
        currentSession: session,
        isStreaming: snapshot.activeStreamSessionId === session.id,
      }))
      get().fetchUsage(sessionId)
      return
    }

    const shouldFetchMessages = !alreadyHydrated || !hasSessionMessages

    set((state) => ({
      currentSession: session,
      usageCurrent: null,
      usageLastRound: null,
      usageTotals: null,
      isMessagesLoading: shouldFetchMessages,
      isStreaming: state.activeStreamSessionId === session.id,
      shareSelection: createInitialShareSelection(),
    }))

    if (shouldFetchMessages) {
      get().fetchMessages(sessionId)
    }
    get().fetchUsage(sessionId)
  },

  deleteSession: async (sessionId: number) => {
    try {
      // Cancel any active streams for this session before deleting
      const activeSessionStreams = Array.from(runtime.activeStreams.values()).filter(
        (stream) => stream.sessionId === sessionId,
      )
      for (const stream of activeSessionStreams) {
        stream.stopRequested = true
        // Cancel backend stream
        if (stream.clientMessageId || stream.assistantId) {
          cancelAgentStream(sessionId, {
            clientMessageId: stream.clientMessageId ?? stream.assistantClientMessageId ?? undefined,
            messageId: typeof stream.assistantId === 'number' ? stream.assistantId : undefined,
          }).catch(() => {})
        }
        // Cancel local fetch
        try {
          cancelStream(stream.streamKey)
        } catch {
          // ignore
        }
        runtime.clearActiveStream(stream)
      }

      await deleteSessionApi(sessionId)
      set((state) => {
        const newSessions = state.sessions.filter((s) => s.id !== sessionId)
        const shouldClear = state.currentSession?.id === sessionId
        const metrics = { ...(state.messageMetrics || {}) }
        const relatedKeys = state.messageMetas
          .filter((meta) => meta.sessionId === sessionId)
          .map((meta) => messageKey(meta.id))
        relatedKeys.forEach((key) => {
          delete metrics[key]
        })
        const nextHydrated = { ...state.messagesHydrated }
        if (Object.prototype.hasOwnProperty.call(nextHydrated, sessionId)) {
          delete nextHydrated[sessionId]
        }
        const nextPaging = { ...state.messagePaginationBySession }
        if (Object.prototype.hasOwnProperty.call(nextPaging, sessionId)) {
          delete nextPaging[sessionId]
        }
        return {
          sessions: newSessions,
          currentSession: shouldClear ? null : state.currentSession,
          messageMetas: shouldClear ? [] : state.messageMetas,
          assistantVariantSelections: shouldClear ? {} : state.assistantVariantSelections,
          messageBodies: shouldClear ? {} : state.messageBodies,
          messageRenderCache: shouldClear ? {} : state.messageRenderCache,
          messageMetrics: shouldClear ? {} : metrics,
          messagesHydrated: nextHydrated,
          messagePaginationBySession: nextPaging,
          shareSelection: shouldClear ? createInitialShareSelection() : state.shareSelection,
        }
      })
    } catch (error: any) {
      set({
        error: error?.response?.data?.error || error?.message || '删除会话失败',
      })
    }
  },

  updateSessionTitle: async (sessionId: number, title: string) => {
    try {
      await updateSessionApi(sessionId, { title })
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, title } : session,
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? { ...state.currentSession, title }
            : state.currentSession,
      }))
    } catch (error: any) {
      set({
        error: error?.response?.data?.error || error?.message || '更新会话标题失败',
      })
    }
  },

  switchSessionModel: async (sessionId: number, model: ModelItem) => {
    try {
      const resp = await updateSessionModelApi(sessionId, {
        modelId: model.id,
        connectionId: model.connectionId,
        rawId: model.rawId || model.id,
      })
      const updated = resp.data
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                connectionId: updated.connectionId,
                modelRawId: updated.modelRawId,
                modelLabel: updated.modelLabel || model.id,
              }
            : s,
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? {
                ...(state.currentSession as ChatSession),
                connectionId: updated.connectionId,
                modelRawId: updated.modelRawId,
                modelLabel: updated.modelLabel || model.id,
              }
            : state.currentSession,
      }))
    } catch (error: any) {
      set({ error: error?.response?.data?.error || error?.message || '切换模型失败' })
    }
  },

  updateSessionPrefs: async (sessionId, prefs) => {
    try {
      await updateSessionApi(sessionId, prefs as any)
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...prefs } : s)),
        currentSession:
          state.currentSession?.id === sessionId
            ? { ...(state.currentSession as ChatSession), ...prefs }
            : state.currentSession,
      }))
      return true
    } catch (error: any) {
      set({ error: error?.response?.data?.error || error?.message || '更新会话偏好失败' })
      return false
    }
  },

  toggleSessionPin: async (sessionId, pinned) => {
    try {
      const resp = await updateSessionApi(sessionId, { pinned })
      const updatedSession = (resp?.data as ChatSession | undefined) || undefined
      const nextPinnedAt =
        Object.prototype.hasOwnProperty.call(resp || {}, 'data') && updatedSession
          ? updatedSession.pinnedAt ?? null
          : pinned
            ? new Date().toISOString()
            : null

      set((state) => {
        const sessions = sortSessions(
          state.sessions.map((s) =>
            s.id === sessionId ? { ...s, pinnedAt: nextPinnedAt } : s,
          ),
        )
        const currentSession =
          state.currentSession?.id === sessionId
            ? { ...(state.currentSession as ChatSession), pinnedAt: nextPinnedAt }
            : state.currentSession

        return { sessions, currentSession }
      })
      return true
    } catch (error: any) {
      set({ error: error?.response?.data?.error || error?.message || '更新会话置顶状态失败' })
      return false
    }
  },
  }
}
