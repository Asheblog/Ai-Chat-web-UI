import { getMessageByClientId } from '@/features/chat/api'
import { useAuthStore } from '@/store/auth-store'
import type { Message } from '@/types'
import { mergeImages, resolveProviderSafetyMessage } from '../utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
} from '../types'

export const recoverStreamError = async (deps: {
  error: any
  streamEntry: ActiveStreamEntry
  sessionId: number
  userClientMessageId: string | null
  assistantPlaceholder: Message
  removeAssistantPlaceholder: () => void
  get: ChatStoreGetState
  set: ChatStoreSetState
  runtime: ChatStoreRuntime
}): Promise<void> => {
  const {
    error,
    streamEntry,
    sessionId,
    userClientMessageId,
    assistantPlaceholder,
    removeAssistantPlaceholder,
    get,
    set,
    runtime,
  } = deps

  const interruptedContext = runtime.activeStreams.get(streamEntry.streamKey) ?? null
  const manualStopRequested =
    interruptedContext?.stopRequested ?? streamEntry.stopRequested ?? false
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

  if (manualStopRequested && (isAbortError || isStreamIncomplete)) {
    set((state) => runtime.streamingFlagUpdate(state, sessionId, false))
    return
  }

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
