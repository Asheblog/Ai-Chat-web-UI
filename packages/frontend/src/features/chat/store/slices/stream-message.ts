import { streamChat } from '@/features/chat/api'
import { useSettingsStore } from '@/store/settings-store'
import type { Message } from '@/types'
import type {
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
  StreamSendOptions,
} from '../types'
import {
  buildVariantSelections,
  createBody,
  createMeta,
  enforceVariantLimitLocally,
  generateLocalStableKey,
  messageKey,
} from '../utils'
import { recoverStreamError } from './stream-error'
import { handleStreamEvent } from './stream-events'
import { finalizeStream } from './stream-finalize'
import { maybeAutoTitleFirstMessage } from './stream-title'

export const createStreamMessageAction = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
  runtime: ChatStoreRuntime,
) => async (
  sessionId: number,
  content: string,
  images?: Array<{ data: string; mime: string }>,
  options?: StreamSendOptions,
) => {
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
    maybeAutoTitleFirstMessage({ get, set, sessionId, content, snapshot })
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
        imageDescriptions: null,
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
    webSearchRequested: Boolean(options?.skills?.builtin?.includes('web-search')),
    lastUsage: null,
    startedAt: Date.now(),
    firstChunkAt: null,
    completedAt: null,
    streamKey,
    stopRequested: false,
    lastSnapshotPersistedAt: 0,
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

      handleStreamEvent(evt, {
        active,
        assistantPlaceholder,
        userMessageId,
        sessionId,
        set,
        get,
        runtime,
      })
    }

    const finalStream = runtime.activeStreams.get(streamEntry.streamKey) ?? null
    finalizeStream({ finalStream, streamEntry, sessionId, get, set, runtime })
  } catch (error: any) {
    await recoverStreamError({
      error,
      streamEntry,
      sessionId,
      userClientMessageId,
      assistantPlaceholder,
      removeAssistantPlaceholder,
      get,
      set,
      runtime,
    })
  }
}
