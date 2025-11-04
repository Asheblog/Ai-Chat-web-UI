import { create } from 'zustand'
import {
  ChatState,
  ChatSession,
  Message,
  MessageBody,
  MessageMeta,
  MessageRenderCacheEntry,
} from '@/types'
import { apiClient } from '@/lib/api'
import type { ModelItem } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

type MessageId = number | string

interface StreamAccumulator {
  sessionId: number
  assistantId: MessageId
  content: string
  reasoning: string
  pendingContent: string
  pendingReasoning: string
  pendingMeta: Partial<Pick<MessageMeta, 'reasoningStatus' | 'reasoningIdleMs' | 'reasoningDurationSeconds'>>
  flushTimer: ReturnType<typeof setTimeout> | null
  reasoningDesired: boolean
  reasoningActivated: boolean
}

const STREAM_FLUSH_INTERVAL = 70

const messageKey = (id: MessageId) => (typeof id === 'string' ? id : String(id))

const createMeta = (message: Message, overrides: Partial<MessageMeta> = {}): MessageMeta => ({
  id: message.id,
  sessionId: message.sessionId,
  role: message.role,
  createdAt: message.createdAt,
  clientMessageId: message.clientMessageId ?? null,
  reasoningStatus: message.reasoningStatus,
  reasoningDurationSeconds: message.reasoningDurationSeconds ?? null,
  reasoningIdleMs: message.reasoningIdleMs ?? null,
  images: message.images,
  isPlaceholder: false,
  ...overrides,
})

const createBody = (message: Message): MessageBody => ({
  id: message.id,
  content: message.content || '',
  reasoning: message.reasoning || '',
  version: message.content ? 1 : 0,
  reasoningVersion: message.reasoning ? 1 : 0,
})

const ensureBody = (body: MessageBody | undefined, id: MessageId): MessageBody =>
  body ?? { id, content: '', reasoning: '', version: 0, reasoningVersion: 0 }

const mergeImages = (message: Message, cache: Record<string, string[]>): Message => {
  const serverImages = Array.isArray(message.images) ? message.images : []
  if (serverImages.length > 0) {
    return { ...message, images: serverImages }
  }
  if (message.clientMessageId && cache[message.clientMessageId]) {
    return { ...message, images: cache[message.clientMessageId] }
  }
  return message
}

interface ChatStore extends ChatState {
  fetchSessions: () => Promise<void>
  fetchSessionsUsage: () => Promise<void>
  fetchMessages: (sessionId: number) => Promise<void>
  fetchUsage: (sessionId: number) => Promise<void>
  createSession: (modelId: string, title?: string, connectionId?: number, rawId?: string) => Promise<void>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  switchSessionModel: (sessionId: number, model: ModelItem) => Promise<void>
  updateSessionPrefs: (sessionId: number, prefs: Partial<{ reasoningEnabled: boolean; reasoningEffort: 'low'|'medium'|'high'; ollamaThink: boolean }>) => Promise<void>
  sendMessage: (sessionId: number, content: string) => Promise<void>
  streamMessage: (
    sessionId: number,
    content: string,
    images?: Array<{ data: string; mime: string }>,
    options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean }
  ) => Promise<void>
  stopStreaming: () => void
  addMessage: (message: Message) => void
  clearError: () => void
  applyRenderedContent: (
    messageId: MessageId,
    payload: { contentHtml?: string | null; reasoningHtml?: string | null; contentVersion?: number; reasoningVersion?: number }
  ) => void
  invalidateRenderedContent: (messageId?: MessageId) => void
}

