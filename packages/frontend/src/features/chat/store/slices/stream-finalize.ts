import { getMessageByClientId } from '@/features/chat/api'
import { mergeImages, messageKey } from '../utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
} from '../types'
import { computeStreamMetrics } from './stream-metrics'

export const finalizeStream = (deps: {
  finalStream: ActiveStreamEntry | null
  streamEntry: ActiveStreamEntry
  sessionId: number
  get: ChatStoreGetState
  set: ChatStoreSetState
  runtime: ChatStoreRuntime
}): void => {
  const { finalStream, streamEntry, sessionId, get, set, runtime } = deps

  runtime.flushStreamBuffer(finalStream, true)
  if (finalStream) {
    const normalizedContent = finalStream.content.trim()
    if (normalizedContent !== finalStream.content) {
      finalStream.content = normalizedContent
      runtime.flushStreamBuffer(finalStream, true)
    }
  }
  const snapshotToolEvents =
    finalStream && streamEntry.sessionId === sessionId
      ? get().toolEvents.filter(
          (event) =>
            event.sessionId === sessionId &&
            messageKey(event.messageId) === messageKey(finalStream.assistantId),
        )
      : []
  const completedAtMs = finalStream?.completedAt ?? Date.now()
  // 优先使用后端发送的 serverMetrics，否则降级到本地计算
  const fallbackMetrics = finalStream && finalStream.sessionId === sessionId
    ? computeStreamMetrics(
        {
          startedAt: finalStream.startedAt,
          firstChunkAt: finalStream.firstChunkAt,
          completedAt: completedAtMs,
        },
        finalStream.lastUsage as import('../types').StreamUsageSnapshot,
      )
    : null
  // 合并后端 metrics（时延和速度）与本地 usage（tokens）
  const computedMetrics: import('@/types').MessageStreamMetrics | null =
    finalStream?.serverMetrics
      ? {
          firstTokenLatencyMs: finalStream.serverMetrics.firstTokenLatencyMs,
          responseTimeMs: finalStream.serverMetrics.responseTimeMs,
          tokensPerSecond: finalStream.serverMetrics.tokensPerSecond,
          promptTokens: fallbackMetrics?.promptTokens ?? null,
          completionTokens: fallbackMetrics?.completionTokens ?? null,
          totalTokens: fallbackMetrics?.totalTokens ?? null,
        }
      : fallbackMetrics
  const terminalStreamStatus = finalStream?.terminalStreamStatus ?? 'done'
  const completedSnapshot = finalStream
    ? {
        assistantId: finalStream.assistantId,
        assistantClientMessageId: finalStream.assistantClientMessageId ?? finalStream.clientMessageId,
        content: finalStream.content,
        reasoning: finalStream.reasoning,
        usage: finalStream.lastUsage,
        toolEvents: snapshotToolEvents,
        sessionId,
        metrics: computedMetrics,
      }
    : null
  const completedAssistantId =
    typeof finalStream?.assistantId !== 'undefined' ? finalStream?.assistantId : null
  if (
    completedSnapshot &&
    (completedSnapshot.content.length > 0 || completedSnapshot.reasoning.length > 0)
  ) {
    runtime.persistCompletionRecord({
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
      reasoningPlayedLength: completedSnapshot.reasoning.length,
      usage: completedSnapshot.usage,
      toolEvents: completedSnapshot.toolEvents,
      streamStatus: terminalStreamStatus,
      reasoningStatus: 'done',
      completedAt: completedAtMs,
      metrics: computedMetrics,
    })
    if (computedMetrics && completedAssistantId != null) {
      const metricsKey = messageKey(completedAssistantId)
      set((state) => ({
        messageMetrics: { ...(state.messageMetrics || {}), [metricsKey]: computedMetrics },
      }))
    }
  }
  if (typeof completedAssistantId !== 'undefined' && completedAssistantId !== null) {
    runtime.updateMetaStreamStatus(completedAssistantId, terminalStreamStatus)
  }
  runtime.clearActiveStream(finalStream)
  runtime.recomputeStreamingState()
  set((state) => runtime.streamingFlagUpdate(state, sessionId, false))
  // 侧栏总量刷新一次即可；当前会话 usage 已尽量由 stream complete 写入
  get().fetchSessionsUsage().catch(() => {})
  if (!completedSnapshot?.usage) {
    get().fetchUsage(sessionId).catch(() => {})
  }

  // 仅在有工具事件或本地内容为空时回补，避免每次流结束再打 getMessage
  const needsServerSync =
    Boolean(completedSnapshot?.toolEvents?.length) ||
    !(typeof completedSnapshot?.content === 'string' && completedSnapshot.content.length > 0)
  if (
    needsServerSync &&
    finalStream &&
    (finalStream.clientMessageId || finalStream.assistantClientMessageId)
  ) {
    const syncClientId = finalStream.assistantClientMessageId || finalStream.clientMessageId
    if (syncClientId) {
      setTimeout(() => {
        getMessageByClientId(sessionId, syncClientId)
          .then((res) => {
            const serverMsg = res?.data?.message
            if (serverMsg) {
              const merged = mergeImages(serverMsg, get().messageImageCache)
              runtime.applyServerMessageSnapshot(merged)
              if (typeof merged.id === 'number') {
                get().invalidateRenderedContent(merged.id)
              }
            }
          })
          .catch(() => {})
      }, 600)
    }
  }
}
