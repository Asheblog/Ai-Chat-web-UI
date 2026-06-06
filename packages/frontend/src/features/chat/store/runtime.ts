import type {
  ChatState,
  Message,
  MessageBody,
  MessageMeta,
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
  STREAM_SNAPSHOT_PERSIST_INTERVAL,
} from './utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
  MessageId,
} from './types'

import {
  getSessionCompletionSnapshots,
  persistCompletionSnapshot,
  removeCompletionSnapshot,
  snapshotDebug,
} from './runtime/snapshot-store'
import { createStreamStateRuntime } from './runtime/stream-state'
import { createProgressWatcherRuntime } from './runtime/progress-watcher'

export const createChatStoreRuntime = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
): ChatStoreRuntime => {
  const streamState = createStreamStateRuntime(set, get)
  const {
    activeStreams,
    registerActiveStream,
    unregisterActiveStream,
    findStreamByAssistantId,
    findStreamByClientMessageId,
    recomputeStreamingState,
    streamingFlagUpdate,
  } = streamState
  let applyServerMessageSnapshotHandler: ((message: Message) => void) | null = null
  const progressWatcher = createProgressWatcherRuntime({
    get,
    findStreamByAssistantId,
    applyServerMessageSnapshot: (message) => {
      applyServerMessageSnapshotHandler?.(message)
    },
  })
  const {
    streamingPollers,
    stopMessagePoller,
    stopAllMessagePollers,
    startMessageProgressWatcher,
  } = progressWatcher

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
          // 流式传输期间保留旧的渲染 HTML，避免 ReactMarkdown 对不完整内容产生错误输出
          if (meta.streamStatus !== 'streaming') {
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
        // 流式传输期间保留旧的渲染 HTML，避免 ReactMarkdown 对不完整内容产生错误输出
        const currentMetaForStreamCheck = nextMetas.find((m) => messageKey(m.id) === key)
        const effectiveStreamStatus = message.streamStatus ?? currentMetaForStreamCheck?.streamStatus
        if (effectiveStreamStatus !== 'streaming') {
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
    // 延迟到状态批处理完成后重新计算 isStreaming，避免 get() 读到旧状态
    queueMicrotask(() => recomputeStreamingState())
  }
  applyServerMessageSnapshotHandler = applyServerMessageSnapshot

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
    // 延迟到状态批处理完成后重新计算 isStreaming，避免 get() 读到旧状态
    queueMicrotask(() => recomputeStreamingState())
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
