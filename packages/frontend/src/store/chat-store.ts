import { create } from 'zustand'
import {
  ChatState,
  ChatSession,
  Message,
  MessageBody,
  MessageMeta,
  MessageRenderCacheEntry,
  ToolEvent,
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
  clientMessageId: string | null
  webSearchRequested: boolean
  assistantClientMessageId?: string | null
}

// 优化为实时刷新，支持逐字显示效果
// 原值: 70ms批量更新 -> 现值: 0ms立即更新
const STREAM_FLUSH_INTERVAL = 0

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
  streamStatus: message.streamStatus ?? 'done',
  streamError: message.streamError ?? null,
  ...overrides,
})

const createBody = (message: Message): MessageBody => ({
  id: message.id,
  content: message.content || '',
  reasoning: message.reasoning ?? message.streamReasoning ?? '',
  version: message.content ? 1 : 0,
  reasoningVersion: message.reasoning || message.streamReasoning ? 1 : 0,
  toolEvents: normalizeToolEvents(message),
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

const inferToolStatus = (stage: ToolEvent['stage']): ToolEvent['status'] => {
  if (stage === 'result') return 'success'
  if (stage === 'error') return 'error'
  return 'running'
}

const normalizeToolEvents = (message: Message): ToolEvent[] => {
  if (!Array.isArray(message.toolEvents) || message.toolEvents.length === 0) return []
  const baseTimestamp = (() => {
    const ts = Date.parse(message.createdAt)
    return Number.isFinite(ts) ? ts : Date.now()
  })()
  const pendingByKey = new Map<string, Array<{ id: string; createdAt: number }>>()
  let legacyCounter = 0
  const LEGACY_WINDOW = 15000
  const buildKey = (tool?: string | null, query?: string | null) =>
    `${tool || 'tool'}::${(query || '').trim().toLowerCase()}`
  const purgeStale = (key: string, timestamp: number) => {
    const queue = pendingByKey.get(key)
    if (!queue || queue.length === 0) return
    while (queue.length > 0 && timestamp - queue[0].createdAt > LEGACY_WINDOW) {
      queue.shift()
    }
    if (queue.length === 0) {
      pendingByKey.delete(key)
    } else {
      pendingByKey.set(key, queue)
    }
  }
  const allocateLegacyId = (key: string, stage: ToolEvent['stage'], createdAt: number) => {
    purgeStale(key, createdAt)
    if (stage !== 'start') {
      const queue = pendingByKey.get(key)
      if (queue && queue.length > 0) {
        const match = queue.shift()!
        if (queue.length === 0) {
          pendingByKey.delete(key)
        } else {
          pendingByKey.set(key, queue)
        }
        return match.id
      }
    }
    const id = `${message.id}-legacy-tool-${legacyCounter++}`
    if (stage === 'start') {
      const queue = pendingByKey.get(key) ?? []
      queue.push({ id, createdAt })
      pendingByKey.set(key, queue)
    }
    return id
  }

  return message.toolEvents.map((evt, idx) => {
    const stage =
      evt.stage === 'start' || evt.stage === 'result' || evt.stage === 'error'
        ? evt.stage
        : 'start'
    const createdAt =
      typeof (evt as any).createdAt === 'number' && Number.isFinite((evt as any).createdAt)
        ? ((evt as any).createdAt as number)
        : baseTimestamp + idx
    const tool = evt.tool || 'web_search'
    const key = buildKey(tool, typeof evt.query === 'string' ? evt.query : undefined)
    const id =
      typeof evt.id === 'string' && evt.id.trim().length > 0
        ? evt.id.trim()
        : allocateLegacyId(key, stage, createdAt)
    return {
      id,
      sessionId: message.sessionId,
      messageId: message.id,
      tool,
      stage,
      status: inferToolStatus(stage),
      query: evt.query,
      hits: Array.isArray(evt.hits) ? evt.hits : undefined,
      error: evt.error,
      createdAt,
    }
  })
}

const PROVIDER_SAFETY_HINT =
  '提问内容包含敏感或未脱敏信息，被上游模型拦截。请调整措辞或移除相关内容后再试。'
const PROVIDER_SAFETY_MARKERS = [
  'data_inspection_failed',
  'input data may contain inappropriate content',
]

const containsProviderSafetyMarker = (text: string) => {
  const lower = text.toLowerCase()
  return PROVIDER_SAFETY_MARKERS.some((marker) => lower.includes(marker))
}

const stringifyCandidate = (candidate: unknown): string | null => {
  if (typeof candidate === 'string') return candidate
  if (typeof candidate === 'number' || typeof candidate === 'boolean') {
    return String(candidate)
  }
  if (candidate && typeof candidate === 'object') {
    if (typeof (candidate as any).message === 'string') {
      return (candidate as any).message
    }
    if (typeof (candidate as any).code === 'string') {
      return (candidate as any).code
    }
    try {
      return JSON.stringify(candidate)
    } catch {
      return null
    }
  }
  return null
}

const resolveProviderSafetyMessage = (error: unknown): string | null => {
  const inspected: unknown[] = []
  const pushCandidate = (value: unknown) => {
    if (value == null) return
    if (Array.isArray(value)) {
      value.forEach(pushCandidate)
      return
    }
    inspected.push(value)
  }

  pushCandidate(error)
  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>
    pushCandidate(errObj.message)
    if ('payload' in errObj) {
      const payload = errObj.payload as Record<string, unknown> | undefined
      pushCandidate(payload)
      if (payload && 'error' in payload) {
        pushCandidate(payload.error)
      }
    }
    if ('response' in errObj) {
      const resp = errObj.response as Record<string, unknown> | undefined
      pushCandidate(resp)
      if (resp && 'data' in resp) {
        const data = resp.data as Record<string, unknown> | undefined
        pushCandidate(data)
        if (data && 'error' in data) {
          pushCandidate(data.error)
        }
      }
    }
  }

  for (const candidate of inspected) {
    const text = stringifyCandidate(candidate)
    if (text && containsProviderSafetyMarker(text)) {
      return PROVIDER_SAFETY_HINT
    }
  }
  return null
}

interface ChatStore extends ChatState {
  fetchSessions: () => Promise<void>
  fetchSessionsUsage: () => Promise<void>
  fetchMessages: (sessionId: number) => Promise<void>
  fetchUsage: (sessionId: number) => Promise<void>
  createSession: (modelId: string, title?: string, connectionId?: number, rawId?: string) => Promise<ChatSession | null>
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
    options?: {
      reasoningEnabled?: boolean;
      reasoningEffort?: 'low' | 'medium' | 'high';
      ollamaThink?: boolean;
      saveReasoning?: boolean;
      features?: { web_search?: boolean };
    }
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
  const streamingPollers = new Map<number, ReturnType<typeof setInterval>>()

  const stopMessagePoller = (messageId: number) => {
    const timer = streamingPollers.get(messageId)
    if (timer) {
      clearInterval(timer)
      streamingPollers.delete(messageId)
    }
  }

  const stopAllMessagePollers = () => {
    streamingPollers.forEach((timer) => clearInterval(timer))
    streamingPollers.clear()
  }

  const recomputeStreamingState = () => {
    const snapshot = get()
    const hasStreaming = snapshot.messageMetas.some((meta) => meta.streamStatus === 'streaming')
    if (snapshot.isStreaming !== hasStreaming) {
      set({ isStreaming: hasStreaming })
    }
  }

  const applyServerMessageSnapshot = (message: Message) => {
    set((state) => {
      const key = messageKey(message.id)
      const prevBody = ensureBody(state.messageBodies[key], message.id)
      const nextContent = message.content || ''
      const nextReasoning = message.reasoning ?? message.streamReasoning ?? ''
      const contentChanged = prevBody.content !== nextContent
      const reasoningChanged = (prevBody.reasoning ?? '') !== nextReasoning
      const nextBody: MessageBody = {
        id: message.id,
        content: nextContent,
        reasoning: nextReasoning,
        version: prevBody.version + (contentChanged ? 1 : 0),
        reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
        toolEvents: message.toolEvents?.length ? message.toolEvents : prevBody.toolEvents,
      }
      const nextBodies = { ...state.messageBodies, [key]: nextBody }
      const serverMeta = createMeta(message)
      const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === key)
      const nextMetas =
        metaIndex === -1
          ? [...state.messageMetas, serverMeta]
          : state.messageMetas.map((meta, idx) =>
              idx === metaIndex
                ? {
                    ...meta,
                    ...serverMeta,
                    isPlaceholder: false,
                    streamStatus: message.streamStatus ?? meta.streamStatus,
                    streamError: message.streamError ?? meta.streamError,
                  }
                : meta
            )
      const nextRenderCache = { ...state.messageRenderCache }
      delete nextRenderCache[key]
      return {
        messageBodies: nextBodies,
        messageMetas: nextMetas,
        messageRenderCache: nextRenderCache,
      }
    })
    recomputeStreamingState()
  }

  const updateMetaStreamStatus = (
    messageId: MessageId,
    status: MessageMeta['streamStatus'],
    streamError?: string | null
  ) => {
    const key = messageKey(messageId)
    set((state) => {
      const idx = state.messageMetas.findIndex((meta) => messageKey(meta.id) === key)
      if (idx === -1) return state
      const nextMetas = state.messageMetas.slice()
      nextMetas[idx] = { ...nextMetas[idx], streamStatus: status, streamError: streamError ?? null }
      return { messageMetas: nextMetas }
    })
    if (status && status !== 'streaming' && typeof messageId === 'number' && Number.isFinite(messageId)) {
      stopMessagePoller(messageId)
    }
    recomputeStreamingState()
  }

  const activeWatchers = new Set<number>()

  const startMessageProgressWatcher = (sessionId: number, messageId: number) => {
    if (typeof messageId !== 'number' || Number.isNaN(messageId)) return
    if (streamState.active?.assistantId === messageId) return
    if (activeWatchers.has(messageId)) return
    activeWatchers.add(messageId)

    const poll = async () => {
      const snapshot = get()
      if (snapshot.currentSession?.id !== sessionId) {
        if (activeWatchers.has(messageId)) {
          setTimeout(poll, 500)
        }
        return
      }
      try {
        const response = await apiClient.getMessageProgress(sessionId, messageId)
        const payload = response?.data?.message ?? (response?.data as Message | undefined)
        if (payload) {
          applyServerMessageSnapshot(payload)
          if (payload.streamStatus && payload.streamStatus !== 'streaming') {
            stopMessagePoller(messageId)
            activeWatchers.delete(messageId)
            return
          }
        }
      } catch (error: any) {
        const status = error?.response?.status
        if (status === 404 || status === 403) {
          stopMessagePoller(messageId)
          activeWatchers.delete(messageId)
          return
        }
      }
      if (activeWatchers.has(messageId)) {
        setTimeout(poll, 1500)
      }
    }

    poll()
  }

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
    messagesHydrated: {},
    isSessionsLoading: false,
    isMessagesLoading: false,
    isStreaming: false,
    error: null,
    usageCurrent: null,
    usageLastRound: null,
    usageTotals: null,
    sessionUsageTotalsMap: {} as Record<number, import('@/types').UsageTotals>,
    toolEvents: [],

    fetchSessions: async () => {
      set({ isSessionsLoading: true, error: null })
      try {
        const response = await apiClient.getSessions()
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
      set({ isMessagesLoading: true, error: null })
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

        set((state) => ({
          messageMetas: metas,
          messageBodies: bodies,
          messageRenderCache: {},
          messageImageCache: nextCache,
          messagesHydrated: { ...state.messagesHydrated, [sessionId]: true },
          isMessagesLoading: false,
          toolEvents: state.toolEvents.filter((event) => event.sessionId !== sessionId),
        }))
        normalized.forEach((msg) => {
          if (
            msg.role === 'assistant' &&
            msg.streamStatus === 'streaming' &&
            typeof msg.id === 'number'
          ) {
            startMessageProgressWatcher(sessionId, Number(msg.id))
          }
        })
        if (normalized.some((msg) => msg.streamStatus === 'streaming')) {
          set({ isStreaming: true })
        } else {
          recomputeStreamingState()
        }
      } catch (error: any) {
        set({
          error: error?.response?.data?.error || error?.message || '获取消息列表失败',
          isMessagesLoading: false,
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
      stopAllMessagePollers()
      set({ isSessionsLoading: true, error: null })
      try {
        const response = await apiClient.createSessionByModelId(modelId, title, connectionId, rawId)
        const newSession = response.data as ChatSession
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSession: newSession,
          messageMetas: [],
          messageBodies: {},
          messageRenderCache: {},
          messagesHydrated: { ...state.messagesHydrated, [newSession.id]: true },
          isMessagesLoading: false,
          isSessionsLoading: false,
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
      stopAllMessagePollers()
      const { sessions, messagesHydrated } = get()
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        const nextHydrated = { ...messagesHydrated }
        if (nextHydrated[sessionId]) {
          delete nextHydrated[sessionId]
        }
        set({
          currentSession: session,
          messageMetas: [],
          messageBodies: {},
          messageRenderCache: {},
          usageCurrent: null,
          usageLastRound: null,
          usageTotals: null,
          messagesHydrated: nextHydrated,
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

      const removeAssistantPlaceholder = () => {
        set((state) => {
          const key = messageKey(assistantPlaceholder.id)
          const metas = state.messageMetas.filter((meta) => meta.id !== assistantPlaceholder.id)
          const bodies = { ...state.messageBodies }
          delete bodies[key]
          const renderCache = { ...state.messageRenderCache }
          delete renderCache[key]
          return {
            messageMetas: metas,
            messageBodies: bodies,
            messageRenderCache: renderCache,
          }
        })
      }

      set((state) => {
        const nextCache =
          userMessage.clientMessageId && userMessage.images && userMessage.images.length > 0
            ? { ...state.messageImageCache, [userMessage.clientMessageId]: userMessage.images }
            : state.messageImageCache
        const metas = [
          ...state.messageMetas,
          createMeta(userMessage),
          createMeta(assistantPlaceholder, { isPlaceholder: true, streamStatus: 'streaming' }),
        ]
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
        clientMessageId: userClientMessageId,
        webSearchRequested: Boolean(options?.features?.web_search),
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

          if (evt?.type === 'start') {
            if (typeof evt.assistantMessageId === 'number') {
              const nextId = evt.assistantMessageId
              if (messageKey(active.assistantId) !== messageKey(nextId)) {
                const prevKey = messageKey(active.assistantId)
                const nextKey = messageKey(nextId)
                set((state) => {
                  const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === prevKey)
                  const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
                  if (metaIndex !== -1) {
                    nextMetas[metaIndex] = {
                      ...nextMetas[metaIndex],
                      id: nextId,
                      streamStatus: 'streaming',
                      isPlaceholder: false,
                    }
                  }
                  const prevBody = state.messageBodies[prevKey]
                  const nextBodies = { ...state.messageBodies }
                  if (prevBody) {
                    delete nextBodies[prevKey]
                    nextBodies[nextKey] = { ...prevBody, id: nextId }
                  }
                  const nextRenderCache = { ...state.messageRenderCache }
                  if (nextRenderCache[prevKey]) {
                    nextRenderCache[nextKey] = nextRenderCache[prevKey]
                    delete nextRenderCache[prevKey]
                  }
                  const partial: Partial<ChatState> = {}
                  if (metaIndex !== -1) partial.messageMetas = nextMetas
                  if (prevBody) partial.messageBodies = nextBodies
                  if (nextRenderCache[nextKey]) partial.messageRenderCache = nextRenderCache
                  return Object.keys(partial).length > 0 ? partial : state
                })
                active.assistantId = nextId
                assistantPlaceholder.id = nextId
              }
            }
            if (typeof evt.assistantClientMessageId === 'string') {
              active.assistantClientMessageId = evt.assistantClientMessageId
            }
            continue
          }

          if (evt?.type === 'tool') {
            set((state) => {
              const list = state.toolEvents.slice()
              const eventId = (evt.id as string) || `${sessionId}-${Date.now()}`
              const idx = list.findIndex((item) => item.id === eventId && item.sessionId === sessionId)
              const next: ToolEvent = {
                id: eventId,
                sessionId,
                messageId: active.assistantId,
                tool: (evt.tool as string) || 'web_search',
                stage: (evt.stage as 'start' | 'result' | 'error') || 'start',
                status:
                  evt.stage === 'error'
                    ? 'error'
                    : evt.stage === 'result'
                      ? 'success'
                      : 'running',
                query: evt.query as string | undefined,
                hits: (Array.isArray(evt.hits) ? evt.hits : undefined) as ToolEvent['hits'],
                error: evt.error as string | undefined,
                createdAt: idx === -1 ? Date.now() : list[idx].createdAt,
              }
              if (idx === -1) {
                list.push(next)
              } else {
                list[idx] = { ...list[idx], ...next }
              }
              return { toolEvents: list }
            })
            continue
          }

          if (evt?.type === 'error') {
            const fallback =
              typeof evt.error === 'string' && evt.error.trim()
                ? evt.error
                : '联网搜索失败，请稍后重试'
            const friendlyMessage = resolveProviderSafetyMessage(evt.error) ?? fallback
            const agentError = new Error(friendlyMessage)
            ;(agentError as any).handled = 'agent_error'
            updateMetaStreamStatus(active.assistantId, 'error', friendlyMessage)
            throw agentError
          }

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

        const completedAssistantId = streamState.active?.assistantId
        flushActiveStream(true)
        if (typeof completedAssistantId !== 'undefined' && completedAssistantId !== null) {
          updateMetaStreamStatus(completedAssistantId, 'done')
        }
        resetStreamState()
        recomputeStreamingState()
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

        if (error?.handled === 'agent_error') {
          const message =
            resolveProviderSafetyMessage(error) || error?.message || '联网搜索失败，请稍后重试'
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
          set({ error: message, isStreaming: false })
          removeAssistantPlaceholder()
          return
        }

        if (error?.status === 429) {
          const message = error?.payload?.error || '额度不足，请登录或等待次日重置'
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
          set({ error: message, isStreaming: false })
          removeAssistantPlaceholder()
          return
        }

        const providerSafetyMessage = resolveProviderSafetyMessage(error)
        if (providerSafetyMessage) {
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', providerSafetyMessage)
          set({ error: providerSafetyMessage, isStreaming: false })
          removeAssistantPlaceholder()
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
            updateMetaStreamStatus(assistantPlaceholder.id, 'done')
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
            updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
            set({ error: message, isStreaming: false })
            removeAssistantPlaceholder()
            return
          }

          const fallbackSafetyMessage = resolveProviderSafetyMessage(fallbackError)
          if (fallbackSafetyMessage) {
            updateMetaStreamStatus(assistantPlaceholder.id, 'error', fallbackSafetyMessage)
            set({ error: fallbackSafetyMessage, isStreaming: false })
            removeAssistantPlaceholder()
            return
          }
        }

        const genericError = resolveProviderSafetyMessage(error) || error?.message || '发送消息失败'
        updateMetaStreamStatus(assistantPlaceholder.id, 'error', genericError)
        set({
          error: genericError,
          isStreaming: false,
        })
        removeAssistantPlaceholder()
      }
    },

    stopStreaming: () => {
      const activeSessionId = streamState.active?.sessionId
      const activeClientMessageId = streamState.active?.clientMessageId
      const requestedWebSearch = streamState.active?.webSearchRequested
      const cancelledAssistantId = streamState.active?.assistantId
      if (activeSessionId && requestedWebSearch) {
        apiClient.cancelAgentStream(activeSessionId, activeClientMessageId).catch(() => {})
      }
      try {
        apiClient.cancelStream()
      } catch {
        // ignore
      }
      flushActiveStream(true)
      resetStreamState()
      set((state) => ({
        isStreaming: false,
        toolEvents: activeSessionId
          ? state.toolEvents.filter((event) => event.sessionId !== activeSessionId)
          : state.toolEvents,
      }))
      if (typeof cancelledAssistantId !== 'undefined' && cancelledAssistantId !== null) {
        updateMetaStreamStatus(cancelledAssistantId, 'cancelled', '已停止生成')
      }
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
