import type { ChatState, MessageMeta } from '@/types'
import { messageKey } from '../utils'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreSetState,
  MessageId,
} from '../types'

export interface StreamStateRuntime {
  activeStreams: Map<string, ActiveStreamEntry>
  registerActiveStream: (entry: ActiveStreamEntry) => void
  unregisterActiveStream: (streamKey: string) => void
  findStreamByAssistantId: (messageId: MessageId | null | undefined) => ActiveStreamEntry | null
  findStreamByClientMessageId: (clientMessageId?: string | null) => ActiveStreamEntry | null
  recomputeStreamingState: () => void
  streamingFlagUpdate: (
    state: ChatState,
    sessionId: number | null,
    streaming: boolean,
  ) => Partial<ChatState>
}

export const createStreamStateRuntime = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
): StreamStateRuntime => {
  const activeStreams = new Map<string, ActiveStreamEntry>()

  const sessionStreamingUpdate = (sessionId: number, delta: number) => {
    if (!Number.isFinite(sessionId)) return
    set((state) => {
      const current = { ...(state.streamingSessions || {}) }
      const prev = current[sessionId] ?? 0
      const next = Math.max(0, prev + delta)
      if (next <= 0) {
        delete current[sessionId]
      } else {
        current[sessionId] = next
      }
      return {
        streamingSessions: current,
        activeStreamCount: activeStreams.size,
      }
    })
    recomputeStreamingState()
  }

  const registerActiveStream = (entry: ActiveStreamEntry) => {
    activeStreams.set(entry.streamKey, entry)
    sessionStreamingUpdate(entry.sessionId, 1)
  }

  const unregisterActiveStream = (streamKey: string) => {
    const entry = activeStreams.get(streamKey)
    if (!entry) return
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    activeStreams.delete(streamKey)
    sessionStreamingUpdate(entry.sessionId, -1)
  }

  const findStreamByAssistantId = (messageId: MessageId | null | undefined): ActiveStreamEntry | null => {
    if (typeof messageId === 'undefined' || messageId === null) return null
    const target = messageKey(messageId)
    for (const stream of activeStreams.values()) {
      if (messageKey(stream.assistantId) === target) {
        return stream
      }
    }
    return null
  }

  const findStreamByClientMessageId = (clientMessageId?: string | null): ActiveStreamEntry | null => {
    if (!clientMessageId) return null
    for (const stream of activeStreams.values()) {
      if (stream.clientMessageId && stream.clientMessageId === clientMessageId) {
        return stream
      }
      if (stream.assistantClientMessageId && stream.assistantClientMessageId === clientMessageId) {
        return stream
      }
    }
    return null
  }

  const recomputeStreamingState = () => {
    const snapshot = get()
    const currentSessionId = snapshot.currentSession?.id ?? null
    const streamingCounts = snapshot.streamingSessions || {}
    const activeForCurrent = currentSessionId ? streamingCounts[currentSessionId] ?? 0 : 0
    const hasStreamingMeta = snapshot.messageMetas.some(
      (meta) => meta.sessionId === currentSessionId && meta.streamStatus === 'streaming',
    )
    const shouldFlagCurrent = Boolean(currentSessionId) && (activeForCurrent > 0 || hasStreamingMeta)
    const nextActiveSessionId = shouldFlagCurrent ? currentSessionId : null
    const updates: Partial<ChatState> = {}
    if (snapshot.isStreaming !== shouldFlagCurrent) {
      updates.isStreaming = shouldFlagCurrent
    }
    if (snapshot.activeStreamSessionId !== nextActiveSessionId) {
      updates.activeStreamSessionId = nextActiveSessionId
    }
    if (Object.keys(updates).length > 0) {
      set(updates)
    }
  }

  const streamingFlagUpdate = (
    state: ChatState,
    sessionId: number | null,
    streaming: boolean,
  ): Partial<ChatState> => {
    if (streaming) {
      if (sessionId == null) return {}
      return {
        activeStreamSessionId: sessionId,
        isStreaming: state.currentSession?.id === sessionId,
      }
    }
    if (sessionId == null) {
      if (state.activeStreamSessionId == null && !state.isStreaming) {
        return {}
      }
      return { activeStreamSessionId: null, isStreaming: false }
    }
    if (state.activeStreamSessionId !== sessionId) {
      return {}
    }
    return {
      activeStreamSessionId: null,
      isStreaming: state.currentSession?.id === sessionId ? false : state.isStreaming,
    }
  }

  return {
    activeStreams,
    registerActiveStream,
    unregisterActiveStream,
    findStreamByAssistantId,
    findStreamByClientMessageId,
    recomputeStreamingState,
    streamingFlagUpdate,
  }
}
