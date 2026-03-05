import { getMessageProgress } from '@/features/chat/api'
import type { Message } from '@/types'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  MessageId,
} from '../types'

export interface ProgressWatcherRuntime {
  streamingPollers: Map<number, ReturnType<typeof setInterval>>
  stopMessagePoller: (messageId: number) => void
  stopAllMessagePollers: () => void
  startMessageProgressWatcher: (sessionId: number, messageId: number) => void
}

export const createProgressWatcherRuntime = (deps: {
  get: ChatStoreGetState
  findStreamByAssistantId: (messageId: MessageId | null | undefined) => ActiveStreamEntry | null
  applyServerMessageSnapshot: (message: Message) => void
}): ProgressWatcherRuntime => {
  const streamingPollers = new Map<number, ReturnType<typeof setInterval>>()
  const activeWatchers = new Set<number>()

  const stopMessagePoller = (messageId: number) => {
    const timer = streamingPollers.get(messageId)
    if (timer) {
      clearInterval(timer)
      streamingPollers.delete(messageId)
    }
    activeWatchers.delete(messageId)
  }

  const stopAllMessagePollers = () => {
    streamingPollers.forEach((timer) => clearInterval(timer))
    streamingPollers.clear()
    activeWatchers.clear()
  }

  const startMessageProgressWatcher = (sessionId: number, messageId: number) => {
    if (typeof messageId !== 'number' || Number.isNaN(messageId)) return
    if (deps.findStreamByAssistantId(messageId)) return
    if (activeWatchers.has(messageId)) return
    activeWatchers.add(messageId)

    const poll = async () => {
      const snapshot = deps.get()
      if (snapshot.currentSession?.id !== sessionId) {
        if (activeWatchers.has(messageId)) {
          setTimeout(poll, 500)
        }
        return
      }
      try {
        const response = await getMessageProgress(sessionId, messageId)
        const payload = response?.data?.message ?? (response?.data as Message | undefined)
        if (payload) {
          deps.applyServerMessageSnapshot(payload)
          if (payload.streamStatus && payload.streamStatus !== 'streaming') {
            stopMessagePoller(messageId)
            activeWatchers.delete(messageId)
            deps.get().fetchUsage(sessionId).catch(() => {})
            deps.get().fetchSessionsUsage().catch(() => {})
            return
          }
        }
      } catch (error: any) {
        const status = error?.response?.status
        if (status === 404 || status === 403) {
          stopMessagePoller(messageId)
          activeWatchers.delete(messageId)
          return
        }
      }
      if (activeWatchers.has(messageId)) {
        setTimeout(poll, 1500)
      }
    }

    poll()
  }

  return {
    streamingPollers,
    stopMessagePoller,
    stopAllMessagePollers,
    startMessageProgressWatcher,
  }
}
