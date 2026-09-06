import { cancelAgentStream, cancelStream } from '@/features/chat/api'
import { messageKey } from '../utils'
import type {
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
} from '../types'

export const createStopStreamingAction = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
  runtime: ChatStoreRuntime,
) => () => {
  const snapshot = get()
  const currentSessionId = snapshot.currentSession?.id ?? null
  const targets = Array.from(runtime.activeStreams.values()).filter((stream) =>
    currentSessionId ? stream.sessionId === currentSessionId : true,
  )

  if (targets.length > 0) {
    const metasSnapshot = snapshot.messageMetas
    targets.forEach((stream) => {
      stream.stopRequested = true
      const hasReasoningState =
        stream.reasoningActivated ||
        metasSnapshot.some(
          (meta) =>
            messageKey(meta.id) === messageKey(stream.assistantId) &&
            typeof meta.reasoningStatus === 'string',
        )
      if (hasReasoningState) {
        stream.pendingMeta.reasoningStatus = 'done'
        stream.pendingMeta.reasoningIdleMs = null
      }
      if (stream.sessionId && (stream.clientMessageId || stream.assistantId)) {
        cancelAgentStream(stream.sessionId, {
            clientMessageId: stream.clientMessageId ?? stream.assistantClientMessageId ?? undefined,
            messageId:
              typeof stream.assistantId === 'number' ? Number(stream.assistantId) : undefined,
          }).catch(() => {})
      }
      try {
        cancelStream(stream.streamKey)
      } catch {
        // ignore
      }
      runtime.flushStreamBuffer(stream, true)
      runtime.clearActiveStream(stream)
      if (typeof stream.assistantId === 'number') {
        runtime.updateMetaStreamStatus(stream.assistantId, 'cancelled', '已停止生成')
      }
      const assistantNumericId =
        typeof stream.assistantId === 'number' && Number.isFinite(stream.assistantId)
          ? Number(stream.assistantId)
          : null
      const resolvedClientId =
        typeof stream.assistantClientMessageId === 'string' && stream.assistantClientMessageId.trim()
          ? stream.assistantClientMessageId.trim()
          : typeof stream.clientMessageId === 'string' && stream.clientMessageId.trim()
            ? stream.clientMessageId.trim()
            : null
      runtime.removeCompletionSnapshot(stream.sessionId, {
        messageId: assistantNumericId,
        clientMessageId: resolvedClientId,
      })
    })
    set((state) => ({
      ...runtime.streamingFlagUpdate(state, currentSessionId, false),
      toolEvents: currentSessionId
        ? state.toolEvents.filter((event) => event.sessionId !== currentSessionId)
        : state.toolEvents,
    }))
    return
  }

  // 回退路径：内存中没有活跃流时，查找所有状态为 'streaming' 的助手消息并批量取消
  // 修复：原代码用 .find() 每次只取消一条，若有多条 stale streaming 消息，
  // updateMetaStreamStatus → recomputeStreamingState 会发现下一条，导致 isStreaming 恢复为 true
  const streamingMetas = snapshot.messageMetas.filter(
    (meta) => meta.role === 'assistant' && meta.streamStatus === 'streaming',
  )
  if (currentSessionId && streamingMetas.length > 0) {
    // 批量更新所有 streaming 消息的 meta 状态，在一次 set 中完成
    set((state) => {
      const metaKeys = new Set(
        streamingMetas.map((meta) => messageKey(meta.id)),
      )
      if (metaKeys.size === 0) return state
      const nextMetas = state.messageMetas.map((meta) => {
        if (!metaKeys.has(messageKey(meta.id))) return meta
        return {
          ...meta,
          streamStatus: 'cancelled' as const,
          streamError: '已停止生成',
          reasoningStatus:
            meta.reasoningStatus === 'done' && meta.reasoningIdleMs == null
              ? meta.reasoningStatus
              : ('done' as const),
          reasoningIdleMs: null,
          pendingSync: false,
        }
      })
      return { messageMetas: nextMetas }
    })

    // 后续副作用：发服务端取消请求、停止轮询、清理快照
    for (const meta of streamingMetas) {
      const metaClientId = meta.clientMessageId ?? null
      const metaNumericId =
        typeof meta.id === 'number' && Number.isFinite(meta.id) ? Number(meta.id) : null
      cancelAgentStream(currentSessionId, {
        clientMessageId: metaClientId ?? undefined,
        messageId: metaNumericId ?? undefined,
      }).catch(() => {})
      if (metaNumericId != null) {
        runtime.stopMessagePoller(metaNumericId)
      }
      const resolvedClientId =
        typeof metaClientId === 'string' && metaClientId.trim() ? metaClientId.trim() : null
      runtime.removeCompletionSnapshot(currentSessionId, {
        messageId: metaNumericId,
        clientMessageId: resolvedClientId,
      })
    }

    // 统一在最后重新计算 isStreaming 状态
    runtime.recomputeStreamingState()
    set((state) => ({
      ...runtime.streamingFlagUpdate(state, currentSessionId, false),
      toolEvents: state.toolEvents.filter((event) => event.sessionId !== currentSessionId),
    }))
  }
}
