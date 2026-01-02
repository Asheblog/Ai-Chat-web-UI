import {
  cancelAgentStream,
  cancelStream,
  getMessageByClientId,
  streamChat,
} from '@/features/chat/api'
import { summarizeSessionTitle } from '@/features/chat/api/sessions'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'
import type { Message, MessageStreamMetrics } from '@/types'
import type { StreamSlice } from '../types'
import type { ChatSliceCreator } from '../types'
import { StreamSendOptions } from '../types'
import {
  buildVariantSelections,
  createBody,
  createMeta,
  enforceVariantLimitLocally,
  generateLocalStableKey,
  mergeImages,
  messageKey,
  resolveProviderSafetyMessage,
} from '../utils'

const computeStreamMetrics = (
  params: {
    startedAt?: number | null
    firstChunkAt?: number | null
    completedAt?: number | null
  },
  usage?: import('../types').StreamUsageSnapshot | null,
): MessageStreamMetrics | null => {
  const normalizeNumber = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  const startedAt = normalizeNumber(params.startedAt)
  const firstChunkAt = normalizeNumber(params.firstChunkAt)
  const completedAt = normalizeNumber(params.completedAt)
  const promptTokens = normalizeNumber(usage?.prompt_tokens)
  const completionTokens = normalizeNumber(usage?.completion_tokens)
  const totalTokens = normalizeNumber(usage?.total_tokens)

  const firstTokenLatencyMs =
    startedAt != null && firstChunkAt != null && firstChunkAt >= startedAt
      ? firstChunkAt - startedAt
      : null
  const responseTimeMs =
    startedAt != null && completedAt != null && completedAt >= startedAt
      ? completedAt - startedAt
      : null
  const speedDurationMs =
    completedAt != null
      ? completedAt - (firstChunkAt ?? startedAt ?? completedAt)
      : null
  const tokensPerSecond =
    completionTokens != null && speedDurationMs != null && speedDurationMs > 0
      ? completionTokens / (speedDurationMs / 1000)
      : null

  const metrics: MessageStreamMetrics = {
    firstTokenLatencyMs,
    responseTimeMs,
    tokensPerSecond,
    promptTokens,
    completionTokens:
      completionTokens != null
        ? completionTokens
        : totalTokens != null && promptTokens != null
          ? totalTokens - promptTokens
          : null,
    totalTokens,
  }
  const hasValue = Object.values(metrics).some((value) => typeof value === 'number')
  return hasValue ? metrics : null
}

export const createStreamSlice: ChatSliceCreator<
  StreamSlice & {
    isStreaming: boolean
    activeStreamSessionId: number | null
    streamingSessions: Record<number, number>
    activeStreamCount: number
  }
