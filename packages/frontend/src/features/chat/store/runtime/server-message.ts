import type { ChatState, Message } from '@/types'
import {
  buildVariantSelections,
  createMeta,
  ensureBody,
  mergeToolEventsForMessage,
  messageKey,
  normalizeToolEvents,
} from '../utils'
import {
  persistCompletionSnapshot,
  removeCompletionSnapshot,
} from './snapshot-store'
import type { ChatStoreGetState, ChatStoreSetState } from '../types'

export const createServerMessageApplier = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
) => {
  const applyServerMessageSnapshot = (message: Message) => {
    const normalizedToolEvents = normalizeToolEvents(message)
    const normalizedArtifacts = Array.isArray(message.artifacts) ? message.artifacts : []
    const serverContentPayload = message.content || ''
    const reasoningPayload = message.reasoning ?? message.streamReasoning ?? ''
    const hasReasoningPayload = typeof reasoningPayload === 'string' && reasoningPayload.length > 0
    let resolvedContent = serverContentPayload
    let resolvedReasoning = reasoningPayload
    set((state) => {
      const serverMeta = createMeta(message)
      const key = messageKey(message.id)
      const prevBody = ensureBody(state.messageBodies[key], message.id, serverMeta.stableKey)

      // 智能内容合并：如果本地内容比服务器内容更新（本地更长且服务器内容是前缀），保留本地内容
      // 同时防止服务器返回空内容时覆盖本地已有内容（刷新页面后轮询获取的数据库内容可能因持久化延迟而为空）
      const serverContentEmpty = serverContentPayload.length === 0
      const localContentLonger =
        prevBody.content.length > serverContentPayload.length &&
        prevBody.content.startsWith(serverContentPayload)
      const shouldPreserveLocalContent =
        message.streamStatus === 'streaming' &&
        prevBody.content.length > 0 &&
        (serverContentEmpty || localContentLonger)

      const contentPayload = shouldPreserveLocalContent ? prevBody.content : serverContentPayload
      const contentChanged = prevBody.content !== contentPayload
      const prevReasoningText = prevBody.reasoning ?? ''
      const prevPlayedLength =
        typeof prevBody.reasoningPlayedLength === 'number'
          ? Math.max(0, Math.min(prevBody.reasoningPlayedLength, prevReasoningText.length))
          : prevReasoningText.length

      // 智能推理内容合并：防止服务器返回空推理时覆盖本地已有推理内容
      const reasoningEmpty = reasoningPayload.length === 0
      const localReasoningLonger =
        prevReasoningText.length > reasoningPayload.length &&
        prevReasoningText.startsWith(reasoningPayload)
      const shouldPreserveLocalReasoning =
        message.streamStatus === 'streaming' &&
        prevReasoningText.length > 0 &&
        (reasoningEmpty || localReasoningLonger)

      const finalReasoningPayload = shouldPreserveLocalReasoning ? prevReasoningText : reasoningPayload
      // 捕获实际合并后的内容，供 set() 外部 persistCompletionSnapshot 使用
      // 避免使用可能为空或更短的 serverContentPayload / reasoningPayload
      resolvedContent = contentPayload
      resolvedReasoning = hasReasoningPayload ? finalReasoningPayload : prevReasoningText
      const reasoningChanged = hasReasoningPayload && prevReasoningText !== finalReasoningPayload
      const nextPlayedLength = hasReasoningPayload ? finalReasoningPayload.length : prevPlayedLength
      const playedChanged = nextPlayedLength !== prevPlayedLength
      const hasToolUpdates = normalizedToolEvents.length > 0
      const hasArtifactUpdates = normalizedArtifacts.length > 0

      let nextBodies = state.messageBodies
      let nextRenderCache = state.messageRenderCache
      let nextToolEvents = state.toolEvents
      let nextMetas = state.messageMetas
      let nextMetrics = state.messageMetrics || {}
      let metasMutated = false
      let bodiesMutated = false
      let renderCacheMutated = false
      let toolEventsMutated = false
      let metricsMutated = false

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
      const ensureMetrics = () => {
        if (!metricsMutated) {
          nextMetrics = { ...(state.messageMetrics || {}) }
          metricsMutated = true
        }
        return nextMetrics
      }

      if (contentChanged || reasoningChanged || playedChanged || hasToolUpdates || hasArtifactUpdates) {
        const bodies = ensureBodies()
        bodies[key] = {
          ...prevBody,
          id: message.id,
          stableKey: serverMeta.stableKey,
          content: contentPayload,
          reasoning: hasReasoningPayload ? finalReasoningPayload : prevBody.reasoning,
          reasoningPlayedLength: nextPlayedLength,
          version: prevBody.version + (contentChanged ? 1 : 0),
          reasoningVersion: prevBody.reasoningVersion + (reasoningChanged ? 1 : 0),
          toolEvents: hasToolUpdates ? normalizedToolEvents : prevBody.toolEvents,
          artifacts: hasArtifactUpdates ? normalizedArtifacts : prevBody.artifacts,
        }
        // 正文增长时必须失效旧 HTML（与 live SSE flushStreamBuffer 对称）。
        // 刷新后走 progress 轮询时若保留缓存，MessageBubble 宽松匹配会继续展示截断正文。
        // 仅推理/工具变更且仍在 streaming 时可保留正文 HTML，避免无意义重渲染。
        const currentMetaForStreamCheck = nextMetas.find((m) => messageKey(m.id) === key)
        const effectiveStreamStatus = message.streamStatus ?? currentMetaForStreamCheck?.streamStatus
        if (contentChanged || effectiveStreamStatus !== 'streaming') {
          const cache = ensureRenderCache()
          delete cache[key]
        }
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
        // 如果流状态是终态，确保 reasoningStatus 也是 done
        // 修复刷新页面后服务端返回的消息状态不一致问题
        const candidateReasoningStatus = serverMeta.reasoningStatus ?? prevMeta.reasoningStatus
        const isTerminalStatus = nextStreamStatus && nextStreamStatus !== 'streaming'
        const nextReasoningStatus =
          isTerminalStatus && (candidateReasoningStatus === 'streaming' || candidateReasoningStatus === 'idle')
            ? 'done'
            : candidateReasoningStatus
        const nextReasoningDuration =
          serverMeta.reasoningDurationSeconds ?? prevMeta.reasoningDurationSeconds
        const nextReasoningIdle = serverMeta.reasoningIdleMs ?? prevMeta.reasoningIdleMs
        const nextReasoningUnavailableCode =
          serverMeta.reasoningUnavailableCode ?? prevMeta.reasoningUnavailableCode
        const nextReasoningUnavailableReason =
          serverMeta.reasoningUnavailableReason ?? prevMeta.reasoningUnavailableReason
        const nextReasoningUnavailableSuggestion =
          serverMeta.reasoningUnavailableSuggestion ?? prevMeta.reasoningUnavailableSuggestion
        const nextStableKey = prevMeta.stableKey || serverMeta.stableKey
        const metaNeedsUpdate =
          nextStreamStatus !== prevMeta.streamStatus ||
          nextStreamError !== prevMeta.streamError ||
          nextReasoningStatus !== prevMeta.reasoningStatus ||
          nextReasoningDuration !== prevMeta.reasoningDurationSeconds ||
          nextReasoningIdle !== prevMeta.reasoningIdleMs ||
          nextReasoningUnavailableCode !== prevMeta.reasoningUnavailableCode ||
          nextReasoningUnavailableReason !== prevMeta.reasoningUnavailableReason ||
          nextReasoningUnavailableSuggestion !== prevMeta.reasoningUnavailableSuggestion ||
          (hasArtifactUpdates &&
            JSON.stringify(prevMeta.artifacts || []) !== JSON.stringify(normalizedArtifacts)) ||
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
            reasoningUnavailableCode: nextReasoningUnavailableCode,
            reasoningUnavailableReason: nextReasoningUnavailableReason,
            reasoningUnavailableSuggestion: nextReasoningUnavailableSuggestion,
            artifacts: hasArtifactUpdates ? normalizedArtifacts : prevMeta.artifacts,
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

      // 在 set 回调内基于最新的 nextMetas 同步 isStreaming，
      // 避免外部 recomputeStreamingState() 读取到批处理前的旧状态
      const currentSid = state.currentSession?.id ?? null
      const effectiveMetas = metasMutated ? nextMetas : state.messageMetas
      const hasStreaming = effectiveMetas.some(
        (meta) => meta.sessionId === currentSid && meta.streamStatus === 'streaming',
      )
      if (currentSid === message.sessionId) {
        if (hasStreaming !== state.isStreaming) {
          partial.isStreaming = hasStreaming
        }
        if (!hasStreaming && state.activeStreamSessionId === message.sessionId) {
          partial.activeStreamSessionId = null
        }
      }

      return partial
    })
    if (message.streamStatus === 'streaming') {
      const actualContent = resolvedContent || serverContentPayload
      const actualReasoning = resolvedReasoning || reasoningPayload
      const shouldPersist =
        actualContent.length > 0 ||
        actualReasoning.length > 0 ||
        normalizedToolEvents.length > 0
      if (shouldPersist) {
        persistCompletionSnapshot({
          sessionId: message.sessionId,
          messageId: typeof message.id === 'number' ? Number(message.id) : null,
          clientMessageId: message.clientMessageId ?? null,
          content: actualContent,
          reasoning: actualReasoning,
          reasoningPlayedLength: actualReasoning.length,
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
  }

  return { applyServerMessageSnapshot }
}
