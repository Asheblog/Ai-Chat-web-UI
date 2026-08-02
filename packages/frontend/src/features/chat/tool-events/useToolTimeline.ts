'use client'

import { useMemo } from 'react'
import type { ToolEvent } from '@/types'
import type { MessageId } from '@/features/chat/store/types'
import { messageKey } from '@/features/chat/store/utils'
import { useChatMessages } from '@/store/chat-store'
import {
  buildEventKey,
  buildToolSummary,
  compareToolEvents,
  mergeToolEvents,
  resolveEventStatus,
  type ToolTimelineSummary,
} from './tool-event-utils'

export type { ToolTimelineSummary }

interface UseToolTimelineOptions {
  sessionId: number
  messageId: MessageId
  bodyEvents?: ToolEvent[] | null
}

export const useToolTimeline = ({ sessionId, messageId, bodyEvents }: UseToolTimelineOptions) => {
  const streamingEvents = useChatMessages((state) => state.toolEvents)

  const relevantStreaming = useMemo(() => {
    const targetKey = messageKey(messageId)
    return streamingEvents.filter(
      (event) => event.sessionId === sessionId && messageKey(event.messageId) === targetKey,
    )
  }, [streamingEvents, sessionId, messageId])

  const historicalEvents = useMemo(
    () => (Array.isArray(bodyEvents) ? bodyEvents : []),
    [bodyEvents],
  )

  const timeline = useMemo(() => {
    if (historicalEvents.length === 0 && relevantStreaming.length === 0) {
      return [] as ToolEvent[]
    }
    const merged = new Map<string, ToolEvent>()
    let fallbackIndex = 0
    for (const event of [...historicalEvents, ...relevantStreaming]) {
      const key = buildEventKey(event, fallbackIndex++)
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, {
          ...event,
          status: resolveEventStatus(event),
        })
      } else {
        merged.set(key, mergeToolEvents(existing, event))
      }
    }
    return Array.from(merged.values()).sort(compareToolEvents)
  }, [historicalEvents, relevantStreaming])

  const summary: ToolTimelineSummary | null = useMemo(
    () => buildToolSummary(timeline),
    [timeline],
  )

  return {
    timeline,
    summary,
  }
}
