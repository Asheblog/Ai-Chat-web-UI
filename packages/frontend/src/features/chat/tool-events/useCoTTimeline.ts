'use client'

import { useMemo } from 'react'
import type { ToolEvent } from '@/types'
import type { MessageId } from '@/features/chat/store/types'
import { messageKey } from '@/features/chat/store/utils'
import { useChatMessages } from '@/store/chat-store'
import {
  resolveReasoningOffsetStart,
  compareToolEvents,
  resolveEventStatus,
  mergeToolEvents,
  buildEventKey,
} from './tool-event-utils'

export type TimelineNode =
  | { type: 'reasoning'; text: string; charStart: number; charEnd: number }
  | { type: 'tool'; event: ToolEvent }

interface UseCoTTimelineOptions {
  sessionId: number
  messageId: MessageId
  bodyEvents?: ToolEvent[] | null
  reasoningText: string
}

export const useCoTTimeline = ({
  sessionId,
  messageId,
  bodyEvents,
  reasoningText,
}: UseCoTTimelineOptions): { nodes: TimelineNode[]; activeToolCount: number; totalToolCount: number } => {
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

  return useMemo(() => {
    // 1. Merge historical + streaming events
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
    const sorted = Array.from(merged.values()).sort(compareToolEvents)

    // 2. Group events by reasoning offset
    const offsetGroups = new Map<number, ToolEvent[]>()
    const orphans: ToolEvent[] = []

    for (const event of sorted) {
      const offset = resolveReasoningOffsetStart(event)
      if (offset != null) {
        const group = offsetGroups.get(offset)
        if (group) {
          group.push(event)
        } else {
          offsetGroups.set(offset, [event])
        }
      } else {
        orphans.push(event)
      }
    }

    const sortedOffsets = Array.from(offsetGroups.keys()).sort((a, b) => a - b)

    // 3. Build interleaved timeline nodes
    const nodes: TimelineNode[] = []
    let prevOffset = 0

    for (const offset of sortedOffsets) {
      // Reasoning segment from prevOffset to current offset
      if (offset > prevOffset && offset <= reasoningText.length) {
        const text = reasoningText.slice(prevOffset, offset).trim()
        if (text.length > 0) {
          nodes.push({ type: 'reasoning', text, charStart: prevOffset, charEnd: offset })
        }
      }

      // Tool events at this offset
      const toolsAtOffset = offsetGroups.get(offset)!
      for (const event of toolsAtOffset) {
        nodes.push({ type: 'tool', event })
      }

      prevOffset = Math.max(prevOffset, offset)
    }

    // Remaining reasoning after last offset
    if (prevOffset < reasoningText.length) {
      const text = reasoningText.slice(prevOffset).trim()
      if (text.length > 0) {
        nodes.push({ type: 'reasoning', text, charStart: prevOffset, charEnd: reasoningText.length })
      }
    }

    // Append orphan tools at the end
    for (const event of orphans) {
      nodes.push({ type: 'tool', event })
    }

    // 4. Compute counts
    let activeToolCount = 0
    for (const event of sorted) {
      const status = resolveEventStatus(event)
      if (status === 'running' || status === 'pending') {
        activeToolCount += 1
      }
    }
    const totalToolCount = sorted.length

    return { nodes, activeToolCount, totalToolCount }
  }, [historicalEvents, relevantStreaming, reasoningText])
}
