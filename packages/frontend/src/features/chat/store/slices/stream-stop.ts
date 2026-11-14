import { cancelAgentStream, cancelStream } from '@/features/chat/api'
import type { MessageMeta } from '@/types'
import { buildVariantSelections, messageKey } from '../utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
  StopStreamingTarget,
} from '../types'

const normalizeClientId = (value?: string | null): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

/** 目标是否精确指向这条消息运行（session 必须匹配，给出 messageId/clientMessageId 时严格匹配）。 */
const matchesTargetMeta = (meta: MessageMeta, target: StopStreamingTarget): boolean => {
  if (meta.sessionId !== target.sessionId) return false
  if (target.messageId != null && messageKey(meta.id) !== messageKey(target.messageId)) return false
  const clientId = normalizeClientId(target.clientMessageId)
  if (clientId && meta.clientMessageId !== clientId) return false
  return true
}

const matchesTargetStream = (stream: ActiveStreamEntry, target: StopStreamingTarget): boolean => {
  if (stream.sessionId !== target.sessionId) return false
  if (
    target.messageId != null &&
    messageKey(stream.assistantId) !== messageKey(target.messageId)
  ) {
    return false
  }
  const clientId = normalizeClientId(target.clientMessageId)
  if (clientId && stream.assistantClientMessageId !== clientId && stream.clientMessageId !== clientId) {
    return false
  }
  return true
}

export const createStopStreamingAction = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
  runtime: ChatStoreRuntime,
) => (target?: StopStreamingTarget) => {
  const snapshot = get()
  const metasSnapshot = snapshot.messageMetas

  const stopActiveStream = (stream: ActiveStreamEntry) => {
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
        messageId: typeof stream.assistantId === 'number' ? Number(stream.assistantId) : undefined,
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
    runtime.removeCompletionSnapshot(stream.sessionId, {
      messageId: assistantNumericId,
      clientMessageId:
        normalizeClientId(stream.assistantClientMessageId) ?? normalizeClientId(stream.clientMessageId),
    })
  }

  const markStaleMetasCancelled = (metas: MessageMeta[]) => {
    // 乐观 id 会跨会话撞号（Date.now()/Date.now()+1），写回必须用 session:id 定位，
    // 否则会连带取消另一会话里同 id 的 stale 消息。
    const messageIdentities = new Set(
      metas.map((meta) => `${meta.sessionId}:${messageKey(meta.id)}`),
    )
    if (messageIdentities.size === 0) return
    set((state) => {
      const nextMetas = state.messageMetas.map((meta) => {
        if (!messageIdentities.has(`${meta.sessionId}:${messageKey(meta.id)}`)) return meta
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
      return {
        messageMetas: nextMetas,
        assistantVariantSelections: buildVariantSelections(nextMetas),
        toolEvents: state.toolEvents.filter(
          (event) =>
            !messageIdentities.has(`${event.sessionId}:${messageKey(event.messageId)}`),
        ),
      }
    })
    for (const meta of metas) {
      const metaClientId = normalizeClientId(meta.clientMessageId)
      const metaNumericId =
        typeof meta.id === 'number' && Number.isFinite(meta.id) ? Number(meta.id) : null
      cancelAgentStream(meta.sessionId, {
        clientMessageId: metaClientId ?? undefined,
        messageId: metaNumericId ?? undefined,
      }).catch(() => {})
      if (metaNumericId != null) {
        runtime.stopMessagePoller(metaNumericId)
      }
      runtime.removeCompletionSnapshot(meta.sessionId, {
        messageId: metaNumericId,
        clientMessageId: metaClientId,
      })
    }
  }

  // 指定目标：只停该 run。会话里其它正在生成的 run 不受影响。
  if (target) {
    if (typeof target.sessionId !== 'number' || !Number.isFinite(target.sessionId)) return
    const matchedStreams = Array.from(runtime.activeStreams.values()).filter((stream) =>
      matchesTargetStream(stream, target),
    )
    if (matchedStreams.length > 0) {
      const stoppedMessageKeys = new Set(
        matchedStreams.map((stream) => messageKey(stream.assistantId)),
      )
      matchedStreams.forEach(stopActiveStream)
      set((state) => ({
        toolEvents: state.toolEvents.filter(
          (event) =>
            !(
              event.sessionId === target.sessionId &&
              stoppedMessageKeys.has(messageKey(event.messageId))
            ),
        ),
      }))
      runtime.recomputeStreamingState()
      return
    }

    // 回退路径：内存里没有该 run 时，只标记目标消息自身的 stale streaming 状态。
    const targetedMetas = snapshot.messageMetas.filter(
      (meta) =>
        meta.role === 'assistant' &&
        meta.streamStatus === 'streaming' &&
        matchesTargetMeta(meta, target),
    )
    if (targetedMetas.length === 0) return
    markStaleMetasCancelled(targetedMetas)
    // 刷新后内存里没有 ActiveStreamEntry，取消只改了 meta；由状态推导同步 isStreaming，
    // 否则 composer 会永久停在“生成中”。
    runtime.recomputeStreamingState()
    return
  }

  const currentSessionId = snapshot.currentSession?.id ?? null
  const targets = Array.from(runtime.activeStreams.values()).filter((stream) =>
    currentSessionId ? stream.sessionId === currentSessionId : true,
  )

  if (targets.length > 0) {
    targets.forEach(stopActiveStream)
    set((state) => ({
      ...runtime.streamingFlagUpdate(state, currentSessionId, false),
      toolEvents: currentSessionId
        ? state.toolEvents.filter((event) => event.sessionId !== currentSessionId)
        : state.toolEvents,
    }))
    return
  }

  // 回退路径：内存中没有活跃流时，查找所有状态为 'streaming' 的助手消息并批量取消
  // （修复：原实现 .find() 每次只取消一条，若有多条 stale streaming 消息，
  // updateMetaStreamStatus → recomputeStreamingState 会发现下一条，导致 isStreaming 反复恢复）
  const streamingMetas = snapshot.messageMetas.filter(
    (meta) => meta.role === 'assistant' && meta.streamStatus === 'streaming',
  )
  if (currentSessionId && streamingMetas.length > 0) {
    markStaleMetasCancelled(streamingMetas)
    // 统一在最后重新计算 isStreaming 状态
    runtime.recomputeStreamingState()
    set((state) => ({
      ...runtime.streamingFlagUpdate(state, currentSessionId, false),
      toolEvents: state.toolEvents.filter((event) => event.sessionId !== currentSessionId),
    }))
  }
}
