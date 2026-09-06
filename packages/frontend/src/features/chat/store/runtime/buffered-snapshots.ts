import type { ChatState } from '@/types'
import {
  buildVariantSelections,
  ensureBody,
  inferToolStatus,
  mergeToolEventsForMessage,
  messageKey,
} from '../utils'
import {
  getSessionCompletionSnapshots,
  removeCompletionSnapshot,
  snapshotDebug,
} from './snapshot-store'
import type { ChatStoreGetState, ChatStoreSetState } from '../types'

export const createBufferedSnapshotApplier = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
) => {
  const applyBufferedSnapshots = (sessionId: number) => {
    if (typeof window === 'undefined') return
    const snapshots = getSessionCompletionSnapshots(sessionId)
    if (!snapshots.length) return
    snapshotDebug('apply:start', { sessionId, total: snapshots.length })

    // 收集在快照应用过程中被标记为终态的消息，用于后续清理快照
    const terminalSnapshotIds: Array<{
      messageId: number | null
      clientMessageId: string | null
    }> = []

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
        // 消息流状态已经处于终态（done/cancelled/error），且未等待服务端同步时
        // 跳过快照应用，避免用旧的 streaming 快照覆盖已完成的终态
        if (
          meta.streamStatus &&
          meta.streamStatus !== 'streaming' &&
          meta.streamStatus !== 'pending' &&
          !meta.pendingSync
        ) {
          return
        }

        const key = messageKey(meta.id)
        const prevBody = ensureBody(nextBodies[key], meta.id, meta.stableKey)
        const snapshotContent = snapshot.content || ''
        const snapshotReasoning = snapshot.reasoning || ''
        // 使用前缀比较避免快照覆盖服务器已持久化的更新内容：
        // 只在服务器内容为空，或快照内容更长且服务器内容是快照前缀时才应用快照
        // 修复刷新页面后正文不自动更新的问题：快照数据可能比服务器 DB 数据更旧
        const serverContentEmpty = prevBody.content.length === 0
        const snapshotExtendsServer =
          snapshotContent.length > prevBody.content.length &&
          snapshotContent.startsWith(prevBody.content)
        const contentChanged =
          snapshotContent.length > 0 &&
          snapshotContent !== prevBody.content &&
          (serverContentEmpty || snapshotExtendsServer)
        const serverReasoningEmpty = (prevBody.reasoning ?? '').length === 0
        const snapshotReasoningExtendsServer =
          snapshotReasoning.length > (prevBody.reasoning ?? '').length &&
          snapshotReasoning.startsWith(prevBody.reasoning ?? '')
        const reasoningChanged =
          snapshotReasoning.length > 0 &&
          snapshotReasoning !== (prevBody.reasoning ?? '') &&
          (serverReasoningEmpty || snapshotReasoningExtendsServer)
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
          // 正文增长时必须失效旧 HTML（与 live SSE flushStreamBuffer 对称）。
          // 刷新后走 progress 轮询时若保留缓存，MessageBubble 宽松匹配会继续展示截断正文。
          // 仅推理/工具变更且仍在 streaming 时可保留正文 HTML，避免无意义重渲染。
          if (contentChanged || meta.streamStatus !== 'streaming') {
            const cache = ensureRenderCache()
            delete cache[key]
          }
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

        const baseStreamStatus = meta.streamStatus ?? 'done'
        const baseReasoningStatus = meta.reasoningStatus
        let nextStreamStatus =
          snapshot.streamStatus ?? baseStreamStatus
        // 如果服务器状态已结束/取消/错误，忽略本地“streaming”快照，避免刷新后状态回滚
        if (baseStreamStatus && baseStreamStatus !== 'streaming' && nextStreamStatus === 'streaming') {
          nextStreamStatus = baseStreamStatus
        }
        let nextReasoningStatus = snapshot.reasoningStatus ?? baseReasoningStatus
        // 如果整体流状态已是终态（done/cancelled/error），强制将 reasoningStatus 也设为 done
        // 修复刷新页面后思维链状态不显示结束的问题
        const isTerminalStreamStatus = nextStreamStatus && nextStreamStatus !== 'streaming'
        if (isTerminalStreamStatus && (nextReasoningStatus === 'streaming' || nextReasoningStatus === 'idle')) {
          nextReasoningStatus = 'done'
        }
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

        // 记录进入终态的消息，供外层清理对应的 localStorage 快照
        if (
          isTerminalStreamStatus &&
          nextStreamStatus !== 'streaming' &&
          nextStreamStatus !== 'pending'
        ) {
          terminalSnapshotIds.push({
            messageId:
              typeof meta.id === 'number' && Number.isFinite(meta.id)
                ? Number(meta.id)
                : snapshot.messageId,
            clientMessageId: meta.clientMessageId ?? snapshot.clientMessageId ?? null,
          })
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

      // 快照应用后重新计算 isStreaming，避免快照中的 streamStatus 修改
      // 导致 isStreaming 与 messageMetas 不一致。
      // 例如：刷新页面后关闭再打开，localStorage 中的 stale 快照可能
      // 将已完成消息的 streamStatus 回退为 'streaming'，而此时
      // fetchMessages 已在前面将 isStreaming 设为 false，造成状态分裂。
      const effectiveMetas = metasMutated ? nextMetas : state.messageMetas
      const currentSessionId = state.currentSession?.id ?? null
      const hasStreamingMeta = effectiveMetas.some(
        (meta) => meta.sessionId === currentSessionId && meta.streamStatus === 'streaming',
      )
      if (currentSessionId === sessionId) {
        if (hasStreamingMeta !== state.isStreaming) {
          partial.isStreaming = hasStreamingMeta
        }
        if (!hasStreamingMeta && state.activeStreamSessionId === sessionId) {
          partial.activeStreamSessionId = null
        }
      }

      return partial
    })

    // 清理已处理完毕的完成快照：对于 meta 已处于终态的消息，
    // 其快照已完成使命，删除以减量并防止后续页面加载时产生 stale 状态。
    // 使用 queueMicrotask 确保在 React 批处理状态更新后再执行清理操作。
    if (typeof window !== 'undefined' && terminalSnapshotIds.length > 0) {
      queueMicrotask(() => {
        for (const id of terminalSnapshotIds) {
          removeCompletionSnapshot(sessionId, {
            messageId: id.messageId,
            clientMessageId: id.clientMessageId,
          })
        }
      })
    }
  }

  return { applyBufferedSnapshots }
}
