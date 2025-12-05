import { getMessageProgress } from '@/features/chat/api'
import type {
  ChatState,
  Message,
  MessageBody,
  MessageMeta,
  MessageStreamMetrics,
  ToolEvent,
} from '@/types'
import {
  buildVariantSelections,
  createBody,
  createMeta,
  ensureBody,
  inferToolStatus,
  mergeToolEventsForMessage,
  messageKey,
  normalizeToolEvents,
  STREAM_FLUSH_INTERVAL,
  STREAM_SNAPSHOT_STORAGE_KEY,
  STREAM_SNAPSHOT_TTL_MS,
} from './utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
  MessageId,
  StreamCompletionSnapshot,
} from './types'

const getSnapshotStorages = (): Storage[] => {
  if (typeof window === 'undefined') return []
  const storages: Storage[] = []
  try {
    if (window.localStorage) storages.push(window.localStorage)
  } catch {
    // ignore
  }
  try {
    if (window.sessionStorage) storages.push(window.sessionStorage)
  } catch {
    // ignore
  }
  return storages
}

const readCompletionSnapshots = (): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  const storages = getSnapshotStorages()
  if (storages.length === 0) return []
  try {
    const targetStorage = storages[0] ?? null
    let parsed: any[] | null = null
    let sourceStorage: Storage | null = null
    for (const storage of storages) {
      const raw = storage.getItem(STREAM_SNAPSHOT_STORAGE_KEY)
      if (raw) {
        parsed = JSON.parse(raw)
        sourceStorage = storage
        break
      }
    }
    if (!parsed) return []
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    const sanitized = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const sessionId = Number((item as any).sessionId)
        if (!Number.isFinite(sessionId)) return null
        const completedAt = Number((item as any).completedAt)
        if (!Number.isFinite(completedAt)) return null
        const reasoningText = typeof (item as any).reasoning === 'string' ? (item as any).reasoning : ''
        const rawPlayed = Number((item as any).reasoningPlayedLength)
        const reasoningPlayedLength =
          Number.isFinite(rawPlayed) && rawPlayed > 0 ? Math.min(rawPlayed, reasoningText.length) : undefined
        const normalizeMetricNumber = (value: any) => {
          const n = Number(value)
          return Number.isFinite(n) ? n : null
        }
        const metricsRaw = (item as any).metrics
        const metrics =
          metricsRaw && typeof metricsRaw === 'object'
            ? ({
                firstTokenLatencyMs: normalizeMetricNumber((metricsRaw as any).firstTokenLatencyMs),
                responseTimeMs: normalizeMetricNumber((metricsRaw as any).responseTimeMs),
                tokensPerSecond: normalizeMetricNumber((metricsRaw as any).tokensPerSecond),
                promptTokens: normalizeMetricNumber((metricsRaw as any).promptTokens),
                completionTokens: normalizeMetricNumber((metricsRaw as any).completionTokens),
                totalTokens: normalizeMetricNumber((metricsRaw as any).totalTokens),
              } satisfies MessageStreamMetrics)
            : null
        const hasMetricValue = metrics
          ? Object.values(metrics).some((value) => typeof value === 'number')
          : false
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
          reasoning: reasoningText,
          reasoningPlayedLength,
          usage: (item as any).usage && typeof (item as any).usage === 'object'
            ? ((item as any).usage as StreamCompletionSnapshot['usage'])
            : undefined,
          toolEvents: Array.isArray((item as any).toolEvents)
            ? ((item as any).toolEvents as ToolEvent[])
            : undefined,
          reasoningStatus:
            typeof (item as any).reasoningStatus === 'string'
              ? ((item as any).reasoningStatus as MessageMeta['reasoningStatus'])
              : undefined,
          streamStatus:
            typeof (item as any).streamStatus === 'string'
              ? ((item as any).streamStatus as MessageMeta['streamStatus'])
              : undefined,
          completedAt,
          metrics: hasMetricValue ? metrics : null,
        } as StreamCompletionSnapshot
      })
      .filter((item): item is StreamCompletionSnapshot => Boolean(item && now - item.completedAt <= STREAM_SNAPSHOT_TTL_MS))
    if (sanitized.length !== parsed.length && sourceStorage) {
      sourceStorage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized))
    }
    if (targetStorage && sourceStorage && targetStorage !== sourceStorage) {
      targetStorage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized))
    }
    return sanitized
  } catch {
    return []
  }
}