> = (set, get, runtime) => ({
  isStreaming: false,
  activeStreamSessionId: null,
  streamingSessions: {},
  activeStreamCount: 0,

  sendMessage: async (sessionId: number, content: string) => {
    await get().streamMessage(sessionId, content)
  },

  streamMessage: async (sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: StreamSendOptions) => {
    const snapshot = get()
    const session = snapshot.sessions.find((s) => s.id === sessionId) || snapshot.currentSession
    if (!session || session.id !== sessionId) {
      set({ error: '会话不存在或未选中' })
      return
    }
    const replyToMessageId =
      typeof options?.replyToMessageId === 'number' || typeof options?.replyToMessageId === 'string'
        ? (options?.replyToMessageId as number | string)
        : null
    const isRegenerate = replyToMessageId !== null
    let parentUserMeta: import('@/types').MessageMeta | null = null
    if (isRegenerate) {
      parentUserMeta =
        snapshot.messageMetas.find(
          (meta) =>
            meta.sessionId === sessionId &&
            meta.role === 'user' &&
            messageKey(meta.id) === messageKey(replyToMessageId!),
        ) ?? null
      if (!parentUserMeta) {
        set({ error: '未找到关联的用户消息，无法重新生成回答' })
        return
      }
    }

    if (!isRegenerate) {
      try {
        const isTarget = snapshot.currentSession?.id === sessionId
        const isDefaultTitle =
          isTarget &&
          (!!snapshot.currentSession?.title === false ||
            snapshot.currentSession?.title === '新的对话' ||
            snapshot.currentSession?.title === 'New Chat')
        const userMessageCount = snapshot.messageMetas.filter(
          (meta) => meta.sessionId === sessionId && meta.role === 'user',
        ).length
        const noUserMessagesYet = userMessageCount === 0

        if (isTarget && isDefaultTitle && noUserMessagesYet && content) {
          // 获取系统设置，判断是否启用智能标题总结
          const systemSettings = useSettingsStore.getState().systemSettings
          const titleSummaryEnabled = systemSettings?.titleSummaryEnabled === true

          if (titleSummaryEnabled) {
            // 异步调用智能标题总结 API（不阻塞消息发送）
            ;(async () => {
              try {
                const result = await summarizeSessionTitle(sessionId, content)
                if (result?.title) {
                  set((state) => ({
                    sessions: state.sessions.map((s) =>
                      s.id === sessionId ? { ...s, title: result.title } : s,
                    ),
                    currentSession:
                      state.currentSession?.id === sessionId
                        ? { ...state.currentSession, title: result.title }
                        : state.currentSession,
                  }))
                }
              } catch {
                // 智能总结失败，fallback 到简单截断
                const deriveTitle = (text: string) => {
                  let s = text
                    .replace(/```[\s\S]*?```/g, ' ')
                    .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
                    .replace(/^[#>\-\*\s]+/gm, '')
                    .replace(/\n+/g, ' ')
                    .trim()
                  const limit = 30
                  return s.length > limit ? s.slice(0, limit) : s
                }
                const titleCandidate = deriveTitle(content)
                if (titleCandidate) {
                  set((state) => ({
                    sessions: state.sessions.map((s) =>
                      s.id === sessionId ? { ...s, title: titleCandidate } : s,
                    ),
                    currentSession:
                      state.currentSession?.id === sessionId
                        ? { ...state.currentSession, title: titleCandidate }
                        : state.currentSession,
                  }))
                  get().updateSessionTitle(sessionId, titleCandidate).catch(() => {})
                }
              }
            })()
          } else {
            // 智能总结未启用，使用原有的截断逻辑
            const deriveTitle = (text: string) => {
              let s = text
                .replace(/```[\s\S]*?```/g, ' ')
                .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
                .replace(/^[#>\-\*\s]+/gm, '')
                .replace(/\n+/g, ' ')
                .trim()
              const limit = 30
              return s.length > limit ? s.slice(0, limit) : s
            }
            const titleCandidate = deriveTitle(content)
            if (titleCandidate) {
              const prevTitle = snapshot.currentSession?.title || '新的对话'
              set((state) => ({
                sessions: state.sessions.map((s) =>
                  s.id === sessionId ? { ...s, title: titleCandidate } : s,
                ),
                currentSession:
                  state.currentSession?.id === sessionId
                    ? { ...state.currentSession, title: titleCandidate }
                    : state.currentSession,
              }))
              get()
                .updateSessionTitle(sessionId, titleCandidate)
                .catch(() => {
                  set((state) => ({
                    sessions: state.sessions.map((s) =>
                      s.id === sessionId ? { ...s, title: prevTitle } : s,
                    ),
                    currentSession:
                      state.currentSession?.id === sessionId
                        ? { ...state.currentSession, title: prevTitle }
                        : state.currentSession,
                  }))
                })
            }
          }
        }
      } catch {
        // ignore rename errors
      }
    }

    const userClientMessageId =
      isRegenerate
        ? null
        : (() => {
            try {
              return (crypto as any)?.randomUUID?.() ?? ''
            } catch {
              return ''
            }
          })() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

    const now = new Date().toISOString()
    const baseId = Date.now()
    const userMessageId: number = baseId
    const assistantMessageId: number = baseId + 1
    const userMessage: Message | null = isRegenerate
      ? null
      : {
          id: userMessageId,
          sessionId,
          role: 'user',
          content,
          createdAt: now,
          clientMessageId: userClientMessageId || undefined,
          images: images?.length
            ? images.map((img) => `data:${img.mime};base64,${img.data}`)
            : undefined,
        }

    const settingsSnapshot = useSettingsStore.getState()
    const { contextEnabled } = settingsSnapshot
    const maxConcurrentStreams = Math.max(1, settingsSnapshot.systemSettings?.chatMaxConcurrentStreams ?? 1)
    const activeCountSnapshot = get().activeStreamCount ?? 0
    if (activeCountSnapshot >= maxConcurrentStreams) {
      set({
        error: `当前已有 ${activeCountSnapshot}/${maxConcurrentStreams} 个任务生成中，请稍后再试或先停止部分任务。`,
      })
      return
    }

    const reasoningPreference =
      snapshot.currentSession?.id === sessionId
        ? snapshot.currentSession?.reasoningEnabled
        : snapshot.sessions.find((s) => s.id === sessionId)?.reasoningEnabled
    const normalizedReasoningPreference =
      typeof reasoningPreference === 'boolean' ? reasoningPreference : undefined
    const resolvedReasoningEnabled =
      options?.reasoningEnabled ?? normalizedReasoningPreference ?? true
    const reasoningDesired = Boolean(resolvedReasoningEnabled)

    const parentMessageId: number | string | null = isRegenerate ? replyToMessageId : userMessage?.id ?? null
    const existingVariantCount = parentMessageId
      ? snapshot.messageMetas.filter(
          (meta) =>
            meta.role === 'assistant' &&
            meta.parentMessageId != null &&
            messageKey(meta.parentMessageId) === messageKey(parentMessageId),
        ).length
      : 0

    const assistantStableKey = generateLocalStableKey()
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      sessionId,
      role: 'assistant',
      content: '',
      createdAt: now,
      stableKey: assistantStableKey,
      parentMessageId: parentMessageId ?? undefined,
      variantIndex: parentMessageId ? existingVariantCount + 1 : undefined,
    }

    const removeAssistantPlaceholder = () => {
      set((state) => {
        const key = messageKey(assistantPlaceholder.id)
        const metas = state.messageMetas.filter((meta) => meta.id !== assistantPlaceholder.id)
        const bodies = { ...state.messageBodies }
        delete bodies[key]
        const renderCache = { ...state.messageRenderCache }
        delete renderCache[key]
        return {
          messageMetas: metas,
          assistantVariantSelections: buildVariantSelections(metas),
          messageBodies: bodies,
          messageRenderCache: renderCache,
        }
      })
    }

    set((state) => {
      const nextCache =
        !isRegenerate &&
        userMessage?.clientMessageId &&
        userMessage.images &&
        userMessage.images.length > 0
          ? { ...state.messageImageCache, [userMessage.clientMessageId]: userMessage.images }
          : state.messageImageCache
      const metas = [
        ...state.messageMetas,
        ...(userMessage ? [createMeta(userMessage)] : []),
        createMeta(assistantPlaceholder, { isPlaceholder: true, streamStatus: 'streaming' }),
      ]
      const bodies = {
        ...state.messageBodies,
        ...(userMessage ? { [messageKey(userMessage.id)]: createBody(userMessage) } : {}),
        [messageKey(assistantPlaceholder.id)]: createBody(assistantPlaceholder),
      }
      const renderCache = { ...state.messageRenderCache }
      delete renderCache[messageKey(assistantPlaceholder.id)]

      let limitedMetas = metas
      let removedVariantIds: Array<number | string> = []
      if (parentMessageId != null) {
        const result = enforceVariantLimitLocally(metas, parentMessageId)
        limitedMetas = result.metas
        removedVariantIds = result.removedIds
      }
      removedVariantIds.forEach((id) => {
        const key = messageKey(id)
        delete bodies[key]
        delete renderCache[key]
      })

      return {
        messageMetas: limitedMetas,
        assistantVariantSelections: buildVariantSelections(limitedMetas),
        messageBodies: bodies,
        messageRenderCache: renderCache,
        messageImageCache: nextCache,
        isStreaming: state.currentSession?.id === sessionId,
        activeStreamSessionId: sessionId,
        error: null,
      }
    })

    const streamKey =
      (userClientMessageId && `client:${userClientMessageId}`) ||
      `assistant:${messageKey(assistantPlaceholder.id)}:${Date.now().toString(36)}`
    const streamEntry = {
      sessionId,
      assistantId: assistantPlaceholder.id,
      content: '',
      reasoning: '',
      reasoningPlayedLength: 0,
      pendingContent: '',
      pendingReasoning: '',
      pendingMeta: {},
      flushTimer: null,
      reasoningDesired,
      reasoningActivated: false,
      clientMessageId: userClientMessageId ?? null,
      assistantClientMessageId: null,
      webSearchRequested: Boolean(options?.features?.web_search),
      lastUsage: null,
      startedAt: Date.now(),
      firstChunkAt: null,
      completedAt: null,
      streamKey,
      stopRequested: false,
    }
    runtime.registerActiveStream(streamEntry)

    const { replyToMessageId: _omittedReply, replyToClientMessageId: _omittedClientReply, ...forwardOptions } =
      options || {}

    const startStream = () =>
      streamChat(sessionId, content, isRegenerate ? undefined : images, {
        ...forwardOptions,
        contextEnabled,
        clientMessageId: userClientMessageId ?? undefined,
        streamKey,
        replyToMessageId:
          isRegenerate && typeof replyToMessageId === 'number' ? replyToMessageId : undefined,
        replyToClientMessageId: isRegenerate
          ? parentUserMeta?.clientMessageId ??
            (typeof replyToMessageId === 'string' ? replyToMessageId : undefined)
          : undefined,
      })

    try {
      const iterator = startStream()
      for await (const evt of iterator) {
        const active = runtime.activeStreams.get(streamEntry.streamKey)
        if (!active) break

        if (evt?.type === 'start') {
          if (
            typeof evt.messageId === 'number' &&
            Number.isFinite(evt.messageId) &&
            active.clientMessageId
          ) {
            const realUserId = Number(evt.messageId)
            const clientId = active.clientMessageId
            const placeholderUserId =
              typeof userMessageId === 'number' && Number.isFinite(userMessageId)
                ? userMessageId
                : null

            set((state) => {
              const userMetaIdx = state.messageMetas.findIndex(
                (meta) =>
                  meta.role === 'user' &&
                  meta.clientMessageId === clientId &&
                  meta.id !== realUserId,
              )
              if (userMetaIdx === -1) return state

              const prevMeta = state.messageMetas[userMetaIdx]
              const prevKey = messageKey(prevMeta.id)
              const nextKey = messageKey(realUserId)

              const nextMetas = state.messageMetas.slice()
              nextMetas[userMetaIdx] = {
                ...prevMeta,
                id: realUserId,
              }

              for (let i = 0; i < nextMetas.length; i += 1) {
                const meta = nextMetas[i]
                if (
                  meta.role === 'assistant' &&
                  meta.parentMessageId != null &&
                  messageKey(meta.parentMessageId) === prevKey
                ) {
                  nextMetas[i] = { ...meta, parentMessageId: realUserId }
                }
              }

              const nextBodies = { ...state.messageBodies }
              const prevBody = nextBodies[prevKey]
              if (prevBody) {
                nextBodies[nextKey] = { ...prevBody, id: realUserId }
                delete nextBodies[prevKey]
              }

              const nextRenderCache = { ...state.messageRenderCache }
              if (nextRenderCache[prevKey]) {
                nextRenderCache[nextKey] = nextRenderCache[prevKey]
                delete nextRenderCache[prevKey]
              }

              return {
                messageMetas: nextMetas,
                assistantVariantSelections: buildVariantSelections(nextMetas),
                messageBodies: nextBodies,
                messageRenderCache: nextRenderCache,
              }
            })

            if (assistantPlaceholder.parentMessageId === placeholderUserId) {
              assistantPlaceholder.parentMessageId = realUserId
            }
          }

          if (typeof evt.assistantMessageId === 'number') {
            const nextId = evt.assistantMessageId
            if (messageKey(active.assistantId) !== messageKey(nextId)) {
              const prevKey = messageKey(active.assistantId)
              const nextKey = messageKey(nextId)
              set((state) => {
                const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === prevKey)
                const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
                if (metaIndex !== -1) {
                  nextMetas[metaIndex] = {
                    ...nextMetas[metaIndex],
                    id: nextId,
                    streamStatus: 'streaming',
                    isPlaceholder: false,
                  }
                }
                const prevBody = state.messageBodies[prevKey]
                const nextBodies = { ...state.messageBodies }
                if (prevBody) {
                  delete nextBodies[prevKey]
                  nextBodies[nextKey] = { ...prevBody, id: nextId }
                }
                const nextRenderCache = { ...state.messageRenderCache }
                if (nextRenderCache[prevKey]) {
                  nextRenderCache[nextKey] = nextRenderCache[prevKey]
                  delete nextRenderCache[prevKey]
                }
                const nextToolEvents =
                  state.toolEvents.length > 0
                    ? state.toolEvents.map((event) =>
                        messageKey(event.messageId) === prevKey
                          ? { ...event, messageId: nextId }
                          : event,
                      )
                    : state.toolEvents
                const partial: Partial<import('@/types').ChatState> = {}
                if (metaIndex !== -1) partial.messageMetas = nextMetas
                if (metaIndex !== -1) {
                  partial.assistantVariantSelections = buildVariantSelections(nextMetas)
                }
                if (prevBody) partial.messageBodies = nextBodies
                if (nextRenderCache[nextKey]) partial.messageRenderCache = nextRenderCache
                if (nextToolEvents !== state.toolEvents) {
                  partial.toolEvents = nextToolEvents
                }
                return Object.keys(partial).length > 0 ? partial : state
              })
              active.assistantId = nextId
              assistantPlaceholder.id = nextId
            }
          }
          if (typeof evt.assistantClientMessageId === 'string') {
            active.assistantClientMessageId = evt.assistantClientMessageId
          }
          continue
        }

        if (evt?.type === 'tool') {
          set((state) => {
            const list = state.toolEvents.slice()
            const eventId = (evt.id as string) || `${sessionId}-${Date.now()}`
            const idx = list.findIndex((item) => item.id === eventId && item.sessionId === sessionId)
            const detailPayload =
              evt.details && typeof evt.details === 'object'
                ? (evt.details as import('@/types').ToolEvent['details'])
                : undefined
            const next: import('@/types').ToolEvent = {
              id: eventId,
              sessionId,
              messageId: active.assistantId,
              tool: (evt.tool as string) || 'web_search',
              stage: (evt.stage as 'start' | 'result' | 'error') || 'start',
              status:
                evt.stage === 'error'
                  ? 'error'
                  : evt.stage === 'result'
                    ? 'success'
                    : 'running',
              query: evt.query as string | undefined,
              hits: (Array.isArray(evt.hits) ? evt.hits : undefined) as import('@/types').ToolEvent['hits'],
              error: evt.error as string | undefined,
              summary: evt.summary as string | undefined,
              createdAt: idx === -1 ? Date.now() : list[idx].createdAt,
              details: detailPayload ? { ...detailPayload } : list[idx]?.details,
            }
            if (idx === -1) {
              list.push(next)
            } else {
              list[idx] = {
                ...list[idx],
                ...next,
                details: detailPayload
                  ? { ...(list[idx].details ?? {}), ...detailPayload }
                  : list[idx].details,
              }
            }
            runtime.snapshotDebug('tool:add', {
              sessionId,
              messageId: next.messageId,
              stage: next.stage,
              total: list.length,
            })
            return { toolEvents: list }
          })
          runtime.persistSnapshotForStream(active)
          continue
        }

        if (evt?.type === 'error') {
          const fallback =
            typeof evt.error === 'string' && evt.error.trim()
              ? evt.error
              : '工具调用失败，请稍后重试'
          const friendlyMessage = resolveProviderSafetyMessage(evt.error) ?? fallback
          const agentError = new Error(friendlyMessage)
          ;(agentError as any).handled = 'agent_error'
          runtime.updateMetaStreamStatus(active.assistantId, 'error', friendlyMessage)
          throw agentError
        }

        // 处理生图模型返回的图片
        if (evt?.type === 'image' && evt.generatedImages) {
          set((state) => {
            const assistantKey = messageKey(active.assistantId)
            // 更新 messageMeta
            const metaIndex = state.messageMetas.findIndex(
              (meta) => messageKey(meta.id) === assistantKey,
            )
            const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
            if (metaIndex !== -1) {
              nextMetas[metaIndex] = {
                ...nextMetas[metaIndex],
                generatedImages: evt.generatedImages,
              }
            }
            // 更新 messageBody
            const prevBody = state.messageBodies[assistantKey]
            const nextBodies = prevBody
              ? {
                  ...state.messageBodies,
                  [assistantKey]: {
                    ...prevBody,
                    generatedImages: evt.generatedImages,
                  },
                }
              : state.messageBodies

            return {
              messageMetas: nextMetas,
              messageBodies: nextBodies,
            }
          })
          continue
        }

        if (evt?.type === 'content' && evt.content) {
          if (!active.firstChunkAt) {
            active.firstChunkAt = Date.now()
          }
          active.pendingContent += evt.content
          runtime.scheduleFlush(active)
          continue
        }

        if (evt?.type === 'reasoning') {
          if (!active.reasoningDesired) continue

          const chunkHasContent = typeof evt.content === 'string' && evt.content.length > 0
          if (!active.reasoningActivated && !chunkHasContent && !evt.keepalive) {
            continue
          }

          if (!active.reasoningActivated) {
            active.reasoningActivated = true
            active.pendingMeta.reasoningStatus = 'idle'
          }

          if (evt.keepalive) {
            active.pendingMeta.reasoningStatus = 'idle'
            active.pendingMeta.reasoningIdleMs = evt.idleMs ?? null
            runtime.scheduleFlush(active)
            continue
          }

          if (evt.content) {
            active.pendingReasoning += evt.content
            active.pendingMeta.reasoningStatus = 'streaming'
            active.pendingMeta.reasoningIdleMs = null
          }

          if (evt.done) {
            active.pendingMeta.reasoningStatus = 'done'
            if (evt.duration != null) {
              active.pendingMeta.reasoningDurationSeconds = evt.duration
            }
          }

          runtime.scheduleFlush(active)
          continue
        }

        if (evt?.type === 'usage' && evt.usage) {
          const usage = evt.usage
          set((state) => ({
            usageCurrent: {
              prompt_tokens: usage.prompt_tokens,
              context_limit: usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
              context_remaining:
                usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
            },
            usageLastRound:
              usage.completion_tokens != null || usage.total_tokens != null
                ? usage
                : state.usageLastRound,
          }))
          if (active) {
            active.lastUsage = usage as import('../types').StreamUsageSnapshot
          }
          continue
        }

        if (evt?.type === 'quota' && evt.quota) {
          useAuthStore.getState().updateQuota(evt.quota)
          continue
        }

        if (evt?.type === 'complete') {
          const activeBuffer = active
          if (activeBuffer) {
            activeBuffer.pendingMeta.reasoningStatus = 'done'
            activeBuffer.completedAt = Date.now()
            // 保存后端发送的 metrics
            if (evt.metrics) {
              activeBuffer.serverMetrics = {
                firstTokenLatencyMs: evt.metrics.firstTokenLatencyMs ?? null,
                responseTimeMs: evt.metrics.responseTimeMs ?? null,
                tokensPerSecond: evt.metrics.tokensPerSecond ?? null,
                promptTokens: null,
                completionTokens: null,
                totalTokens: null,
              }
            }
          }
          runtime.scheduleFlush(active)
          continue
        }
      }

      const finalStream = runtime.activeStreams.get(streamEntry.streamKey) ?? null
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
      runtime.flushStreamBuffer(finalStream, true)
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
          streamStatus: 'done',
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
        runtime.updateMetaStreamStatus(completedAssistantId, 'done')
      }
      runtime.clearActiveStream(finalStream)
      runtime.recomputeStreamingState()
      set((state) => runtime.streamingFlagUpdate(state, sessionId, false))
      get().fetchUsage(sessionId).catch(() => {})
      get().fetchSessionsUsage().catch(() => {})
    } catch (error: any) {
      const interruptedContext = runtime.activeStreams.get(streamEntry.streamKey) ?? null
      const manualStopRequested = interruptedContext?.stopRequested ?? false
      runtime.flushStreamBuffer(interruptedContext, true)
      runtime.clearActiveStream(interruptedContext)
      runtime.recomputeStreamingState()

      const quotaPayload = error?.payload?.quota ?? null
      if (quotaPayload) {
        useAuthStore.getState().updateQuota(quotaPayload)
      }

      const isStreamIncomplete =
        error?.code === 'STREAM_INCOMPLETE' ||
        (typeof error?.message === 'string' && error.message.includes('Stream closed before completion'))
      const isAbortError =
        error?.name === 'AbortError' ||
        error?.code === 20 ||
        (typeof error?.message === 'string' && error.message.toLowerCase().includes('aborted'))

      const trySyncFinalResult = async (): Promise<boolean> => {
        const candidates = [
          interruptedContext?.assistantClientMessageId ?? null,
          interruptedContext?.clientMessageId ?? null,
          userClientMessageId ?? null,
        ]
        const seen = new Set<string>()
        for (const candidate of candidates) {
          if (typeof candidate !== 'string') continue
          const trimmed = candidate.trim()
          if (!trimmed || seen.has(trimmed)) continue
          seen.add(trimmed)
          try {
            const res = await getMessageByClientId(sessionId, trimmed)
            const serverMessage = res?.data?.message
            if (serverMessage) {
              const merged = mergeImages(serverMessage, get().messageImageCache)
              runtime.applyServerMessageSnapshot(merged)
              if (typeof merged.id === 'number') {
                runtime.updateMetaStreamStatus(merged.id, merged.streamStatus ?? 'done')
              }
              set((state) => runtime.streamingFlagUpdate(state, sessionId, false))
              get().fetchUsage(sessionId).catch(() => {})
              get().fetchSessionsUsage().catch(() => {})
              return true
            }
          } catch (syncError: any) {
            if (syncError?.response?.status === 404) {
              continue
            }
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.debug('[streamMessage] sync failure', syncError?.message || syncError)
            }
          }
        }
        return false
      }

      const recoverInterruptedStream = async () => {
        const synced = await trySyncFinalResult()
        if (synced) {
          return true
        }
        const messageId =
          typeof interruptedContext?.assistantId === 'number'
            ? interruptedContext.assistantId
            : typeof assistantPlaceholder.id === 'number'
              ? assistantPlaceholder.id
              : null
        if (messageId !== null) {
          runtime.startMessageProgressWatcher(sessionId, messageId)
        }
        set((state) => runtime.streamingFlagUpdate(state, sessionId, false))
        return true
      }

      if (isAbortError) {
        if (manualStopRequested) {
          return
        }
        await recoverInterruptedStream()
        return
      }

      if (isStreamIncomplete) {
        await recoverInterruptedStream()
        return
      }

      if (error?.handled === 'agent_error') {
        const message =
          resolveProviderSafetyMessage(error) || error?.message || '工具调用失败，请稍后重试'
        runtime.updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
        set((state) => ({
          error: message,
          ...runtime.streamingFlagUpdate(state, sessionId, false),
        }))
        removeAssistantPlaceholder()
        return
      }

      if (error?.status === 429) {
        const message = error?.payload?.error || '额度不足，请登录或等待次日重置'
        runtime.updateMetaStreamStatus(assistantPlaceholder.id, 'error', message)
        set((state) => ({
          error: message,
          ...runtime.streamingFlagUpdate(state, sessionId, false),
        }))
        removeAssistantPlaceholder()
        return
      }

      const providerSafetyMessage = resolveProviderSafetyMessage(error)
      if (providerSafetyMessage) {
        runtime.updateMetaStreamStatus(assistantPlaceholder.id, 'error', providerSafetyMessage)
        set((state) => ({
          error: providerSafetyMessage,
          ...runtime.streamingFlagUpdate(state, sessionId, false),
        }))
        removeAssistantPlaceholder()
        return
      }

      const synced = await trySyncFinalResult()
      if (synced) {
        return
      }

      const genericError = resolveProviderSafetyMessage(error) || error?.message || '发送消息失败'
      runtime.updateMetaStreamStatus(assistantPlaceholder.id, 'error', genericError)
      set((state) => ({
        error: genericError,
        ...runtime.streamingFlagUpdate(state, sessionId, false),
      }))
      removeAssistantPlaceholder()
    }
  },

  stopStreaming: () => {
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

    const streamingMeta =
        snapshot.messageMetas.find(
          (meta) => meta.role === 'assistant' && meta.streamStatus === 'streaming',
        ) ?? null
    const fallbackAssistantId =
      typeof streamingMeta?.id === 'number' ? streamingMeta.id : null
    const fallbackClientId = streamingMeta?.clientMessageId ?? null
    if (currentSessionId && (fallbackAssistantId || fallbackClientId)) {
      cancelAgentStream(currentSessionId, {
          clientMessageId: fallbackClientId ?? undefined,
          messageId: fallbackAssistantId ?? undefined,
        }).catch(() => {})
      if (fallbackAssistantId != null) {
        set((state) => {
          const key = messageKey(fallbackAssistantId)
          const idx = state.messageMetas.findIndex((meta) => messageKey(meta.id) === key)
          if (idx === -1) return state
          const prevMeta = state.messageMetas[idx]
          if (prevMeta.reasoningStatus === 'done' && prevMeta.reasoningIdleMs == null) {
            return state
          }
          const nextMetas = state.messageMetas.slice()
          nextMetas[idx] = {
            ...prevMeta,
            reasoningStatus: 'done',
            reasoningIdleMs: null,
          }
          return { messageMetas: nextMetas }
        })
        runtime.updateMetaStreamStatus(fallbackAssistantId, 'cancelled', '已停止生成')
        const resolvedFallbackClientId =
          typeof fallbackClientId === 'string' && fallbackClientId.trim() ? fallbackClientId.trim() : null
        runtime.removeCompletionSnapshot(currentSessionId, {
          messageId: fallbackAssistantId,
          clientMessageId: resolvedFallbackClientId,
        })
      }
      set((state) => ({
        ...runtime.streamingFlagUpdate(state, currentSessionId, false),
        toolEvents: state.toolEvents.filter((event) => event.sessionId !== currentSessionId),
      }))
    }
  },
})
