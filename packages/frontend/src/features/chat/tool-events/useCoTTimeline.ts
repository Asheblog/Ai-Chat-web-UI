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

// ============================================================
// Tool group types & helpers
// ============================================================

export interface ToolGroupNode {
  type: 'toolGroup'
  toolType: string
  events: ToolEvent[]
  summaryText: string
  status: ToolEvent['status']
}

export type TimelineNode =
  | { type: 'reasoning'; text: string; charStart: number; charEnd: number }
  | { type: 'tool'; event: ToolEvent }
  | ToolGroupNode

const MERGEABLE_TOOLS = new Set(['web_search', 'read_url'])

function resolveToolType(event: ToolEvent): string {
  return event.identifier || event.apiName || event.tool || ''
}

const isActiveStatus = (s: string) => s === 'running' || s === 'pending'
const isFailedStatus = (s: string) => s === 'error' || s === 'rejected' || s === 'aborted'

function aggregateStatus(events: ToolEvent[]): ToolEvent['status'] {
  if (events.length === 0) return 'success'
  if (events.some((e) => isActiveStatus(e.status))) return 'running'
  if (events.every((e) => isFailedStatus(e.status))) return 'error'
  return 'success'
}

function buildSearchGroupSummary(searches: ToolEvent[], autoReads: ToolEvent[]): string {
  const engineCount = searches.length
  const doneCount = searches.filter((e) => e.status === 'success').length
  const runningCount = searches.filter((e) => isActiveStatus(e.status)).length
  const errorCount = searches.filter((e) => isFailedStatus(e.status)).length

  const parts: string[] = []

  if (runningCount > 0) {
    parts.push(`并行搜索 ${engineCount} 个引擎，${doneCount}/${engineCount} 完成`)
  } else {
    const totalHits = searches.reduce((sum, e) => {
      if (e.details?.hitsCount != null) return sum + e.details.hitsCount
      if (Array.isArray(e.hits)) return sum + e.hits.length
      if (e.resultJson && typeof e.resultJson === 'object') {
        const json = e.resultJson as Record<string, unknown>
        if (Array.isArray(json.hits)) return sum + json.hits.length
      }
      return sum
    }, 0)
    if (errorCount > 0) {
      parts.push(`搜索 ${engineCount} 个引擎，命中 ${totalHits} 条，${errorCount} 个失败`)
    } else {
      parts.push(`搜索 ${engineCount} 个引擎，命中 ${totalHits} 条`)
    }
  }

  if (autoReads.length > 0) {
    const readDone = autoReads.filter((e) => e.status === 'success').length
    const readRunning = autoReads.filter((e) => isActiveStatus(e.status)).length
    if (readRunning > 0) {
      parts.push(`自动读取 ${autoReads.length} 个网页，${readDone}/${autoReads.length} 完成`)
    } else {
      parts.push(`自动读取 ${autoReads.length} 个网页`)
    }
  }

  return parts.join('，')
}

function buildReadUrlGroupSummary(reads: ToolEvent[]): string {
  const doneCount = reads.filter((e) => e.status === 'success').length
  const runningCount = reads.filter((e) => isActiveStatus(e.status)).length

  if (runningCount > 0) {
    return `读取 ${reads.length} 个网页，${doneCount}/${reads.length} 完成`
  }
  return `已读取 ${reads.length} 个网页`
}

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
      // Clamp offset to reasoningText.length — guards against stale offsets
      // from raw-delta buffer that may exceed the final text length.
      const effectiveOffset = Math.min(offset, reasoningText.length)
      if (effectiveOffset > prevOffset && effectiveOffset <= reasoningText.length) {
        const text = reasoningText.slice(prevOffset, effectiveOffset).trim()
        if (text.length > 0) {
          nodes.push({ type: 'reasoning', text, charStart: prevOffset, charEnd: effectiveOffset })
        }
      }

      // Tool events at this offset — merge by type
      const toolsAtOffset = offsetGroups.get(offset)!
      const searchEvents = toolsAtOffset.filter((e) => resolveToolType(e) === 'web_search')
      const readEvents = toolsAtOffset.filter((e) => resolveToolType(e) === 'read_url')
      const otherEvents = toolsAtOffset.filter(
        (e) => !MERGEABLE_TOOLS.has(resolveToolType(e)),
      )

      // Merge search + auto-reads into one group
      if (searchEvents.length > 0 && readEvents.length > 0) {
        const allEvents = [...searchEvents, ...readEvents]
        nodes.push({
          type: 'toolGroup',
          toolType: 'web_search',
          events: allEvents,
          summaryText: buildSearchGroupSummary(searchEvents, readEvents),
          status: aggregateStatus(allEvents),
        })
      }
      // Merge standalone searches (2+ engines, no reads)
      else if (searchEvents.length >= 2) {
        nodes.push({
          type: 'toolGroup',
          toolType: 'web_search',
          events: searchEvents,
          summaryText: buildSearchGroupSummary(searchEvents, []),
          status: aggregateStatus(searchEvents),
        })
      }
      // Single search (no reads) — individual
      else if (searchEvents.length === 1) {
        nodes.push({ type: 'tool', event: searchEvents[0] })
      }
      // Merge standalone reads (2+ reads, no search)
      else if (readEvents.length >= 2) {
        nodes.push({
          type: 'toolGroup',
          toolType: 'read_url',
          events: readEvents,
          summaryText: buildReadUrlGroupSummary(readEvents),
          status: aggregateStatus(readEvents),
        })
      }
      // Single read (no search) — individual
      else if (readEvents.length === 1) {
        nodes.push({ type: 'tool', event: readEvents[0] })
      }

      // Non-mergeable events always individual
      for (const event of otherEvents) {
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
