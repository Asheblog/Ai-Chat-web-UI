import {
  createSessionByModelId,
  deleteSession as deleteSessionApi,
  getSessions,
  updateSession as updateSessionApi,
  updateSessionModel as updateSessionModelApi,
} from '@/features/chat/api'
import type { ChatSession } from '@/types'
import type { ModelItem } from '@/store/models-store'
import type { SessionSlice } from '../types'
import type { ChatSliceCreator } from '../types'
import { createInitialShareSelection, messageKey } from '../utils'

export const createSessionSlice: ChatSliceCreator<SessionSlice & {
  currentSession: ChatSession | null
  sessions: ChatSession[]
  isSessionsLoading: boolean
  error: string | null
}> = (set, get, runtime) => ({
  currentSession: null,
  sessions: [],
  isSessionsLoading: false,
  error: null,

  fetchSessions: async () => {
    set({ isSessionsLoading: true, error: null })
    try {
      const response = await getSessions()
      set({
        sessions: response.data || [],
        isSessionsLoading: false,
      })
      get().fetchSessionsUsage().catch(() => {})
    } catch (error: any) {
      set({
        error: error?.response?.data?.error || error?.message || '获取会话列表失败',
        isSessionsLoading: false,
      })
    }
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
        sessions: [newSession, ...state.sessions],
        currentSession: newSession,
        messageMetas: [],
        assistantVariantSelections: {},
        messageBodies: {},
        messageRenderCache: {},
        messageMetrics: {},
        messagesHydrated: { ...state.messagesHydrated, [newSession.id]: true },
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
    if (alreadyCurrent && alreadyHydrated) {
      set(() => ({
        currentSession: session,
      }))
      return
    }
    const nextHydrated = { ...messagesHydrated }
    if (nextHydrated[sessionId]) {
      delete nextHydrated[sessionId]
    }
    set((state) => ({
      currentSession: session,
      messageMetas: [],
      assistantVariantSelections: {},
      messageBodies: {},
      messageRenderCache: {},
      messageMetrics: {},
      usageCurrent: null,
      usageLastRound: null,
      usageTotals: null,
      messagesHydrated: nextHydrated,
      isStreaming: state.activeStreamSessionId === session.id,
      shareSelection: createInitialShareSelection(),
    }))
    get().fetchMessages(sessionId)
    get().fetchUsage(sessionId)
  },

  deleteSession: async (sessionId: number) => {
    try {
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
        return {
          sessions: newSessions,
          currentSession: shouldClear ? null : state.currentSession,
          messageMetas: shouldClear ? [] : state.messageMetas,
          assistantVariantSelections: shouldClear ? {} : state.assistantVariantSelections,
          messageBodies: shouldClear ? {} : state.messageBodies,
          messageRenderCache: shouldClear ? {} : state.messageRenderCache,
          messageMetrics: shouldClear ? {} : metrics,
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
})
