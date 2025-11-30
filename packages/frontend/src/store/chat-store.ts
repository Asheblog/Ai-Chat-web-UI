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
import { useModelsStore } from '@/store/models-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'

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
  lastUsage?: StreamUsageSnapshot | null
}

// 优化为实时刷新，支持逐字显示效果
// 原值: 70ms批量更新 -> 现值: 0ms立即更新
const STREAM_FLUSH_INTERVAL = 0

interface StreamUsageSnapshot {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  context_limit?: number | null
  context_remaining?: number | null
}

interface StreamCompletionSnapshot {
  sessionId: number
  messageId: number | null
  clientMessageId: string | null
  content: string
  reasoning: string
  usage?: StreamUsageSnapshot | null
  completedAt: number
}

const STREAM_SNAPSHOT_STORAGE_KEY = 'aichat:stream-completions'
const STREAM_SNAPSHOT_TTL_MS = 2 * 60 * 1000

type StreamSendOptions = {
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  ollamaThink?: boolean
  saveReasoning?: boolean
  features?: {
    web_search?: boolean
    web_search_scope?: string
    web_search_include_summary?: boolean
    web_search_include_raw?: boolean
    web_search_size?: number
  }
  replyToMessageId?: number | string
  replyToClientMessageId?: string
  traceEnabled?: boolean
  contextEnabled?: boolean
  clientMessageId?: string
  customBody?: Record<string, any>
  customHeaders?: Array<{ name: string; value: string }>
  streamKey?: string
}

const readCompletionSnapshots = (): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STREAM_SNAPSHOT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    const sanitized = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const sessionId = Number((item as any).sessionId)
        if (!Number.isFinite(sessionId)) return null
        const completedAt = Number((item as any).completedAt)
        if (!Number.isFinite(completedAt)) return null
        return {
          sessionId,
          messageId:
            typeof (item as any).messageId === 'number' && Number.isFinite((item as any).messageId)
              ? Number((item as any).messageId)
              : null,
          clientMessageId: typeof (item as any).clientMessageId === 'string'
            ? (item as any).clientMessageId
            : null,
          content: typeof (item as any).content === 'string' ? (item as any).content : '',
          reasoning: typeof (item as any).reasoning === 'string' ? (item as any).reasoning : '',
          usage: (item as any).usage && typeof (item as any).usage === 'object'
            ? (item as any).usage as StreamUsageSnapshot
            : undefined,
          completedAt,
        } as StreamCompletionSnapshot
      })
      .filter((item): item is StreamCompletionSnapshot => Boolean(item && now - item.completedAt <= STREAM_SNAPSHOT_TTL_MS))
    if (sanitized.length !== parsed.length) {
      window.sessionStorage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized))
    }
    return sanitized
  } catch {
    return []
  }
}

const writeCompletionSnapshots = (records: StreamCompletionSnapshot[]) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // ignore quota errors
  }
}

const persistCompletionSnapshot = (snapshot: StreamCompletionSnapshot) => {
  if (typeof window === 'undefined') return
  const entries = readCompletionSnapshots()
  const index = entries.findIndex((item) => {
    if (item.sessionId !== snapshot.sessionId) return false
    if (snapshot.messageId != null && item.messageId === snapshot.messageId) {
      return true
    }
    if (snapshot.messageId == null && item.messageId == null && snapshot.clientMessageId && item.clientMessageId) {
      return item.clientMessageId === snapshot.clientMessageId
    }
    return false
  })
  if (index === -1) {
    entries.push(snapshot)
  } else {
    entries[index] = snapshot
  }
  writeCompletionSnapshots(entries)
}

const removeCompletionSnapshot = (
  sessionId: number,
  opts: { messageId?: number | null; clientMessageId?: string | null },
) => {
  if (typeof window === 'undefined') return
  const entries = readCompletionSnapshots()
  const filtered = entries.filter((item) => {
    if (item.sessionId !== sessionId) return true
    if (opts.messageId != null && item.messageId === opts.messageId) {
      return false
    }
    if (
      opts.messageId == null &&
      item.messageId == null &&
      opts.clientMessageId &&
      item.clientMessageId === opts.clientMessageId
    ) {
      return false
    }
    return true
  })
  if (filtered.length !== entries.length) {
    writeCompletionSnapshots(filtered)
  }
}

const getSessionCompletionSnapshots = (sessionId: number): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  return readCompletionSnapshots().filter((item) => item.sessionId === sessionId)
}

const messageKey = (id: MessageId) => (typeof id === 'string' ? id : String(id))

interface ShareSelectionState {
  enabled: boolean
  sessionId: number | null
  selectedMessageIds: number[]
}

const createInitialShareSelection = (): ShareSelectionState => ({
  enabled: false,
  sessionId: null,
  selectedMessageIds: [],
})

const parseDateValue = (value: string | number | Date | null | undefined) => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const compareVariantMeta = (a: MessageMeta, b: MessageMeta) => {
  const aIndex = typeof a.variantIndex === 'number' ? a.variantIndex : null
  const bIndex = typeof b.variantIndex === 'number' ? b.variantIndex : null
  if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
    return aIndex - bIndex
  }
  const aTime = parseDateValue(a.createdAt)
  const bTime = parseDateValue(b.createdAt)
  if (aTime !== bTime) return aTime - bTime
  return messageKey(a.id).localeCompare(messageKey(b.id))
}