export const useChatStore = create<ChatStore>((set, get) => {
  const streamState: { active: StreamAccumulator | null } = { active: null }

  const flushActiveStream = (force = false) => {
    const active = streamState.active
    if (!active) return

    const hasPending =
      active.pendingContent.length > 0 ||
      active.pendingReasoning.length > 0 ||
      Object.keys(active.pendingMeta).length > 0

    if (!force && !hasPending) {
      return
    }

    if (active.pendingContent.length > 0) {
      active.content += active.pendingContent
      active.pendingContent = ''
    }
    if (active.pendingReasoning.length > 0) {
      active.reasoning += active.pendingReasoning
      active.pendingReasoning = ''
    }

    const metaPatch = active.pendingMeta
    active.pendingMeta = {}

    const assistantKey = messageKey(active.assistantId)

    set((state) => {
      const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === assistantKey)
      if (metaIndex === -1) {
        return state
      }

      const prevMeta = state.messageMetas[metaIndex]
      const prevBody = ensureBody(state.messageBodies[assistantKey], active.assistantId)

      const nextMeta: MessageMeta = { ...prevMeta }
      let metaChanged = false

      const applyMetaField = <K extends keyof MessageMeta>(key: K, value: MessageMeta[K]) => {
        if (nextMeta[key] !== value) {
          nextMeta[key] = value
          metaChanged = true
        }
      }

      if (prevMeta.isPlaceholder && (active.content.length > 0 || active.reasoning.length > 0)) {
        applyMetaField('isPlaceholder', false)
      }

      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningStatus')) {
        applyMetaField('reasoningStatus', metaPatch.reasoningStatus ?? undefined)
      }
      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningIdleMs')) {
        applyMetaField('reasoningIdleMs', metaPatch.reasoningIdleMs ?? null)
      }
      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningDurationSeconds')) {
        applyMetaField('reasoningDurationSeconds', metaPatch.reasoningDurationSeconds ?? null)
      }

      const contentChanged = prevBody.content !== active.content
      const reasoningChanged = prevBody.reasoning !== active.reasoning

      if (!contentChanged && !reasoningChanged && !metaChanged) {
        return state
      }

      const nextBody: MessageBody = {
        id: prevBody.id,
        content: contentChanged ? active.content : prevBody.content,
        reasoning: reasoningChanged ? active.reasoning : prevBody.reasoning,
        version: prevBody.version + (contentChanged ? 1 : 0),
        reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
      }

      const nextBodies = { ...state.messageBodies, [assistantKey]: nextBody }
      const nextRenderCache = { ...state.messageRenderCache }
      delete nextRenderCache[assistantKey]

      const partial: Partial<ChatState> = {
        messageBodies: nextBodies,
        messageRenderCache: nextRenderCache,
      }

      if (metaChanged) {
        const nextMetas = state.messageMetas.slice()
        nextMetas[metaIndex] = nextMeta
        partial.messageMetas = nextMetas
      }

      return partial
    })
  }

  const scheduleFlush = () => {
    const active = streamState.active
    if (!active) return
    if (active.flushTimer) return
    active.flushTimer = setTimeout(() => {
      active.flushTimer = null
      flushActiveStream()
    }, STREAM_FLUSH_INTERVAL)
  }

  const resetStreamState = () => {
    const active = streamState.active
    if (active?.flushTimer) {
      clearTimeout(active.flushTimer)
    }
    streamState.active = null
  }

  return {
    currentSession: null,
    sessions: [],
    messageMetas: [],
    messageBodies: {},
    messageRenderCache: {},
    messageImageCache: {},
    isLoading: false,
    isStreaming: false,
    error: null,
    usageCurrent: null,
    usageLastRound: null,
    usageTotals: null,
    sessionUsageTotalsMap: {} as Record<number, import('@/types').UsageTotals>,

    fetchSessions: async () => {
      set({ isLoading: true, error: null })
      try {
        const response = await apiClient.getSessions()
        set({
          sessions: response.data || [],
          isLoading: false,
        })
        get().fetchSessionsUsage().catch(() => {})
      } catch (error: any) {
        set({
          error: error?.response?.data?.error || error?.message || '获取会话列表失败',
          isLoading: false,
        })
      }
    },

    fetchSessionsUsage: async () => {
      try {
        const res = await apiClient.getSessionsUsage()
        const arr = res.data as Array<{ sessionId: number; totals: import('@/types').UsageTotals }>
        const map: Record<number, import('@/types').UsageTotals> = {}
        ;(arr || []).forEach((item) => {
          map[item.sessionId] = item.totals
        })
        set({ sessionUsageTotalsMap: map })
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[fetchSessionsUsage] error', (error as any)?.message || error)
        }
      }
    },

    fetchMessages: async (sessionId: number) => {
      set({ isLoading: true, error: null })
      try {
        const response = await apiClient.getMessages(sessionId)
        const cache = get().messageImageCache
        const rawMessages = Array.isArray(response.data) ? response.data : []
        const normalized = rawMessages.map((msg) => mergeImages(msg, cache))

        const metas: MessageMeta[] = normalized.map((msg) => createMeta(msg))
        const bodies: Record<string, MessageBody> = {}
        normalized.forEach((msg) => {
          bodies[messageKey(msg.id)] = createBody(msg)
        })

        const nextCache = { ...cache }
        normalized.forEach((msg) => {
          if (msg.clientMessageId && msg.images && msg.images.length > 0) {
            nextCache[msg.clientMessageId] = msg.images
          }
        })

        set({
          messageMetas: metas,
          messageBodies: bodies,
          messageRenderCache: {},
          messageImageCache: nextCache,
          isLoading: false,
        })
      } catch (error: any) {
        set({
          error: error?.response?.data?.error || error?.message || '获取消息列表失败',
          isLoading: false,
        })
      }
    },

    fetchUsage: async (sessionId: number) => {
      try {
        const res = await apiClient.getUsage(sessionId)
        const data = res.data || {}
        set({
          usageTotals: data.totals || null,
          usageLastRound: data.last_round || null,
          usageCurrent: data.current || null,
        })
      } catch (error: any) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[fetchUsage] error', error?.message || error)
        }
      }
    },

    createSession: async (modelId: string, title?: string, connectionId?: number, rawId?: string) => {
      set({ isLoading: true, error: null })
      try {
        const response = await apiClient.createSessionByModelId(modelId, title, connectionId, rawId)
        const newSession = response.data as ChatSession
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSession: newSession,
          messageMetas: [],
          messageBodies: {},
          messageRenderCache: {},
          isLoading: false,
        }))
      } catch (error: any) {
        set({
          error: error?.response?.data?.error || error?.message || '创建会话失败',
          isLoading: false,
        })
      }
    },

    selectSession: (sessionId: number) => {
      const { sessions } = get()
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        set({
          currentSession: session,
          messageMetas: [],
          messageBodies: {},
          messageRenderCache: {},
          usageCurrent: null,
          usageLastRound: null,
          usageTotals: null,
        })
        get().fetchMessages(sessionId)
        get().fetchUsage(sessionId)
      }
    },

    deleteSession: async (sessionId: number) => {
      try {
        await apiClient.deleteSession(sessionId)
        set((state) => {
          const newSessions = state.sessions.filter((s) => s.id !== sessionId)
          const shouldClear = state.currentSession?.id === sessionId
          return {
            sessions: newSessions,
            currentSession: shouldClear ? null : state.currentSession,
            messageMetas: shouldClear ? [] : state.messageMetas,
            messageBodies: shouldClear ? {} : state.messageBodies,
            messageRenderCache: shouldClear ? {} : state.messageRenderCache,
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
        await apiClient.updateSession(sessionId, { title })
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, title } : session
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
        const resp = await apiClient.updateSessionModel(sessionId, {
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
              : s
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
        await apiClient.updateSession(sessionId, prefs as any)
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...prefs } : s)),
          currentSession:
            state.currentSession?.id === sessionId
              ? { ...(state.currentSession as ChatSession), ...prefs }
              : state.currentSession,
        }))
      } catch (error: any) {
        set({ error: error?.response?.data?.error || error?.message || '更新会话偏好失败' })
      }
    },

    sendMessage: async (sessionId: number, content: string) => {
      await get().streamMessage(sessionId, content)
    },

    streamMessage: async (sessionId: number, content: string, images, options) => {
      const snapshot = get()
      const session = snapshot.sessions.find((s) => s.id === sessionId) || snapshot.currentSession
      if (!session || session.id !== sessionId) {
        set({ error: '会话不存在或未选中' })
        return
      }

      try {
        const isTarget = snapshot.currentSession?.id === sessionId
        const isDefaultTitle =
          isTarget &&
          (!!snapshot.currentSession?.title === false ||
            snapshot.currentSession?.title === '新的对话' ||
            snapshot.currentSession?.title === 'New Chat')
        const userMessageCount = snapshot.messageMetas.filter(
          (meta) => meta.sessionId === sessionId && meta.role === 'user'
        ).length
        const noUserMessagesYet = userMessageCount === 0

        if (isTarget && isDefaultTitle && noUserMessagesYet && content) {
          const deriveTitle = (text: string) => {
            let s = text
              .replace(/```[\s\S]*?```/g, ' ')
              .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
              .replace(/^[#>\-\*\s]+/gm, '')
              .replace(/\n+/g, ' ')
              .trim()
            const limit = 30
            return s.length > limit ? s.slice(0, limit) : s
          }
          const titleCandidate = deriveTitle(content)
          if (titleCandidate) {
            const prevTitle = snapshot.currentSession?.title || '新的对话'
            set((state) => ({
              sessions: state.sessions.map((s) =>
                s.id === sessionId ? { ...s, title: titleCandidate } : s
              ),
              currentSession:
                state.currentSession?.id === sessionId
                  ? { ...state.currentSession, title: titleCandidate }
                  : state.currentSession,
            }))
            get()
              .updateSessionTitle(sessionId, titleCandidate)
              .catch(() => {
                set((state) => ({
                  sessions: state.sessions.map((s) =>
                    s.id === sessionId ? { ...s, title: prevTitle } : s
                  ),
                  currentSession:
                    state.currentSession?.id === sessionId
                      ? { ...state.currentSession, title: prevTitle }
                      : state.currentSession,
                }))
              })
          }
        }
      } catch {
        // 忽略自动改名异常
      }

      const userClientMessageId =
        (() => {
          try {
            return (crypto as any)?.randomUUID?.() ?? ''
          } catch {
            return ''
          }
        })() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

      const now = new Date().toISOString()
      const userMessageId: number = Date.now()
      const assistantMessageId: number = userMessageId + 1
      const userMessage: Message = {
        id: userMessageId,
        sessionId,
        role: 'user',
        content,
        createdAt: now,
        clientMessageId: userClientMessageId,
        images: images?.length
          ? images.map((img) => `data:${img.mime};base64,${img.data}`)
          : undefined,
      }

      const reasoningPreference =
        snapshot.currentSession?.id === sessionId
          ? snapshot.currentSession?.reasoningEnabled
          : snapshot.sessions.find((s) => s.id === sessionId)?.reasoningEnabled
      const normalizedReasoningPreference =
        typeof reasoningPreference === 'boolean' ? reasoningPreference : undefined
      const resolvedReasoningEnabled =
        options?.reasoningEnabled ?? normalizedReasoningPreference ?? true
      const reasoningDesired = Boolean(resolvedReasoningEnabled)
      const { contextEnabled } = useSettingsStore.getState()

      const assistantPlaceholder: Message = {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: now,
      }

      set((state) => {
        const nextCache =
          userMessage.clientMessageId && userMessage.images && userMessage.images.length > 0
            ? { ...state.messageImageCache, [userMessage.clientMessageId]: userMessage.images }
            : state.messageImageCache
        const metas = [...state.messageMetas, createMeta(userMessage), createMeta(assistantPlaceholder, { isPlaceholder: true })]
        const bodies = {
          ...state.messageBodies,
          [messageKey(userMessage.id)]: createBody(userMessage),
          [messageKey(assistantPlaceholder.id)]: createBody(assistantPlaceholder),
        }
        const renderCache = { ...state.messageRenderCache }
        delete renderCache[messageKey(assistantPlaceholder.id)]

        return {
          messageMetas: metas,
          messageBodies: bodies,
          messageRenderCache: renderCache,
          messageImageCache: nextCache,
          isStreaming: true,
          error: null,
        }
      })

      streamState.active = {
        sessionId,
        assistantId: assistantPlaceholder.id,
        content: '',
        reasoning: '',
        pendingContent: '',
        pendingReasoning: '',
        pendingMeta: {},
        flushTimer: null,
        reasoningDesired,
        reasoningActivated: false,
      }

      const startStream = () =>
        apiClient.streamChat(sessionId, content, images, {
          ...(options || {}),
          contextEnabled,
          clientMessageId: userClientMessageId,
        })

      try {
        const iterator = startStream()
        for await (const evt of iterator) {
          const active = streamState.active
          if (!active) break

          if (evt?.type === 'content' && evt.content) {
            active.pendingContent += evt.content
            scheduleFlush()
            continue
          }

          if (evt?.type === 'reasoning') {
            if (!active.reasoningDesired) continue

            const chunkHasContent = typeof evt.content === 'string' && evt.content.length > 0
            if (!active.reasoningActivated && !chunkHasContent && !evt.keepalive) {
              continue
            }

            if (!active.reasoningActivated) {
              active.reasoningActivated = true
              active.pendingMeta.reasoningStatus = 'idle'
            }

            if (evt.keepalive) {
              active.pendingMeta.reasoningStatus = 'idle'
              active.pendingMeta.reasoningIdleMs = evt.idleMs ?? null
              scheduleFlush()
              continue
            }

            if (evt.content) {
              active.pendingReasoning += evt.content
              active.pendingMeta.reasoningStatus = 'streaming'
              active.pendingMeta.reasoningIdleMs = null
            }

            if (evt.done) {
              active.pendingMeta.reasoningStatus = 'done'
              if (evt.duration != null) {
                active.pendingMeta.reasoningDurationSeconds = evt.duration
              }
            }

            scheduleFlush()
            continue
          }

          if (evt?.type === 'usage' && evt.usage) {
            const usage = evt.usage
            set((state) => ({
              usageCurrent: {
                prompt_tokens: usage.prompt_tokens,
                context_limit: usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
                context_remaining:
                  usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
              },
              usageLastRound:
                usage.completion_tokens != null || usage.total_tokens != null
                  ? usage
                  : state.usageLastRound,
            }))
            continue
          }

          if (evt?.type === 'quota' && evt.quota) {
            useAuthStore.getState().updateQuota(evt.quota)
            continue
          }

          if (evt?.type === 'complete') {
            const activeBuffer = streamState.active
            if (activeBuffer) {
              activeBuffer.pendingMeta.reasoningStatus = 'done'
            }
            scheduleFlush()
            continue
          }
        }

        flushActiveStream(true)
        resetStreamState()
        set({ isStreaming: false })
        get().fetchUsage(sessionId).catch(() => {})
        get().fetchSessionsUsage().catch(() => {})
      } catch (error: any) {
        flushActiveStream(true)
        resetStreamState()

        const quotaPayload = error?.payload?.quota ?? null
        if (quotaPayload) {
          useAuthStore.getState().updateQuota(quotaPayload)
        }

        if (error?.status === 429) {
          const message = error?.payload?.error || '额度不足，请登录或等待次日重置'
          set({ error: message, isStreaming: false })
          set((state) => {
            const metas = state.messageMetas.filter((meta) => meta.id !== assistantPlaceholder.id)
            const bodies = { ...state.messageBodies }
            delete bodies[messageKey(assistantPlaceholder.id)]
            const renderCache = { ...state.messageRenderCache }
            delete renderCache[messageKey(assistantPlaceholder.id)]
            return {
              messageMetas: metas,
              messageBodies: bodies,
              messageRenderCache: renderCache,
            }
          })
          return
        }

        try {
          const resp = await apiClient.chatCompletion(sessionId, content, images, {
            ...(options || {}),
            contextEnabled,
            clientMessageId: userClientMessageId,
          })
          const finalText = resp?.data?.content || ''
          if (resp?.data?.quota) {
            useAuthStore.getState().updateQuota(resp.data.quota)
          }

          if (finalText) {
            set((state) => {
              const key = messageKey(assistantPlaceholder.id)
              const prevBody = ensureBody(state.messageBodies[key], assistantPlaceholder.id)
              const body: MessageBody = {
                id: prevBody.id,
                content: finalText,
                reasoning: prevBody.reasoning,
                version: prevBody.version + 1,
                reasoningVersion: prevBody.reasoningVersion,
              }
              const bodies = { ...state.messageBodies, [key]: body }
              const renderCache = { ...state.messageRenderCache }
              delete renderCache[key]
              const metaIndex = state.messageMetas.findIndex((meta) => meta.id === assistantPlaceholder.id)
              const metas = state.messageMetas.slice()
              if (metaIndex >= 0) {
                metas[metaIndex] = {
                  ...metas[metaIndex],
                  isPlaceholder: false,
                  reasoningStatus: metas[metaIndex].reasoningStatus ?? (body.reasoning ? 'done' : undefined),
                }
              }
              return {
                messageBodies: bodies,
                messageRenderCache: renderCache,
                messageMetas: metas,
                isStreaming: false,
              }
            })
            await get().fetchUsage(sessionId)
            get().fetchSessionsUsage().catch(() => {})
            return
          }
        } catch (fallbackError: any) {
          const fallbackQuota =
            fallbackError?.response?.data?.quota ?? fallbackError?.payload?.quota ?? null
          if (fallbackQuota) {
            useAuthStore.getState().updateQuota(fallbackQuota)
          }
          if (fallbackError?.response?.status === 429) {
            const message = fallbackError?.response?.data?.error || '额度不足，请登录或等待次日重置'
            set({ error: message, isStreaming: false })
            set((state) => {
              const metas = state.messageMetas.filter((meta) => meta.id !== assistantPlaceholder.id)
              const bodies = { ...state.messageBodies }
              delete bodies[messageKey(assistantPlaceholder.id)]
              const renderCache = { ...state.messageRenderCache }
              delete renderCache[messageKey(assistantPlaceholder.id)]
              return {
                messageMetas: metas,
                messageBodies: bodies,
                messageRenderCache: renderCache,
              }
            })
            return
          }
        }

        set({
          error: error?.message || '发送消息失败',
          isStreaming: false,
        })
        set((state) => {
          const metas = state.messageMetas.filter((meta) => meta.id !== assistantPlaceholder.id)
          const bodies = { ...state.messageBodies }
          delete bodies[messageKey(assistantPlaceholder.id)]
          const renderCache = { ...state.messageRenderCache }
          delete renderCache[messageKey(assistantPlaceholder.id)]
          return {
            messageMetas: metas,
            messageBodies: bodies,
            messageRenderCache: renderCache,
          }
        })
      }
    },

    stopStreaming: () => {
      try {
        apiClient.cancelStream()
      } catch {
        // ignore
      }
      flushActiveStream(true)
      resetStreamState()
      set({ isStreaming: false })
    },

    addMessage: (message: Message) => {
      set((state) => {
        const key = messageKey(message.id)
        const nextCache =
          message.clientMessageId && message.images && message.images.length > 0
            ? { ...state.messageImageCache, [message.clientMessageId]: message.images }
            : state.messageImageCache
        const renderCache = { ...state.messageRenderCache }
        delete renderCache[key]
        return {
          messageMetas: [...state.messageMetas, createMeta(message)],
          messageBodies: { ...state.messageBodies, [key]: createBody(message) },
          messageImageCache: nextCache,
          messageRenderCache: renderCache,
        }
      })
    },

    clearError: () => {
      set({ error: null })
    },

    applyRenderedContent: (messageId, payload) => {
      const key = messageKey(messageId)
      set((state) => {
        const body = state.messageBodies[key]
        if (!body) return state

        const {
          contentHtml = null,
          reasoningHtml = null,
          contentVersion = body.version,
          reasoningVersion = body.reasoningVersion,
        } = payload

        if (
          (contentVersion != null && contentVersion < body.version) ||
          (reasoningVersion != null && reasoningVersion < body.reasoningVersion)
        ) {
          return state
        }

        const entry: MessageRenderCacheEntry = {
          contentHtml,
          reasoningHtml,
          contentVersion,
          reasoningVersion,
          updatedAt: Date.now(),
        }

        return {
          messageRenderCache: {
            ...state.messageRenderCache,
            [key]: entry,
          },
        }
      })
    },

    invalidateRenderedContent: (messageId) => {
      if (typeof messageId === 'undefined') {
        set({ messageRenderCache: {} })
        return
      }
      const key = messageKey(messageId)
      set((state) => {
        if (!state.messageRenderCache[key]) return state
        const next = { ...state.messageRenderCache }
        delete next[key]
        return { messageRenderCache: next }
      })
    },
  }
})
