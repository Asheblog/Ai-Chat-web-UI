import { useModelsStore } from '@/store/models-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import type {
  ChatSession,
  Message,
  MessageBody,
  MessageMeta,
  MessageRenderCacheEntry,
  ToolEvent,
} from '@/types'
import type { ModelItem } from '@/store/models-store'
import type { MessageId } from '../types'

export const STREAM_FLUSH_INTERVAL = 0
export const STREAM_SNAPSHOT_STORAGE_KEY = 'aichat:stream-completions'
export const STREAM_SNAPSHOT_TTL_MS = 30 * 60 * 1000

export const messageKey = (id: MessageId) => (typeof id === 'string' ? id : String(id))

export const generateLocalStableKey = () =>
  `local:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`

export const resolveStableKey = (
  source: { id: MessageId; clientMessageId?: string | null; stableKey?: string | null },
  override?: string | null,
): string => {
  const preferred = typeof override === 'string' && override.trim().length > 0 ? override.trim() : null
  if (preferred) return preferred
  if (typeof source.stableKey === 'string' && source.stableKey.trim().length > 0) {
    return source.stableKey.trim()
  }
  const clientId = typeof source.clientMessageId === 'string' ? source.clientMessageId.trim() : ''
  if (clientId) {
    return `client:${clientId}`
  }
  const numeric = typeof source.id === 'string' ? source.id : String(source.id)
  return `msg:${numeric}`
}

export const createInitialShareSelection = () => ({
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

export const buildVariantSelections = (metas: MessageMeta[]): Record<string, MessageId> => {
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

export const findSessionById = (
  sessions: ChatSession[],
  current: ChatSession | null,
  targetId: number,
): ChatSession | null => {
  const match = sessions.find((session) => session.id === targetId)
  if (match) return match
  if (current && current.id === targetId) return current
  return null
}

export const findModelForSession = (session: ChatSession | null): ModelItem | null => {
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

export const shouldEnableWebSearchForSession = (session: ChatSession | null): boolean => {
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

export const shouldEnablePythonToolForSession = (session: ChatSession | null): boolean => {
  if (!session) return false
  const systemSettings = useSettingsStore.getState().systemSettings
  if (!systemSettings?.pythonToolEnable) return false
  const model = findModelForSession(session)
  if (!model) return false
  const provider = (model.provider || '').toLowerCase()
  if (provider && provider !== 'openai' && provider !== 'azure_openai') {
    return false
  }
  const pythonCapable =
    typeof model.capabilities?.code_interpreter === 'boolean'
      ? model.capabilities.code_interpreter
      : true
  if (!pythonCapable) return false
  const preference = usePythonToolPreferenceStore.getState().lastSelection
  return typeof preference === 'boolean' ? preference : false
}

const getAssistantVariantLimit = () => {
  const settings = useSettingsStore.getState().systemSettings
  const raw = settings?.assistantReplyHistoryLimit
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(20, Math.floor(raw)))
  }
  return 5
}

export const enforceVariantLimitLocally = (
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

export const createMeta = (message: Message, overrides: Partial<MessageMeta> = {}): MessageMeta => {
  const stableKey = resolveStableKey(
    { id: message.id, clientMessageId: message.clientMessageId ?? null, stableKey: message.stableKey ?? null },
    overrides.stableKey,
  )
  return {
    id: message.id,
    sessionId: message.sessionId,
    stableKey,
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
    stableKey: overrides.stableKey ?? stableKey,
  }
}

export const createBody = (message: Message, stableKeyOverride?: string | null): MessageBody => {
  const stableKey = resolveStableKey(
    { id: message.id, clientMessageId: message.clientMessageId ?? null, stableKey: message.stableKey ?? null },
    stableKeyOverride,
  )
  const reasoningText = message.reasoning ?? message.streamReasoning ?? ''
  return {
    id: message.id,
    stableKey,
    content: message.content || '',
    reasoning: reasoningText,
    reasoningPlayedLength: reasoningText.length || undefined,
    version: message.content ? 1 : 0,
    reasoningVersion: message.reasoning || message.streamReasoning ? 1 : 0,
    toolEvents: normalizeToolEvents(message),
  }
}

export const ensureBody = (body: MessageBody | undefined, id: MessageId, stableKey: string): MessageBody =>
  body ?? { id, stableKey, content: '', reasoning: '', reasoningPlayedLength: 0, version: 0, reasoningVersion: 0 }

export const mergeImages = (message: Message, cache: Record<string, string[]>): Message => {
  const serverImages = Array.isArray(message.images) ? message.images : []
  if (serverImages.length > 0) {
    return { ...message, images: serverImages }
  }
  if (message.clientMessageId && cache[message.clientMessageId]) {
    return { ...message, images: cache[message.clientMessageId] }
  }
  return message
}

export const inferToolStatus = (stage: ToolEvent['stage']): ToolEvent['status'] => {
  if (stage === 'result') return 'success'
  if (stage === 'error') return 'error'
  return 'running'
}

export const normalizeToolEvents = (message: Message): ToolEvent[] => {
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
      summary: typeof evt.summary === 'string' ? evt.summary : undefined,
      hits: Array.isArray(evt.hits) ? evt.hits : undefined,
      error: evt.error,
      createdAt,
      details:
        evt && typeof (evt as any).details === 'object'
          ? { ...(evt as any).details }
          : undefined,
    }
  })
}

export const mergeToolEventsForMessage = (
  existing: ToolEvent[],
  sessionId: number,
  messageId: MessageId,
  replacements: ToolEvent[],
): ToolEvent[] => {
  if (!Array.isArray(replacements) || replacements.length === 0) return existing
  const assistantKey = messageKey(messageId)
  const normalized = replacements.map((event) => ({
    ...event,
    sessionId,
    messageId,
    status: event.status ?? inferToolStatus(event.stage),
    details: event.details ? { ...event.details } : undefined,
  }))
  const filtered = existing.filter(
    (event) =>
      event.sessionId !== sessionId || messageKey(event.messageId) !== assistantKey,
  )
  return [...filtered, ...normalized]
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

export const resolveProviderSafetyMessage = (error: unknown): string | null => {
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

export const buildRenderCacheEntry = (
  body: MessageBody,
  payload: {
    contentHtml?: string | null
    reasoningHtml?: string | null
    contentVersion?: number
    reasoningVersion?: number
  },
): MessageRenderCacheEntry => ({
  contentHtml: payload.contentHtml ?? null,
  reasoningHtml: payload.reasoningHtml ?? null,
  contentVersion: payload.contentVersion ?? body.version,
  reasoningVersion: payload.reasoningVersion ?? body.reasoningVersion,
  updatedAt: Date.now(),
})