const buildVariantSelections = (metas: MessageMeta[]): Record<string, MessageId> => {
  const selections: Record<string, MessageId> = {}
  metas
    .filter((meta) => meta.role === 'assistant' && meta.parentMessageId != null)
    .sort(compareVariantMeta)
    .forEach((meta) => {
      const parentKey = messageKey(meta.parentMessageId!)
      selections[parentKey] = meta.id
    })
  return selections
}

const findSessionById = (
  sessions: ChatSession[],
  current: ChatSession | null,
  targetId: number,
): ChatSession | null => {
  const match = sessions.find((session) => session.id === targetId)
  if (match) return match
  if (current && current.id === targetId) return current
  return null
}

const findModelForSession = (session: ChatSession | null): ModelItem | null => {
  if (!session) return null
  const models = useModelsStore.getState().models
  if (!Array.isArray(models) || models.length === 0) return null
  const connectionId = session.connectionId ?? null
  const modelIdentifier = session.modelRawId ?? session.modelLabel ?? null
  if (!modelIdentifier) return null
  return (
    models.find((item) => {
      const matchesConnection = connectionId != null ? item.connectionId === connectionId : true
      if (!matchesConnection) return false
      return item.rawId === modelIdentifier || item.id === modelIdentifier
    }) ?? null
  )
}

const shouldEnableWebSearchForSession = (session: ChatSession | null): boolean => {
  if (!session) return false
  const systemSettings = useSettingsStore.getState().systemSettings
  if (!systemSettings?.webSearchAgentEnable) return false
  const model = findModelForSession(session)
  const modelSupportsWebSearch =
    typeof model?.capabilities?.web_search === 'boolean'
      ? model.capabilities.web_search
      : true
  if (!modelSupportsWebSearch) return false
  const preference = useWebSearchPreferenceStore.getState().lastSelection
  const userEnabled = typeof preference === 'boolean' ? preference : true
  return userEnabled
}

const getAssistantVariantLimit = () => {
  const settings = useSettingsStore.getState().systemSettings
  const raw = settings?.assistantReplyHistoryLimit
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(20, Math.floor(raw)))
  }
  return 5
}

const enforceVariantLimitLocally = (
  metas: MessageMeta[],
  parentToken: MessageId,
): { metas: MessageMeta[]; removedIds: MessageId[] } => {
  const limit = getAssistantVariantLimit()
  if (limit <= 0) {
    return { metas, removedIds: [] }
  }
  const parentKey = messageKey(parentToken)
  const variants = metas
    .filter(
      (meta) =>
        meta.role === 'assistant' &&
        meta.parentMessageId != null &&
        messageKey(meta.parentMessageId) === parentKey,
    )
    .sort(compareVariantMeta)
  if (variants.length <= limit) {
    return { metas, removedIds: [] }
  }
  const removeCount = variants.length - limit
  const toRemove = variants.slice(0, removeCount).map((meta) => meta.id)
  if (toRemove.length === 0) {
    return { metas, removedIds: [] }
  }
  const removeKeys = new Set(toRemove.map((id) => messageKey(id)))
  const nextMetas = metas.filter((meta) => !removeKeys.has(messageKey(meta.id)))
  return { metas: nextMetas, removedIds: toRemove }
}

