import type { MessageMeta, MessageStreamMetrics, ToolEvent } from '@/types'
import {
  STREAM_SNAPSHOT_PERSIST_INTERVAL,
  STREAM_SNAPSHOT_STORAGE_KEY,
  STREAM_SNAPSHOT_TTL_MS,
} from '../utils'
import type { StreamCompletionSnapshot } from '../types'

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

let snapshotCache: StreamCompletionSnapshot[] = []
let snapshotCacheLoaded = false
let snapshotWriteTimer: ReturnType<typeof setTimeout> | null = null
let lastSnapshotPruneAt = 0
const SNAPSHOT_PRUNE_INTERVAL_MS = 30 * 1000

const mergeSnapshotText = (incoming: string | undefined, existing: string | undefined): string => {
  const nextText = typeof incoming === 'string' ? incoming : ''
  const prevText = typeof existing === 'string' ? existing : ''
  if (!nextText) return prevText
  if (!prevText) return nextText
  if (nextText === prevText) return prevText
  if (nextText.startsWith(prevText)) return nextText
  if (prevText.startsWith(nextText)) return prevText
  return nextText
}

const sanitizeCompletionSnapshots = (parsed: any[]): StreamCompletionSnapshot[] => {
  const now = Date.now()
  try {
    return parsed
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
          clientMessageId:
            typeof (item as any).clientMessageId === 'string'
              ? (item as any).clientMessageId
              : null,
          content: typeof (item as any).content === 'string' ? (item as any).content : '',
          reasoning: reasoningText,
          reasoningPlayedLength,
          usage:
            (item as any).usage && typeof (item as any).usage === 'object'
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
      .filter(
        (item): item is StreamCompletionSnapshot =>
          Boolean(item && now - item.completedAt <= STREAM_SNAPSHOT_TTL_MS),
      )
  } catch {
    return []
  }
}

const loadCompletionSnapshotsFromStorage = (): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  const storages = getSnapshotStorages()
  if (storages.length === 0) return []
  try {
    const targetStorage = storages[0] ?? null
    let parsed: any[] | null = null
    let sourceStorage: Storage | null = null
    for (const storage of storages) {
      const raw = storage.getItem(STREAM_SNAPSHOT_STORAGE_KEY)
      if (!raw) continue
      parsed = JSON.parse(raw)
      sourceStorage = storage
      break
    }
    if (!parsed || !Array.isArray(parsed)) return []
    const sanitized = sanitizeCompletionSnapshots(parsed)
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

const readCompletionSnapshots = (): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  if (!snapshotCacheLoaded) {
    snapshotCache = loadCompletionSnapshotsFromStorage()
    snapshotCacheLoaded = true
    lastSnapshotPruneAt = Date.now()
  } else if (snapshotCache.length > 0 && Date.now() - lastSnapshotPruneAt >= SNAPSHOT_PRUNE_INTERVAL_MS) {
    snapshotCache = sanitizeCompletionSnapshots(snapshotCache as any[])
    lastSnapshotPruneAt = Date.now()
  }
  return snapshotCache
}

const flushSnapshotWriteQueue = () => {
  if (typeof window === 'undefined') return
  const storages = getSnapshotStorages()
  const storage = storages[0]
  if (!storage) return
  try {
    storage.setItem(STREAM_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshotCache))
  } catch {
    // ignore quota errors
  }
}

const scheduleSnapshotWrite = () => {
  if (snapshotWriteTimer != null) return
  snapshotWriteTimer = setTimeout(() => {
    snapshotWriteTimer = null
    flushSnapshotWriteQueue()
  }, STREAM_SNAPSHOT_PERSIST_INTERVAL)
}

const writeCompletionSnapshots = (records: StreamCompletionSnapshot[], immediate = false) => {
  if (typeof window === 'undefined') return
  snapshotCache = records
  snapshotCacheLoaded = true
  lastSnapshotPruneAt = Date.now()
  if (immediate) {
    if (snapshotWriteTimer != null) {
      clearTimeout(snapshotWriteTimer)
      snapshotWriteTimer = null
    }
    flushSnapshotWriteQueue()
    return
  }
  scheduleSnapshotWrite()
}

export const snapshotDebug = (...args: any[]) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_DEBUG_STREAM !== '1'
  ) {
    return
  }
  // eslint-disable-next-line no-console
  console.debug('[snapshot]', ...args)
}

export const persistCompletionSnapshot = (snapshot: StreamCompletionSnapshot) => {
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
      content: mergeSnapshotText(snapshot.content, existing.content),
      reasoning: mergeSnapshotText(snapshot.reasoning, existing.reasoning),
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
  const terminalSnapshot =
    snapshot.streamStatus != null && snapshot.streamStatus !== 'streaming'
  writeCompletionSnapshots(entries, terminalSnapshot)
}

export const removeCompletionSnapshot = (
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
    writeCompletionSnapshots(filtered, true)
  }
}

export const getSessionCompletionSnapshots = (sessionId: number): StreamCompletionSnapshot[] => {
  if (typeof window === 'undefined') return []
  return readCompletionSnapshots().filter((item) => item.sessionId === sessionId)
}
