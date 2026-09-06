import type { ChatState, MessageMeta } from '@/types'
import { messageKey } from '../utils'
import type { ChatStoreSetState, MessageId } from '../types'

export const createMetaStatusUpdater = (
  set: ChatStoreSetState,
  stopMessagePoller: (messageId: number) => void,
) => {
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

      // 在 set 回调内基于最新的 nextMetas 同步 isStreaming，
      // 避免外部 recomputeStreamingState() 读取到批处理前的旧状态
      const currentSid = state.currentSession?.id ?? null
      const hasStreaming = nextMetas.some(
        (meta) => meta.sessionId === currentSid && meta.streamStatus === 'streaming',
      )
      const partial: Partial<ChatState> = { messageMetas: nextMetas }
      if (currentSid != null) {
        if (hasStreaming !== state.isStreaming) {
          partial.isStreaming = hasStreaming
        }
        if (!hasStreaming && state.activeStreamSessionId === currentSid) {
          partial.activeStreamSessionId = null
        }
      }
      return partial
    })
    if (typeof messageId === 'number' && Number.isFinite(messageId)) {
      stopMessagePoller(messageId)
    }
  }

  return { updateMetaStreamStatus }
}