const createMeta = (message: Message, overrides: Partial<MessageMeta> = {}): MessageMeta => ({
  id: message.id,
  sessionId: message.sessionId,
  role: message.role,
  createdAt: message.createdAt,
  clientMessageId: message.clientMessageId ?? null,
  parentMessageId:
    typeof (message as any).parentMessageId === 'number'
      ? (message as any).parentMessageId
      : null,
  variantIndex:
    typeof (message as any).variantIndex === 'number'
      ? (message as any).variantIndex
      : null,
  reasoningStatus: message.reasoningStatus,
  reasoningDurationSeconds: message.reasoningDurationSeconds ?? null,
  reasoningIdleMs: message.reasoningIdleMs ?? null,
  images: message.images,
  isPlaceholder: false,
  streamStatus: message.streamStatus ?? 'done',
  streamError: message.streamError ?? null,
  pendingSync: false,
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
  createSession: (modelId: string, title?: string, connectionId?: number, rawId?: string, systemPrompt?: string | null) => Promise<ChatSession | null>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  switchSessionModel: (sessionId: number, model: ModelItem) => Promise<void>
  updateSessionPrefs: (sessionId: number, prefs: Partial<{ reasoningEnabled: boolean; reasoningEffort: 'low'|'medium'|'high'; ollamaThink: boolean; systemPrompt: string | null }>) => Promise<void>
  sendMessage: (sessionId: number, content: string) => Promise<void>
  streamMessage: (
    sessionId: number,
    content: string,
    images?: Array<{ data: string; mime: string }>,
    options?: StreamSendOptions
  ) => Promise<void>
  stopStreaming: () => void
  addMessage: (message: Message) => void
  clearError: () => void
  applyRenderedContent: (
    messageId: MessageId,
    payload: { contentHtml?: string | null; reasoningHtml?: string | null; contentVersion?: number; reasoningVersion?: number }
  ) => void
  invalidateRenderedContent: (messageId?: MessageId) => void
  regenerateAssistantMessage: (messageId: MessageId) => Promise<void>
  cycleAssistantVariant: (parentKey: string, direction: 'prev' | 'next') => void
  enterShareSelectionMode: (sessionId: number, messageId?: number) => void
  toggleShareSelection: (sessionId: number, messageId: number) => void
  clearShareSelection: () => void
  exitShareSelectionMode: () => void
}

export const useChatStore = create<ChatStore>((set, get) => {
  type ActiveStreamEntry = StreamAccumulator & { streamKey: string; stopRequested: boolean }
  const activeStreams = new Map<string, ActiveStreamEntry>()
  const streamingPollers = new Map<number, ReturnType<typeof setInterval>>()

  const sessionStreamingUpdate = (sessionId: number, delta: number) => {
    if (!Number.isFinite(sessionId)) return
    set((state) => {
      const current = { ...(state.streamingSessions || {}) }
      const prev = current[sessionId] ?? 0
      const next = Math.max(0, prev + delta)
      if (next <= 0) {
        delete current[sessionId]
      } else {
        current[sessionId] = next
      }
      return {
        streamingSessions: current,
        activeStreamCount: activeStreams.size,
      }
    })
    recomputeStreamingState()
  }

  const registerActiveStream = (entry: ActiveStreamEntry) => {
    activeStreams.set(entry.streamKey, entry)
    sessionStreamingUpdate(entry.sessionId, 1)
  }

  const unregisterActiveStream = (streamKey: string) => {
    const entry = activeStreams.get(streamKey)
    if (!entry) return
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    activeStreams.delete(streamKey)
    sessionStreamingUpdate(entry.sessionId, -1)
  }

  const findStreamByAssistantId = (messageId: MessageId | null | undefined): ActiveStreamEntry | null => {
    if (typeof messageId === 'undefined' || messageId === null) return null
    const target = messageKey(messageId)
    for (const stream of activeStreams.values()) {
      if (messageKey(stream.assistantId) === target) {
        return stream
      }
    }
    return null
  }

  const findStreamByClientMessageId = (clientMessageId?: string | null): ActiveStreamEntry | null => {
    if (!clientMessageId) return null
    for (const stream of activeStreams.values()) {
      if (stream.clientMessageId && stream.clientMessageId === clientMessageId) {
        return stream
      }
      if (stream.assistantClientMessageId && stream.assistantClientMessageId === clientMessageId) {
        return stream
      }
    }
    return null
  }

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
    const currentSessionId = snapshot.currentSession?.id ?? null
    const streamingCounts = snapshot.streamingSessions || {}
    const activeForCurrent = currentSessionId ? streamingCounts[currentSessionId] ?? 0 : 0
    const hasStreamingMeta = snapshot.messageMetas.some(
      (meta) => meta.sessionId === currentSessionId && meta.streamStatus === 'streaming',
    )
    const shouldFlagCurrent = Boolean(currentSessionId) && (activeForCurrent > 0 || hasStreamingMeta)
    const nextActiveSessionId = shouldFlagCurrent ? currentSessionId : null
    const updates: Partial<ChatState> = {}
    if (snapshot.isStreaming !== shouldFlagCurrent) {
      updates.isStreaming = shouldFlagCurrent
    }
    if (snapshot.activeStreamSessionId !== nextActiveSessionId) {
      updates.activeStreamSessionId = nextActiveSessionId
    }
    if (Object.keys(updates).length > 0) {
      set(updates)
    }
  }

  const streamingFlagUpdate = (state: ChatState, sessionId: number | null, streaming: boolean): Partial<ChatState> => {
    if (streaming) {
      if (sessionId == null) return {}
      return {
        activeStreamSessionId: sessionId,
        isStreaming: state.currentSession?.id === sessionId,
      }
    }
    if (sessionId == null) {
      if (state.activeStreamSessionId == null && !state.isStreaming) {
        return {}
      }
      return { activeStreamSessionId: null, isStreaming: false }
    }
    if (state.activeStreamSessionId !== sessionId) {
      return {}
    }
    return {
      activeStreamSessionId: null,
      isStreaming: state.currentSession?.id === sessionId ? false : state.isStreaming,
    }
  }

  const applyBufferedSnapshots = (sessionId: number) => {
    if (typeof window === 'undefined') return
    const snapshots = getSessionCompletionSnapshots(sessionId)
    if (!snapshots.length) return
    set((state) => {
      const nextMetas = state.messageMetas.slice()
      const nextBodies = { ...state.messageBodies }
      const nextRenderCache = { ...state.messageRenderCache }
      let metaChanged = false
      let bodyChanged = false

      snapshots.forEach((snapshot) => {
        const idx = nextMetas.findIndex((meta) => {
          if (meta.sessionId !== sessionId) return false
          if (snapshot.messageId != null && Number(meta.id) === snapshot.messageId) {
            return true
          }
          if (
            snapshot.messageId == null &&
            meta.clientMessageId &&
            snapshot.clientMessageId &&
            meta.clientMessageId === snapshot.clientMessageId
          ) {
            return true
          }
          return false
        })
        if (idx === -1) return
        const meta = nextMetas[idx]
        if (meta.streamStatus === 'done' && !meta.pendingSync) {
          return
        }
        const key = messageKey(meta.id)
        const prevBody = ensureBody(nextBodies[key], meta.id)
        const contentChanged = Boolean(
          snapshot.content && snapshot.content !== prevBody.content,
        )
        const reasoningChanged = Boolean(
          snapshot.reasoning && snapshot.reasoning !== (prevBody.reasoning ?? ''),
        )

        nextBodies[key] = {
          id: prevBody.id,
          content: contentChanged ? snapshot.content : prevBody.content,
          reasoning: reasoningChanged ? snapshot.reasoning : prevBody.reasoning,
          version: prevBody.version + (contentChanged ? 1 : 0),
          reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
          toolEvents: prevBody.toolEvents,
        }
        delete nextRenderCache[key]

        nextMetas[idx] = {
          ...meta,
          streamStatus: 'done',
          streamError: null,
          isPlaceholder: false,
          pendingSync: true,
        }
        metaChanged = true
        bodyChanged = bodyChanged || contentChanged || reasoningChanged
      })

      if (!metaChanged && !bodyChanged) {
        return state
      }

      const partial: Partial<ChatState> = {
        messageBodies: nextBodies,
        messageRenderCache: nextRenderCache,
      }
      if (metaChanged) {
        partial.messageMetas = nextMetas
        partial.assistantVariantSelections = buildVariantSelections(nextMetas)
      }
      return partial
    })
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
                  pendingSync: false,
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
    removeCompletionSnapshot(message.sessionId, {
      messageId: typeof message.id === 'number' ? Number(message.id) : null,
      clientMessageId: message.clientMessageId ?? null,
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
      nextMetas[idx] = {
        ...nextMetas[idx],
        streamStatus: status,
        streamError: streamError ?? null,
        pendingSync: status === 'done' ? false : nextMetas[idx].pendingSync,
      }
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
    if (findStreamByAssistantId(messageId)) return
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
            get().fetchUsage(sessionId).catch(() => {})
            get().fetchSessionsUsage().catch(() => {})
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

  const flushStreamBuffer = (stream: ActiveStreamEntry | null, force = false) => {
    const active = stream
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
        partial.assistantVariantSelections = buildVariantSelections(nextMetas)
      }

      return partial
    })
  }

  const scheduleFlush = (stream: ActiveStreamEntry | null) => {
    if (!stream) return
    if (stream.flushTimer) return
    stream.flushTimer = setTimeout(() => {
      stream.flushTimer = null
      flushStreamBuffer(stream)
    }, STREAM_FLUSH_INTERVAL)
  }

  const clearActiveStream = (stream: ActiveStreamEntry | null) => {
    if (!stream) return
    unregisterActiveStream(stream.streamKey)
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
    activeStreamSessionId: null,
    streamingSessions: {},
    activeStreamCount: 0,
    error: null,
    usageCurrent: null,
    usageLastRound: null,
    usageTotals: null,
    sessionUsageTotalsMap: {} as Record<number, import('@/types').UsageTotals>,
    toolEvents: [],
    assistantVariantSelections: {},
    shareSelection: createInitialShareSelection(),

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
          assistantVariantSelections: buildVariantSelections(metas),
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
          set((state) => ({
            isStreaming: state.currentSession?.id === sessionId,
            activeStreamSessionId: sessionId,
          }))
        } else {
          set((state) =>
            state.activeStreamSessionId === sessionId
              ? { activeStreamSessionId: null, isStreaming: state.currentSession?.id === sessionId ? false : state.isStreaming }
              : state,
          )
          recomputeStreamingState()
        }
        applyBufferedSnapshots(sessionId)
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

    createSession: async (modelId: string, title?: string, connectionId?: number, rawId?: string, systemPrompt?: string | null) => {
      stopAllMessagePollers()
      set({ isSessionsLoading: true, error: null })
      try {
        const response = await apiClient.createSessionByModelId(modelId, title, connectionId, rawId, systemPrompt ?? undefined)
        const newSession = response.data as ChatSession
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSession: newSession,
          messageMetas: [],
          assistantVariantSelections: {},
          messageBodies: {},
          messageRenderCache: {},
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
      stopAllMessagePollers()
      const { sessions, messagesHydrated } = get()
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
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
          usageCurrent: null,
          usageLastRound: null,
          usageTotals: null,
          messagesHydrated: nextHydrated,
          isStreaming: state.activeStreamSessionId === session.id,
          shareSelection: createInitialShareSelection(),
        }))
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
            assistantVariantSelections: shouldClear ? {} : state.assistantVariantSelections,
            messageBodies: shouldClear ? {} : state.messageBodies,
            messageRenderCache: shouldClear ? {} : state.messageRenderCache,
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
        return true
      } catch (error: any) {
        set({ error: error?.response?.data?.error || error?.message || '更新会话偏好失败' })
        return false
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
      const replyToMessageId =
        typeof options?.replyToMessageId === 'number' || typeof options?.replyToMessageId === 'string'
          ? (options?.replyToMessageId as MessageId)
          : null
      const isRegenerate = replyToMessageId !== null
      let parentUserMeta: MessageMeta | null = null
      if (isRegenerate) {
        parentUserMeta =
          snapshot.messageMetas.find(
            (meta) =>
              meta.sessionId === sessionId &&
              meta.role === 'user' &&
              messageKey(meta.id) === messageKey(replyToMessageId!),
          ) ?? null
        if (!parentUserMeta) {
          set({ error: '未找到关联的用户消息，无法重新生成回答' })
          return
        }
      }

      if (!isRegenerate) {
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
      }

      const userClientMessageId =
        isRegenerate
          ? null
          : (() => {
              try {
                return (crypto as any)?.randomUUID?.() ?? ''
              } catch {
                return ''
              }
            })() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

      const now = new Date().toISOString()
      const baseId = Date.now()
      const userMessageId: number = baseId
      const assistantMessageId: number = baseId + 1
      const userMessage: Message | null = isRegenerate
        ? null
        : {
            id: userMessageId,
            sessionId,
            role: 'user',
            content,
            createdAt: now,
            clientMessageId: userClientMessageId || undefined,
            images: images?.length
              ? images.map((img) => `data:${img.mime};base64,${img.data}`)
              : undefined,
          }

      const settingsSnapshot = useSettingsStore.getState()
      const { contextEnabled } = settingsSnapshot
      const maxConcurrentStreams = Math.max(1, settingsSnapshot.systemSettings?.chatMaxConcurrentStreams ?? 1)
      const activeCountSnapshot = get().activeStreamCount ?? 0
      if (activeCountSnapshot >= maxConcurrentStreams) {
        set({
          error: `当前已有 ${activeCountSnapshot}/${maxConcurrentStreams} 个任务生成中，请稍后再试或先停止部分任务。`,
        })
        return
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

      const parentMessageId: MessageId | null = isRegenerate ? replyToMessageId : userMessage?.id ?? null
      const existingVariantCount = parentMessageId
        ? snapshot.messageMetas.filter(
            (meta) =>
              meta.role === 'assistant' &&
              meta.parentMessageId != null &&
              messageKey(meta.parentMessageId) === messageKey(parentMessageId),
          ).length
        : 0

      const assistantPlaceholder: Message = {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: now,
        parentMessageId: parentMessageId ?? undefined,
        variantIndex: parentMessageId ? existingVariantCount + 1 : undefined,
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
            assistantVariantSelections: buildVariantSelections(metas),
            messageBodies: bodies,
            messageRenderCache: renderCache,
          }
        })
      }

      set((state) => {
        const nextCache =
          !isRegenerate &&
          userMessage?.clientMessageId &&
          userMessage.images &&
          userMessage.images.length > 0
            ? { ...state.messageImageCache, [userMessage.clientMessageId]: userMessage.images }
            : state.messageImageCache
        const metas = [
          ...state.messageMetas,
          ...(userMessage ? [createMeta(userMessage)] : []),
          createMeta(assistantPlaceholder, { isPlaceholder: true, streamStatus: 'streaming' }),
        ]
        const bodies = {
          ...state.messageBodies,
          ...(userMessage ? { [messageKey(userMessage.id)]: createBody(userMessage) } : {}),
          [messageKey(assistantPlaceholder.id)]: createBody(assistantPlaceholder),
        }
        const renderCache = { ...state.messageRenderCache }
        delete renderCache[messageKey(assistantPlaceholder.id)]

        let limitedMetas = metas
        let removedVariantIds: MessageId[] = []
        if (parentMessageId != null) {
          const result = enforceVariantLimitLocally(metas, parentMessageId)
          limitedMetas = result.metas
          removedVariantIds = result.removedIds
        }
        removedVariantIds.forEach((id) => {
          const key = messageKey(id)
          delete bodies[key]
          delete renderCache[key]
        })

        return {
          messageMetas: limitedMetas,
          assistantVariantSelections: buildVariantSelections(limitedMetas),
          messageBodies: bodies,
          messageRenderCache: renderCache,
          messageImageCache: nextCache,
          isStreaming: state.currentSession?.id === sessionId,
          activeStreamSessionId: sessionId,
          error: null,
        }
      })

      const streamKey =
        (userClientMessageId && `client:${userClientMessageId}`) ||
        `assistant:${messageKey(assistantPlaceholder.id)}:${Date.now().toString(36)}`
      const streamEntry: ActiveStreamEntry = {
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
        clientMessageId: userClientMessageId ?? null,
        assistantClientMessageId: null,
        webSearchRequested: Boolean(options?.features?.web_search),
        lastUsage: null,
        streamKey,
        stopRequested: false,
      }
      registerActiveStream(streamEntry)

      const { replyToMessageId: _ignoredReply, replyToClientMessageId: _ignoredReplyClient, ...forwardOptions } =
        options || {}

      const startStream = () =>
        apiClient.streamChat(sessionId, content, isRegenerate ? undefined : images, {
          ...forwardOptions,
          contextEnabled,
          clientMessageId: userClientMessageId ?? undefined,
          streamKey,
          replyToMessageId:
            isRegenerate && typeof replyToMessageId === 'number' ? replyToMessageId : undefined,
          replyToClientMessageId: isRegenerate
            ? parentUserMeta?.clientMessageId ??
              (typeof replyToMessageId === 'string' ? replyToMessageId : undefined)
            : undefined,
        })

      try {
        const iterator = startStream()
        for await (const evt of iterator) {
          const active = activeStreams.get(streamEntry.streamKey)
          if (!active) break

          if (evt?.type === 'start') {
            // 如果后端回传了用户消息的真实 ID，用 clientMessageId 对应的占位消息做 ID 替换，避免后续 regen 404
            if (
              typeof evt.messageId === 'number' &&
              Number.isFinite(evt.messageId) &&
              active.clientMessageId
            ) {
              const realUserId = Number(evt.messageId)
              const clientId = active.clientMessageId
              const placeholderUserId =
                typeof userMessageId === 'number' && Number.isFinite(userMessageId)
                  ? userMessageId
                  : null

              set((state) => {
                const userMetaIdx = state.messageMetas.findIndex(
                  (meta) =>
                    meta.role === 'user' &&
                    meta.clientMessageId === clientId &&
                    meta.id !== realUserId,
                )
                if (userMetaIdx === -1) return state

                const prevMeta = state.messageMetas[userMetaIdx]
                const prevKey = messageKey(prevMeta.id)
                const nextKey = messageKey(realUserId)

                const nextMetas = state.messageMetas.slice()
                nextMetas[userMetaIdx] = {
                  ...prevMeta,
                  id: realUserId,
                }

                // 同步父子引用，确保重新生成时使用真实的用户消息 ID
                for (let i = 0; i < nextMetas.length; i += 1) {
                  const meta = nextMetas[i]
                  if (
                    meta.role === 'assistant' &&
                    meta.parentMessageId != null &&
                    messageKey(meta.parentMessageId) === prevKey
                  ) {
                    nextMetas[i] = { ...meta, parentMessageId: realUserId }
                  }
                }

                const nextBodies = { ...state.messageBodies }
                const prevBody = nextBodies[prevKey]
                if (prevBody) {
                  nextBodies[nextKey] = { ...prevBody, id: realUserId }
                  delete nextBodies[prevKey]
                }

                const nextRenderCache = { ...state.messageRenderCache }
                if (nextRenderCache[prevKey]) {
                  nextRenderCache[nextKey] = nextRenderCache[prevKey]
                  delete nextRenderCache[prevKey]
                }

                return {
                  messageMetas: nextMetas,
                  assistantVariantSelections: buildVariantSelections(nextMetas),
                  messageBodies: nextBodies,
                  messageRenderCache: nextRenderCache,
                }
              })

              if (assistantPlaceholder.parentMessageId === placeholderUserId) {
                assistantPlaceholder.parentMessageId = realUserId
              }
            }

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
                  if (metaIndex !== -1) {
                    partial.assistantVariantSelections = buildVariantSelections(nextMetas)
                  }
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
            scheduleFlush(active)
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
              scheduleFlush(active)
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

            scheduleFlush(active)
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
            if (active) {
              active.lastUsage = usage as StreamUsageSnapshot
            }
            continue
          }

          if (evt?.type === 'quota' && evt.quota) {
            useAuthStore.getState().updateQuota(evt.quota)
            continue
          }

          if (evt?.type === 'complete') {
            const activeBuffer = active
            if (activeBuffer) {
              activeBuffer.pendingMeta.reasoningStatus = 'done'
            }
            scheduleFlush(active)
            continue
          }
        }

        const finalStream = activeStreams.get(streamEntry.streamKey) ?? null
        const completedSnapshot = finalStream
          ? {
              assistantId: finalStream.assistantId,
              assistantClientMessageId: finalStream.assistantClientMessageId ?? finalStream.clientMessageId,
              content: finalStream.content,
              reasoning: finalStream.reasoning,
              usage: finalStream.lastUsage,
              sessionId,
            }
          : null
        const completedAssistantId =
          typeof finalStream?.assistantId !== 'undefined' ? finalStream?.assistantId : null
        flushStreamBuffer(finalStream, true)
        if (
          completedSnapshot &&
          (completedSnapshot.content.length > 0 || completedSnapshot.reasoning.length > 0)
        ) {
          persistCompletionSnapshot({
            sessionId: completedSnapshot.sessionId,
            messageId:
              typeof completedSnapshot.assistantId === 'number'
                ? Number(completedSnapshot.assistantId)
                : null,
            clientMessageId:
              typeof completedSnapshot.assistantClientMessageId === 'string'
                ? completedSnapshot.assistantClientMessageId
                : null,
            content: completedSnapshot.content,
            reasoning: completedSnapshot.reasoning,
            usage: completedSnapshot.usage,
            completedAt: Date.now(),
          })
        }
        if (typeof completedAssistantId !== 'undefined' && completedAssistantId !== null) {
          updateMetaStreamStatus(completedAssistantId, 'done')
        }
        clearActiveStream(finalStream)
        recomputeStreamingState()
        set((state) => streamingFlagUpdate(state, sessionId, false))
        get().fetchUsage(sessionId).catch(() => {})
        get().fetchSessionsUsage().catch(() => {})
      } catch (error: any) {
        const interruptedContext = activeStreams.get(streamEntry.streamKey) ?? null
        const manualStopRequested = interruptedContext?.stopRequested ?? false
        flushStreamBuffer(interruptedContext, true)
        clearActiveStream(interruptedContext)
        recomputeStreamingState()

        const quotaPayload = error?.payload?.quota ?? null
        if (quotaPayload) {
          useAuthStore.getState().updateQuota(quotaPayload)
        }

        const isStreamIncomplete =
          error?.code === 'STREAM_INCOMPLETE' ||
          (typeof error?.message === 'string' && error.message.includes('Stream closed before completion'))
        const isAbortError =
          error?.name === 'AbortError' ||
          error?.code === 20 ||
          (typeof error?.message === 'string' && error.message.toLowerCase().includes('aborted'))

        const trySyncFinalResult = async (): Promise<boolean> => {
          const candidates = [
            interruptedContext?.assistantClientMessageId ?? null,
            interruptedContext?.clientMessageId ?? null,
            userClientMessageId ?? null,
          ]
          const seen = new Set<string>()
          for (const candidate of candidates) {
            if (typeof candidate !== 'string') continue
            const trimmed = candidate.trim()
            if (!trimmed || seen.has(trimmed)) continue
            seen.add(trimmed)
            try {
              const res = await apiClient.getMessageByClientId(sessionId, trimmed)
              const serverMessage = res?.data?.message
              if (serverMessage) {
                const merged = mergeImages(serverMessage, get().messageImageCache)
                applyServerMessageSnapshot(merged)
                if (typeof merged.id === 'number') {
                  updateMetaStreamStatus(merged.id, merged.streamStatus ?? 'done')
                }
                set((state) => streamingFlagUpdate(state, sessionId, false))
                get().fetchUsage(sessionId).catch(() => {})
                get().fetchSessionsUsage().catch(() => {})
                return true
              }
            } catch (syncError: any) {
              if (syncError?.response?.status === 404) {
                continue
              }
              if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.debug('[streamMessage] sync failure', syncError?.message || syncError)
              }
            }
          }
          return false
        }

        const recoverInterruptedStream = async () => {
          const synced = await trySyncFinalResult()
          if (synced) {
            return true
          }
          const messageId =
            typeof interruptedContext?.assistantId === 'number'
              ? interruptedContext.assistantId
              : typeof assistantPlaceholder.id === 'number'
                ? assistantPlaceholder.id
                : null
          if (messageId !== null) {
            startMessageProgressWatcher(sessionId, messageId)
          }
          set((state) => streamingFlagUpdate(state, sessionId, false))
          return true
        }

        if (isAbortError) {
          if (manualStopRequested) {
            return
          }
          await recoverInterruptedStream()
          return
        }

        if (isStreamIncomplete) {
          await recoverInterruptedStream()
          return
        }

        if (error?.handled === 'agent_error') {
          const message =
            resolveProviderSafetyMessage(error) || error?.message || '联网搜索失败，请稍后重试'
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
          set((state) => ({
            error: message,
            ...streamingFlagUpdate(state, sessionId, false),
          }))
          removeAssistantPlaceholder()
          return
        }

        if (error?.status === 429) {
          const message = error?.payload?.error || '额度不足，请登录或等待次日重置'
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
          set((state) => ({
            error: message,
            ...streamingFlagUpdate(state, sessionId, false),
          }))
          removeAssistantPlaceholder()
          return
        }

        const providerSafetyMessage = resolveProviderSafetyMessage(error)
        if (providerSafetyMessage) {
          updateMetaStreamStatus(assistantPlaceholder.id, 'error', providerSafetyMessage)
          set((state) => ({
            error: providerSafetyMessage,
            ...streamingFlagUpdate(state, sessionId, false),
          }))
          removeAssistantPlaceholder()
          return
        }

        const synced = await trySyncFinalResult()
        if (synced) {
          return
        }

        const genericError = resolveProviderSafetyMessage(error) || error?.message || '发送消息失败'
        updateMetaStreamStatus(assistantPlaceholder.id, 'error', genericError)
        set((state) => ({
          error: genericError,
          ...streamingFlagUpdate(state, sessionId, false),
        }))
        removeAssistantPlaceholder()
      }
    },

    stopStreaming: () => {
      const snapshot = get()
      const currentSessionId = snapshot.currentSession?.id ?? null
      const targets = Array.from(activeStreams.values()).filter((stream) =>
        currentSessionId ? stream.sessionId === currentSessionId : true,
      )

      if (targets.length > 0) {
        targets.forEach((stream) => {
          stream.stopRequested = true
          if (stream.sessionId && (stream.clientMessageId || stream.assistantId)) {
            apiClient
              .cancelAgentStream(stream.sessionId, {
                clientMessageId: stream.clientMessageId ?? stream.assistantClientMessageId ?? undefined,
                messageId:
                  typeof stream.assistantId === 'number' ? Number(stream.assistantId) : undefined,
              })
              .catch(() => {})
          }
          try {
            apiClient.cancelStream(stream.streamKey)
          } catch {
            // ignore
          }
          flushStreamBuffer(stream, true)
          clearActiveStream(stream)
          if (typeof stream.assistantId === 'number') {
            updateMetaStreamStatus(stream.assistantId, 'cancelled', '已停止生成')
          }
        })
        set((state) => ({
          ...streamingFlagUpdate(state, currentSessionId, false),
          toolEvents: currentSessionId
            ? state.toolEvents.filter((event) => event.sessionId !== currentSessionId)
            : state.toolEvents,
        }))
        return
      }

      const streamingMeta =
        snapshot.messageMetas.find(
          (meta) => meta.role === 'assistant' && meta.streamStatus === 'streaming',
        ) ?? null
      const fallbackAssistantId =
        typeof streamingMeta?.id === 'number' ? streamingMeta.id : null
      const fallbackClientId = streamingMeta?.clientMessageId ?? null
      if (currentSessionId && (fallbackAssistantId || fallbackClientId)) {
        apiClient
          .cancelAgentStream(currentSessionId, {
            clientMessageId: fallbackClientId ?? undefined,
            messageId: fallbackAssistantId ?? undefined,
          })
          .catch(() => {})
        if (fallbackAssistantId != null) {
          updateMetaStreamStatus(fallbackAssistantId, 'cancelled', '已停止生成')
        }
        set((state) => ({
          ...streamingFlagUpdate(state, currentSessionId, false),
          toolEvents: state.toolEvents.filter((event) => event.sessionId !== currentSessionId),
        }))
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

    regenerateAssistantMessage: async (messageId: MessageId) => {
      const snapshot = get()
      if (snapshot.isStreaming) {
        set({ error: '正在生成新的回答，请稍后重试' })
        return
      }
      const meta = snapshot.messageMetas.find(
        (item) => messageKey(item.id) === messageKey(messageId),
      )
      if (!meta || meta.role !== 'assistant' || meta.parentMessageId == null) {
        set({ error: '无法重新生成该回答' })
        return
      }
      const parentKey = messageKey(meta.parentMessageId)
      const parentMeta =
        snapshot.messageMetas.find(
          (item) =>
            item.sessionId === meta.sessionId &&
            item.role === 'user' &&
            messageKey(item.id) === parentKey,
        ) ?? null
      const targetSession = findSessionById(snapshot.sessions, snapshot.currentSession, meta.sessionId)
      const shouldRequestWebSearch = shouldEnableWebSearchForSession(targetSession)
      await snapshot.streamMessage(meta.sessionId, '', undefined, {
        replyToMessageId: typeof meta.parentMessageId === 'number' ? meta.parentMessageId : undefined,
        replyToClientMessageId:
          parentMeta?.clientMessageId ??
          (typeof meta.parentMessageId === 'string' ? meta.parentMessageId : undefined),
        features: shouldRequestWebSearch ? { web_search: true } : undefined,
      })
    },

    cycleAssistantVariant: (parentKey: string, direction: 'prev' | 'next') => {
      set((state) => {
        if (!parentKey) return state
        const variants = state.messageMetas
          .filter(
            (meta) =>
              meta.role === 'assistant' &&
              meta.parentMessageId != null &&
              messageKey(meta.parentMessageId) === parentKey,
          )
          .sort(compareVariantMeta)
        if (variants.length <= 1) {
          return state
        }
        const currentSelection = state.assistantVariantSelections[parentKey]
        let idx = variants.findIndex(
          (meta) => messageKey(meta.id) === messageKey(currentSelection ?? variants[variants.length - 1].id),
        )
        if (idx === -1) {
          idx = variants.length - 1
        }
        const delta = direction === 'next' ? 1 : -1
        const nextIndex = (idx + delta + variants.length) % variants.length
        const nextVariant = variants[nextIndex]
        return {
          assistantVariantSelections: {
            ...state.assistantVariantSelections,
            [parentKey]: nextVariant.id,
          },
        }
      })
    },

    enterShareSelectionMode: (sessionId: number, messageId?: number) => {
      if (!Number.isFinite(sessionId)) return
      set((state) => {
        const keepExisting = state.shareSelection.enabled && state.shareSelection.sessionId === sessionId
        const nextIds = keepExisting ? [...state.shareSelection.selectedMessageIds] : []
        if (typeof messageId === 'number' && Number.isFinite(messageId) && !nextIds.includes(messageId)) {
          nextIds.push(messageId)
        }
        return {
          shareSelection: {
            enabled: true,
            sessionId,
            selectedMessageIds: nextIds,
          },
        }
      })
    },

    toggleShareSelection: (sessionId: number, messageId: number) => {
      if (!Number.isFinite(sessionId) || !Number.isFinite(messageId)) return
      set((state) => {
        if (!state.shareSelection.enabled || state.shareSelection.sessionId !== sessionId) {
          return {}
        }
        const exists = state.shareSelection.selectedMessageIds.includes(messageId)
        const nextIds = exists
          ? state.shareSelection.selectedMessageIds.filter((id) => id !== messageId)
          : [...state.shareSelection.selectedMessageIds, messageId]
        return {
          shareSelection: {
            ...state.shareSelection,
            selectedMessageIds: nextIds,
          },
        }
      })
    },

    clearShareSelection: () => {
      set((state) => {
        if (!state.shareSelection.enabled || state.shareSelection.selectedMessageIds.length === 0) {
          return {}
        }
        return {
          shareSelection: {
            ...state.shareSelection,
            selectedMessageIds: [],
          },
        }
      })
    },

    exitShareSelectionMode: () => {
      set({ shareSelection: createInitialShareSelection() })
    },
  }
})