const writeCompletionSnapshots = (records: StreamCompletionSnapshot[]) => {
  if (typeof window === 'undefined') return
  const storages = getSnapshotStorages()
  const storage = storages[0]
  if (!storage) return
  try {
    storage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // ignore quota errors
  }
}

export const snapshotDebug = (...args: any[]) => {
  if (process.env.NODE_ENV === 'production') return
  // eslint-disable-next-line no-console
  console.debug('[snapshot]', ...args)
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
    snapshotDebug('persist:new', {
      sessionId: snapshot.sessionId,
      messageId: snapshot.messageId,
      clientMessageId: snapshot.clientMessageId,
      streamStatus: snapshot.streamStatus,
      reasoningStatus: snapshot.reasoningStatus,
      toolEvents: snapshot.toolEvents?.length ?? 0,
      reasoningPlayedLength: snapshot.reasoningPlayedLength,
    })
  } else {
    const existing = entries[index]
    entries[index] = {
      ...existing,
      ...snapshot,
      content: snapshot.content || existing.content,
      reasoning: snapshot.reasoning || existing.reasoning,
      toolEvents: snapshot.toolEvents ?? existing.toolEvents,
      reasoningStatus: snapshot.reasoningStatus ?? existing.reasoningStatus,
      streamStatus: snapshot.streamStatus ?? existing.streamStatus,
      metrics: snapshot.metrics ?? existing.metrics,
      reasoningPlayedLength:
        typeof snapshot.reasoningPlayedLength === 'number'
          ? snapshot.reasoningPlayedLength
          : existing.reasoningPlayedLength,
    }
    snapshotDebug('persist:update', {
      sessionId: snapshot.sessionId,
      messageId: snapshot.messageId,
      clientMessageId: snapshot.clientMessageId,
      streamStatus: entries[index].streamStatus,
      reasoningStatus: entries[index].reasoningStatus,
      toolEvents: entries[index].toolEvents?.length ?? 0,
      reasoningPlayedLength: entries[index].reasoningPlayedLength,
    })
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

export const createChatStoreRuntime = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
): ChatStoreRuntime => {
  const activeStreams = new Map<string, ActiveStreamEntry>()
  const streamingPollers = new Map<number, ReturnType<typeof setInterval>>()
  const activeWatchers = new Set<number>()

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

  const persistSnapshotForStream = (stream: ActiveStreamEntry | null) => {
    if (!stream) return
    const assistantKey = messageKey(stream.assistantId)
    const state = get()
    const body = state.messageBodies[assistantKey]
    const meta = state.messageMetas.find((item) => messageKey(item.id) === assistantKey)
    const toolEventsForMessage = state.toolEvents.filter(
      (event) =>
        event.sessionId === stream.sessionId && messageKey(event.messageId) === assistantKey,
    )
    const contentPayload = body?.content ?? stream.content ?? ''
    const reasoningPayload = body?.reasoning ?? stream.reasoning ?? ''
    const reasoningPlayedLength =
      body?.reasoningPlayedLength ??
      stream.reasoningPlayedLength ??
      (reasoningPayload ? reasoningPayload.length : undefined)
    snapshotDebug('persist:prepare', {
      sessionId: stream.sessionId,
      assistantId: stream.assistantId,
      contentLength: contentPayload?.length ?? 0,
      reasoningLength: reasoningPayload?.length ?? 0,
      reasoningPlayedLength,
      toolEvents: toolEventsForMessage.length,
    })
    if (!contentPayload && !reasoningPayload && toolEventsForMessage.length === 0) {
      snapshotDebug('persist:skip', {
        sessionId: stream.sessionId,
        assistantId: stream.assistantId,
        reason: 'empty',
      })
      return
    }
    const resolvedStreamStatus = meta?.streamStatus ?? 'streaming'
    const resolvedReasoningStatus =
      meta?.reasoningStatus ?? (stream.reasoningActivated ? 'streaming' : undefined)
    const resolvedClientId =
      stream.assistantClientMessageId ??
      (typeof stream.assistantId === 'string' ? stream.assistantId : null) ??
      stream.clientMessageId ??
      null
    persistCompletionSnapshot({
      sessionId: stream.sessionId,
      messageId:
        typeof stream.assistantId === 'number' && Number.isFinite(stream.assistantId)
          ? Number(stream.assistantId)
          : null,
      clientMessageId: resolvedClientId,
      content: contentPayload,
      reasoning: reasoningPayload,
      reasoningPlayedLength:
        typeof reasoningPlayedLength === 'number' ? reasoningPlayedLength : undefined,
      toolEvents: toolEventsForMessage,
      reasoningStatus: resolvedReasoningStatus,
      streamStatus: resolvedStreamStatus,
      completedAt: Date.now(),
    })
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
    snapshotDebug('apply:start', { sessionId, total: snapshots.length })
    set((state) => {
      const metaIndexByMessageKey = new Map<string, number>()
      const metaIndexByClientId = new Map<string, number>()
      state.messageMetas.forEach((meta, index) => {
        if (meta.sessionId !== sessionId) return
        metaIndexByMessageKey.set(messageKey(meta.id), index)
        if (meta.clientMessageId) {
          metaIndexByClientId.set(meta.clientMessageId, index)
        }
      })
      if (metaIndexByMessageKey.size === 0 && metaIndexByClientId.size === 0) {
        return state
      }

      let nextMetas = state.messageMetas
      let nextBodies = state.messageBodies
      let nextRenderCache = state.messageRenderCache
      let nextToolEvents = state.toolEvents
      let nextMetrics = state.messageMetrics || {}
      let metasMutated = false
      let bodiesMutated = false
      let renderCacheMutated = false
      let toolEventsMutated = false
      let metricsMutated = false

      const ensureMetas = () => {
        if (!metasMutated) {
          nextMetas = state.messageMetas.slice()
          metasMutated = true
        }
        return nextMetas
      }
      const ensureMetrics = () => {
        if (!metricsMutated) {
          nextMetrics = { ...(state.messageMetrics || {}) }
          metricsMutated = true
        }
        return nextMetrics
      }
      const ensureBodies = () => {
        if (!bodiesMutated) {
          nextBodies = { ...state.messageBodies }
          bodiesMutated = true
        }
        return nextBodies
      }
      const ensureRenderCache = () => {
        if (!renderCacheMutated) {
          nextRenderCache = { ...state.messageRenderCache }
          renderCacheMutated = true
        }
        return nextRenderCache
      }

      snapshots.forEach((snapshot) => {
        let metaIndex = -1
        if (snapshot.messageId != null) {
          metaIndex = metaIndexByMessageKey.get(messageKey(snapshot.messageId)) ?? -1
        }
        if (metaIndex === -1 && snapshot.messageId == null && snapshot.clientMessageId) {
          metaIndex = metaIndexByClientId.get(snapshot.clientMessageId) ?? -1
        }
        if (metaIndex === -1) return
        const meta = nextMetas[metaIndex]
        if (!meta) return
        snapshotDebug('apply:match', {
          sessionId,
          metaId: meta.id,
          snapshotMessageId: snapshot.messageId,
          toolEvents: snapshot.toolEvents?.length ?? 0,
          streamStatus: snapshot.streamStatus,
        })
        if (meta.streamStatus === 'done' && !meta.pendingSync) {
          return
        }

        const key = messageKey(meta.id)
        const prevBody = ensureBody(nextBodies[key], meta.id, meta.stableKey)
        const snapshotContent = snapshot.content || ''
        const snapshotReasoning = snapshot.reasoning || ''
        const contentChanged = snapshotContent.length > 0 && snapshotContent !== prevBody.content
        const reasoningChanged =
          snapshotReasoning.length > 0 && snapshotReasoning !== (prevBody.reasoning ?? '')
        const prevReasoningText = prevBody.reasoning ?? ''
        const prevPlayedLength =
          typeof prevBody.reasoningPlayedLength === 'number'
            ? Math.max(0, Math.min(prevBody.reasoningPlayedLength, prevReasoningText.length))
            : prevReasoningText.length
        const snapshotPlayedRaw =
          typeof snapshot.reasoningPlayedLength === 'number' && Number.isFinite(snapshot.reasoningPlayedLength)
            ? snapshot.reasoningPlayedLength
            : null
        const resolvedPlayedLength = (() => {
          if (snapshotPlayedRaw !== null) {
            const normalized = Math.max(0, Math.floor(snapshotPlayedRaw))
            return Math.min(normalized, snapshotReasoning.length)
          }
          if (reasoningChanged) {
            return snapshotReasoning.length
          }
          return prevPlayedLength
        })()
        const playedLengthChanged = resolvedPlayedLength !== prevPlayedLength
        const snapshotToolEvents = Array.isArray(snapshot.toolEvents) ? snapshot.toolEvents : null
        const normalizedToolEvents =
          snapshotToolEvents && snapshotToolEvents.length > 0
            ? snapshotToolEvents.map((evt) => ({
                ...evt,
                sessionId: meta.sessionId,
                messageId: meta.id,
                status: evt.status ?? inferToolStatus(evt.stage),
              }))
            : null

        if (
          contentChanged ||
          reasoningChanged ||
          playedLengthChanged ||
          (normalizedToolEvents && normalizedToolEvents.length > 0)
        ) {
          const bodies = ensureBodies()
          bodies[key] = {
            ...prevBody,
            id: prevBody.id,
            stableKey: prevBody.stableKey || meta.stableKey,
            content: contentChanged ? snapshotContent : prevBody.content,
            reasoning: reasoningChanged ? snapshotReasoning : prevBody.reasoning,
            reasoningPlayedLength: resolvedPlayedLength,
            version: prevBody.version + (contentChanged ? 1 : 0),
            reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
            toolEvents:
              normalizedToolEvents && normalizedToolEvents.length > 0
                ? normalizedToolEvents
                : prevBody.toolEvents,
          }
          const cache = ensureRenderCache()
          delete cache[key]
        }

        if (normalizedToolEvents && normalizedToolEvents.length > 0) {
          const merged = mergeToolEventsForMessage(
            nextToolEvents,
            sessionId,
            meta.id,
            normalizedToolEvents,
          )
          if (merged !== nextToolEvents) {
            nextToolEvents = merged
            toolEventsMutated = true
          }
        }

        const nextStreamStatus =
          snapshot.streamStatus ?? meta.streamStatus ?? (meta.pendingSync ? 'done' : 'streaming')
        const nextReasoningStatus = snapshot.reasoningStatus ?? meta.reasoningStatus
        const nextStreamError = nextStreamStatus === 'error' ? meta.streamError : null
        const metaNeedsUpdate =
          nextStreamStatus !== meta.streamStatus ||
          nextReasoningStatus !== meta.reasoningStatus ||
          nextStreamError !== meta.streamError ||
          meta.isPlaceholder ||
          (nextStreamStatus === 'done' && !meta.pendingSync)
        if (metaNeedsUpdate) {
          const metas = ensureMetas()
          metas[metaIndex] = {
            ...meta,
            streamStatus: nextStreamStatus,
            streamError: nextStreamError,
            reasoningStatus: nextReasoningStatus,
            isPlaceholder: false,
            pendingSync: nextStreamStatus === 'done' ? true : meta.pendingSync,
          }
        }

        if (snapshot.metrics) {
          const metricsMap = ensureMetrics()
          metricsMap[key] = snapshot.metrics
        }
      })

      if (
        !metasMutated &&
        !bodiesMutated &&
        !renderCacheMutated &&
        !toolEventsMutated &&
        !metricsMutated
      ) {
        return state
      }

      const partial: Partial<ChatState> = {}
      if (metasMutated) {
        partial.messageMetas = nextMetas
        partial.assistantVariantSelections = buildVariantSelections(nextMetas)
      }
      if (bodiesMutated) {
        partial.messageBodies = nextBodies
      }
      if (renderCacheMutated) {
        partial.messageRenderCache = nextRenderCache
      }
      if (toolEventsMutated) {
        partial.toolEvents = nextToolEvents
      }
      if (metricsMutated) {
        partial.messageMetrics = nextMetrics
      }
      return partial
    })
  }

  const applyServerMessageSnapshot = (message: Message) => {
    const normalizedToolEvents = normalizeToolEvents(message)
    const contentPayload = message.content || ''
    const reasoningPayload = message.reasoning ?? message.streamReasoning ?? ''
    const hasReasoningPayload = typeof reasoningPayload === 'string' && reasoningPayload.length > 0
    set((state) => {
      const serverMeta = createMeta(message)
      const key = messageKey(message.id)
      const prevBody = ensureBody(state.messageBodies[key], message.id, serverMeta.stableKey)
      const contentChanged = prevBody.content !== contentPayload
      const prevReasoningText = prevBody.reasoning ?? ''
      const prevPlayedLength =
        typeof prevBody.reasoningPlayedLength === 'number'
          ? Math.max(0, Math.min(prevBody.reasoningPlayedLength, prevReasoningText.length))
          : prevReasoningText.length
      const reasoningChanged = hasReasoningPayload && prevReasoningText !== reasoningPayload
      const nextPlayedLength = hasReasoningPayload ? reasoningPayload.length : prevPlayedLength
      const playedChanged = nextPlayedLength !== prevPlayedLength
      const hasToolUpdates = normalizedToolEvents.length > 0

      let nextBodies = state.messageBodies
      let nextRenderCache = state.messageRenderCache
      let nextToolEvents = state.toolEvents
      let nextMetas = state.messageMetas
      let nextMetrics = state.messageMetrics || {}
      let metasMutated = false
      let bodiesMutated = false
      let renderCacheMutated = false
      let toolEventsMutated = false

      const ensureBodies = () => {
        if (!bodiesMutated) {
          nextBodies = { ...state.messageBodies }
          bodiesMutated = true
        }
        return nextBodies
      }
      const ensureRenderCache = () => {
        if (!renderCacheMutated) {
          nextRenderCache = { ...state.messageRenderCache }
          renderCacheMutated = true
        }
        return nextRenderCache
      }
      const ensureMetas = () => {
        if (!metasMutated) {
          nextMetas = state.messageMetas.slice()
          metasMutated = true
        }
        return nextMetas
      }

      if (contentChanged || reasoningChanged || playedChanged || hasToolUpdates) {
        const bodies = ensureBodies()
        bodies[key] = {
          ...prevBody,
          id: message.id,
          stableKey: serverMeta.stableKey,
          content: contentPayload,
          reasoning: hasReasoningPayload ? reasoningPayload : prevBody.reasoning,
          reasoningPlayedLength: nextPlayedLength,
          version: prevBody.version + (contentChanged ? 1 : 0),
          reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
          toolEvents: hasToolUpdates ? normalizedToolEvents : prevBody.toolEvents,
        }
        const cache = ensureRenderCache()
        delete cache[key]
      }

      if (hasToolUpdates) {
        const merged = mergeToolEventsForMessage(
          nextToolEvents,
          message.sessionId,
          message.id,
          normalizedToolEvents,
        )
        if (merged !== nextToolEvents) {
          nextToolEvents = merged
          toolEventsMutated = true
        }
      }

      const metaIndex = nextMetas.findIndex((meta) => messageKey(meta.id) === key)
      if (metaIndex === -1) {
        const metas = ensureMetas()
        metas.push(serverMeta)
      } else {
        const prevMeta = nextMetas[metaIndex]
        const nextStreamStatus = message.streamStatus ?? prevMeta.streamStatus
        const nextStreamError = message.streamError ?? prevMeta.streamError
        const nextReasoningStatus = serverMeta.reasoningStatus ?? prevMeta.reasoningStatus
        const nextReasoningDuration =
          serverMeta.reasoningDurationSeconds ?? prevMeta.reasoningDurationSeconds
        const nextReasoningIdle = serverMeta.reasoningIdleMs ?? prevMeta.reasoningIdleMs
        const nextStableKey = prevMeta.stableKey || serverMeta.stableKey
        const metaNeedsUpdate =
          nextStreamStatus !== prevMeta.streamStatus ||
          nextStreamError !== prevMeta.streamError ||
          nextReasoningStatus !== prevMeta.reasoningStatus ||
          nextReasoningDuration !== prevMeta.reasoningDurationSeconds ||
          nextReasoningIdle !== prevMeta.reasoningIdleMs ||
          nextStableKey !== prevMeta.stableKey ||
          prevMeta.isPlaceholder ||
          prevMeta.pendingSync
        if (metaNeedsUpdate) {
          const metas = ensureMetas()
          metas[metaIndex] = {
            ...prevMeta,
            streamStatus: nextStreamStatus,
            streamError: nextStreamError,
            reasoningStatus: nextReasoningStatus,
            reasoningDurationSeconds: nextReasoningDuration,
            reasoningIdleMs: nextReasoningIdle,
            stableKey: nextStableKey,
            isPlaceholder: false,
            pendingSync: false,
          }
        }
      }

      if (message.role === 'assistant' && message.metrics) {
        const metricsMap = ensureMetrics()
        metricsMap[key] = message.metrics
      }

      if (
        !metasMutated &&
        !bodiesMutated &&
        !renderCacheMutated &&
        !toolEventsMutated &&
        !metricsMutated
      ) {
        return state
      }

      const partial: Partial<ChatState> = {}
      if (metasMutated) {
        partial.messageMetas = nextMetas
        partial.assistantVariantSelections = buildVariantSelections(nextMetas)
      }
      if (bodiesMutated) {
        partial.messageBodies = nextBodies
      }
      if (renderCacheMutated) {
        partial.messageRenderCache = nextRenderCache
      }
      if (toolEventsMutated) {
        partial.toolEvents = nextToolEvents
      }
      if (metricsMutated) {
        partial.messageMetrics = nextMetrics
      }
      return partial
    })
    if (message.streamStatus === 'streaming') {
      const shouldPersist =
        contentPayload.length > 0 ||
        reasoningPayload.length > 0 ||
        normalizedToolEvents.length > 0
      if (shouldPersist) {
        persistCompletionSnapshot({
          sessionId: message.sessionId,
          messageId: typeof message.id === 'number' ? Number(message.id) : null,
          clientMessageId: message.clientMessageId ?? null,
          content: contentPayload,
          reasoning: reasoningPayload,
          reasoningPlayedLength: reasoningPayload.length,
          toolEvents: normalizedToolEvents.length > 0 ? normalizedToolEvents : undefined,
          reasoningStatus: message.reasoningStatus,
          streamStatus: message.streamStatus,
          completedAt: Date.now(),
        })
      }
    } else {
      removeCompletionSnapshot(message.sessionId, {
        messageId: typeof message.id === 'number' ? Number(message.id) : null,
        clientMessageId: message.clientMessageId ?? null,
      })
    }
    recomputeStreamingState()
  }

  const updateMetaStreamStatus = (
    messageId: MessageId,
    status: MessageMeta['streamStatus'],
    streamError?: string | null,
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
    if (typeof messageId === 'number' && Number.isFinite(messageId)) {
      stopMessagePoller(messageId)
    }
    recomputeStreamingState()
  }

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
        const response = await getMessageProgress(sessionId, messageId)
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
    active.reasoningPlayedLength = active.reasoning.length

    const metaPatch = active.pendingMeta
    active.pendingMeta = {}

    const assistantKey = messageKey(active.assistantId)

    set((state) => {
      const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === assistantKey)
      if (metaIndex === -1) {
        return state
      }

      const prevMeta = state.messageMetas[metaIndex]
      const prevBody = ensureBody(
        state.messageBodies[assistantKey],
        active.assistantId,
        prevMeta.stableKey,
      )

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
      const prevReasoningText = prevBody.reasoning ?? ''
      const prevPlayedLength =
        typeof prevBody.reasoningPlayedLength === 'number'
          ? Math.max(0, Math.min(prevBody.reasoningPlayedLength, prevReasoningText.length))
          : prevReasoningText.length
      const nextPlayedLength = active.reasoningPlayedLength
      const playedChanged = nextPlayedLength !== prevPlayedLength

      if (!contentChanged && !reasoningChanged && !metaChanged && !playedChanged) {
        return state
      }

      const nextBody: MessageBody = {
        ...prevBody,
        id: prevBody.id,
        stableKey: prevBody.stableKey || prevMeta.stableKey,
        content: contentChanged ? active.content : prevBody.content,
        reasoning: reasoningChanged ? active.reasoning : prevBody.reasoning,
        reasoningPlayedLength: nextPlayedLength,
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
    persistSnapshotForStream(active)
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
    activeStreams,
    streamingPollers,
    registerActiveStream,
    unregisterActiveStream,
    findStreamByAssistantId,
    findStreamByClientMessageId,
    stopMessagePoller,
    stopAllMessagePollers,
    persistSnapshotForStream,
    persistCompletionRecord: persistCompletionSnapshot,
    recomputeStreamingState,
    streamingFlagUpdate,
    applyBufferedSnapshots,
    applyServerMessageSnapshot,
    updateMetaStreamStatus,
    startMessageProgressWatcher,
    flushStreamBuffer,
    scheduleFlush,
    clearActiveStream,
    removeCompletionSnapshot,
    getSessionCompletionSnapshots,
    snapshotDebug,
  }
}
