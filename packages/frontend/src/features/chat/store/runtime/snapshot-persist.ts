import { messageKey } from '../utils'
import { persistCompletionSnapshot, snapshotDebug } from './snapshot-store'
import type { ActiveStreamEntry, ChatStoreGetState } from '../types'

export const createSnapshotPersistRuntime = (get: ChatStoreGetState) => {
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

  return { persistSnapshotForStream }
}
