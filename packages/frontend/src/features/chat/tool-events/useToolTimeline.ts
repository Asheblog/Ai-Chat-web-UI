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
  successCount: number
  runningCount: number
  pendingCount: number
  errorCount: number
  rejectedCount: number
  abortedCount: number
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
  if (tool === 'document_search') return '文档搜索'
  if (tool === 'document_list') return '文档列表'
  if (tool === 'kb_search') return '知识库搜索'
  if (tool.startsWith('workspace_')) return '工作区工具'
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
  const aUpdatedAt = typeof a.updatedAt === 'number' ? a.updatedAt : a.createdAt
  const bUpdatedAt = typeof b.updatedAt === 'number' ? b.updatedAt : b.createdAt
  if (aUpdatedAt !== bUpdatedAt) return aUpdatedAt - bUpdatedAt
  return a.id.localeCompare(b.id)
}

const resolveEventStatus = (event: ToolEvent): ToolEvent['status'] => {
  if (
    event.status === 'running' ||
    event.status === 'success' ||
    event.status === 'error' ||
    event.status === 'pending' ||
    event.status === 'rejected' ||
    event.status === 'aborted'
  ) {
    return event.status
  }
  if (event.phase === 'pending_approval') return 'pending'
  if (event.phase === 'result') return 'success'
  if (event.phase === 'error') return 'error'
  if (event.phase === 'rejected') return 'rejected'
  if (event.phase === 'aborted') return 'aborted'
  if (event.stage === 'result') return 'success'
  if (event.stage === 'error') return 'error'
  return 'running'
}

const mergeToolEvents = (previous: ToolEvent, incoming: ToolEvent): ToolEvent => {
  const mergedDetails =
    previous.details || incoming.details
      ? { ...(previous.details ?? {}), ...(incoming.details ?? {}) }
      : undefined
  const nextCreatedAt = Number.isFinite(incoming.createdAt)
    ? Math.min(previous.createdAt, incoming.createdAt)
    : previous.createdAt
  const nextUpdatedAt = Math.max(
    typeof previous.updatedAt === 'number' ? previous.updatedAt : previous.createdAt,
    typeof incoming.updatedAt === 'number' ? incoming.updatedAt : incoming.createdAt,
  )
  const merged: ToolEvent = {
    ...previous,
    ...incoming,
    id: incoming.id || previous.id,
    callId: incoming.callId || previous.callId,
    tool: incoming.tool || incoming.identifier || previous.tool,
    identifier: incoming.identifier || previous.identifier,
    apiName: incoming.apiName || previous.apiName,
    createdAt: nextCreatedAt,
    updatedAt: nextUpdatedAt,
    details: mergedDetails,
  }
  const status = resolveEventStatus(merged)
  merged.status = status
  if (
    merged.stage !== 'start' &&
    merged.stage !== 'result' &&
    merged.stage !== 'error'
  ) {
    merged.stage = status === 'success' ? 'result' : status === 'running' || status === 'pending' ? 'start' : 'error'
  }
  return merged
}

const buildEventKey = (event: ToolEvent, fallbackIndex: number) => {
  if (typeof event.callId === 'string' && event.callId.trim().length > 0) return `call:${event.callId}`
  if (typeof event.id === 'string' && event.id.trim().length > 0) return `id:${event.id}`
  return `fallback:${fallbackIndex}`
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

  const summary: ToolTimelineSummary | null = useMemo(() => {
    if (timeline.length === 0) {
      return null
    }
    let runningCount = 0
    let successCount = 0
    let pendingCount = 0
    let errorCount = 0
    let rejectedCount = 0
    let abortedCount = 0
    const toolCounts = new Map<string, number>()

    timeline.forEach((event) => {
      const status = resolveEventStatus(event)
      if (status === 'success') successCount += 1
      else if (status === 'pending') pendingCount += 1
      else if (status === 'rejected') rejectedCount += 1
      else if (status === 'aborted') abortedCount += 1
      else if (status === 'error') errorCount += 1
      else runningCount += 1
      const toolName = event.identifier || event.apiName || event.tool
      toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1)
    })

    const parts: string[] = []
    if (successCount > 0) parts.push(`完成 ${successCount} 次`)
    if (runningCount > 0) parts.push(`进行中 ${runningCount} 次`)
    if (pendingCount > 0) parts.push(`待审批 ${pendingCount} 次`)
    if (rejectedCount > 0) parts.push(`拒绝 ${rejectedCount} 次`)
    if (abortedCount > 0) parts.push(`中止 ${abortedCount} 次`)
    if (errorCount > 0) parts.push(`失败 ${errorCount} 次`)
    const labelParts = Array.from(toolCounts.entries()).map(
      ([tool, count]) => `${describeTool(tool)} ${count} 次`,
    )

    return {
      total: timeline.length,
      summaryText: parts.join(' · ') || '等待工具结果',
      label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
      successCount,
      runningCount,
      pendingCount,
      errorCount,
      rejectedCount,
      abortedCount,
    }
  }, [timeline])

  return {
    timeline,
    summary,
  }
}
