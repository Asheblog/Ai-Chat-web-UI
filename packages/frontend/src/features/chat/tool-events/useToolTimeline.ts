'use client'

import { useMemo } from 'react'
import type { ToolEvent } from '@/types'
import type { MessageId } from '@/features/chat/store/types'
import { messageKey } from '@/features/chat/store/utils'
import { useChatMessages } from '@/store/chat-store'

export interface ToolTimelineSummary {
  total: number
  summaryText: string
  label: string
}

interface UseToolTimelineOptions {
  sessionId: number
  messageId: MessageId
  bodyEvents?: ToolEvent[] | null
}

const describeTool = (tool?: string | null) => {
  if (!tool) return '工具调用'
  if (tool === 'web_search') return '联网搜索'
  if (tool === 'python_runner') return 'Python 工具'
  if (tool === 'read_url') return '网页读取'
  return tool
}

const resolveReasoningOffsetStart = (event: ToolEvent) => {
  const details = event.details
  if (!details || typeof details !== 'object') return null
  const candidate =
    typeof details.reasoningOffsetStart === 'number'
      ? details.reasoningOffsetStart
      : typeof details.reasoningOffset === 'number'
        ? details.reasoningOffset
        : null
  return candidate != null && Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : null
}

const compareToolEvents = (a: ToolEvent, b: ToolEvent) => {
  const aOffset = resolveReasoningOffsetStart(a)
  const bOffset = resolveReasoningOffsetStart(b)
  if (aOffset != null && bOffset != null && aOffset !== bOffset) {
    return aOffset - bOffset
  }
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id.localeCompare(b.id)
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
    historicalEvents.forEach((event) => merged.set(event.id, event))
    relevantStreaming.forEach((event) => merged.set(event.id, event))
    return Array.from(merged.values()).sort(compareToolEvents)
  }, [historicalEvents, relevantStreaming])

  const summary: ToolTimelineSummary | null = useMemo(() => {
    if (timeline.length === 0) {
      return null
    }
    let running = 0
    let success = 0
    let error = 0
    const toolCounts = new Map<string, number>()
    timeline.forEach((event) => {
      if (event.stage === 'result') {
        success += 1
      } else if (event.stage === 'error') {
        error += 1
      } else {
        running += 1
      }
      toolCounts.set(event.tool, (toolCounts.get(event.tool) || 0) + 1)
    })
    const parts: string[] = []
    if (success > 0) parts.push(`完成 ${success} 次`)
    if (running > 0) parts.push(`进行中 ${running} 次`)
    if (error > 0) parts.push(`失败 ${error} 次`)
    const labelParts = Array.from(toolCounts.entries()).map(
      ([tool, count]) => `${describeTool(tool)} ${count} 次`,
    )
    return {
      total: timeline.length,
      summaryText: parts.join(' · ') || '等待工具结果',
      label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
    }
  }, [timeline])

  return {
    timeline,
    summary,
  }
}
