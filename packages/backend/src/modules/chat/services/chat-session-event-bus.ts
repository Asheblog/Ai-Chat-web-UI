import { BackendLogger as log } from '../../../utils/logger'

export interface ChatStreamEvent {
  type: 'content_delta' | 'reasoning_delta' | 'tool_call' | 'message_complete' | 'stream_error'
  sessionId: number
  messageId?: number | string | null
  delta?: string
  toolEvent?: Record<string, unknown>
  error?: string
  ts: number
}

export type ChatStreamEventListener = (event: ChatStreamEvent) => void

export class ChatSessionEventBus {
  private listeners = new Map<number, Set<ChatStreamEventListener>>()

  publish(sessionId: number, event: ChatStreamEvent): void {
    const subs = this.listeners.get(sessionId)
    if (!subs || subs.size === 0) return
    for (const fn of subs) {
      try {
        fn(event)
      } catch (err) {
        log.error('[ChatSessionEventBus] listener error', { sessionId, eventType: event.type, err })
      }
    }
  }

  subscribe(sessionId: number, listener: ChatStreamEventListener): () => void {
    let subs = this.listeners.get(sessionId)
    if (!subs) {
      subs = new Set()
      this.listeners.set(sessionId, subs)
    }
    subs.add(listener)

    let cleaned = false
    return () => {
      if (cleaned) return
      cleaned = true
      const current = this.listeners.get(sessionId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  hasSubscribers(sessionId: number): boolean {
    const subs = this.listeners.get(sessionId)
    return !!subs && subs.size > 0
  }
}

export const chatSessionEventBus = new ChatSessionEventBus()
