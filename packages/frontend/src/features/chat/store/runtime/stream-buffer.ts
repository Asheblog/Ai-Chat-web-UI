import type { ChatState, MessageBody, MessageMeta } from '@/types'
import {
  buildVariantSelections,
  ensureBody,
  messageKey,
  STREAM_FLUSH_INTERVAL,
  STREAM_SNAPSHOT_PERSIST_INTERVAL,
} from '../utils'
import type { ActiveStreamEntry, ChatStoreSetState } from '../types'

export const createStreamBufferRuntime = (deps: {
  set: ChatStoreSetState
  unregisterActiveStream: (streamKey: string) => void
  persistSnapshotForStream: (stream: ActiveStreamEntry | null) => void
}) => {
  const { set, unregisterActiveStream, persistSnapshotForStream } = deps

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

      if (Object.prototype.hasOwnProperty.call(metaPatch, 'streamStatus')) {
        applyMetaField('streamStatus', metaPatch.streamStatus ?? 'done')
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
      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningUnavailableCode')) {
        applyMetaField('reasoningUnavailableCode', metaPatch.reasoningUnavailableCode ?? null)
      }
      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningUnavailableReason')) {
        applyMetaField('reasoningUnavailableReason', metaPatch.reasoningUnavailableReason ?? null)
      }
      if (Object.prototype.hasOwnProperty.call(metaPatch, 'reasoningUnavailableSuggestion')) {
        applyMetaField('reasoningUnavailableSuggestion', metaPatch.reasoningUnavailableSuggestion ?? null)
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
    const now = Date.now()
    const lastPersistedAt = active.lastSnapshotPersistedAt ?? 0
    if (force || now - lastPersistedAt >= STREAM_SNAPSHOT_PERSIST_INTERVAL) {
      persistSnapshotForStream(active)
      active.lastSnapshotPersistedAt = now
    }
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

  return { flushStreamBuffer, scheduleFlush, clearActiveStream }
}
