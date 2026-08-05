/**
 * 交错 CoT 步骤流节点构建 —— web / mobile 共用（RN 安全，无 DOM）。
 *
 * 对 raw reasoning 按 reasoningOffsetStart 切片，再对展示文本 strip 工具进度污染。
 */
import { stripToolProgressFromReasoning } from './strip-tool-progress-from-reasoning.js'
import type { ToolCallStatus } from './chat-stream-contract.js'
import {
  describeTool,
  mergeAndSortToolEvents,
  resolveEventStatus,
  resolveReasoningOffsetStart,
  type ToolEvent,
} from './tool-events.js'

export type ToolDisplayIconKey =
  | 'lightbulb'
  | 'search'
  | 'globe'
  | 'clock'
  | 'file'
  | 'code'
  | 'book'
  | 'wrench'

export interface ToolDisplayMeta {
  label: string
  iconKey: ToolDisplayIconKey
}

export type CotTimelineNode =
  | { type: 'reasoning'; text: string; charStart: number; charEnd: number }
  | { type: 'tool'; event: ToolEvent }
  | {
      type: 'toolGroup'
      toolType: string
      events: ToolEvent[]
      summaryText: string
      status: ToolCallStatus
    }

const MERGEABLE_TOOLS = new Set(['web_search', 'read_url'])

const resolveToolType = (event: ToolEvent): string =>
  event.identifier || event.apiName || event.tool || ''

const isActiveStatus = (status: string) => status === 'running' || status === 'pending'
const isFailedStatus = (status: string) =>
  status === 'error' || status === 'rejected' || status === 'aborted'

const aggregateStatus = (events: ToolEvent[]): ToolCallStatus => {
  if (events.length === 0) return 'success'
  if (events.some((event) => isActiveStatus(resolveEventStatus(event)))) return 'running'
  if (events.every((event) => isFailedStatus(resolveEventStatus(event)))) return 'error'
  return 'success'
}

const countHits = (event: ToolEvent): number => {
  if (typeof event.details?.hitsCount === 'number') return event.details.hitsCount
  if (Array.isArray(event.hits)) return event.hits.length
  if (event.resultJson && typeof event.resultJson === 'object') {
    const json = event.resultJson as Record<string, unknown>
    if (Array.isArray(json.hits)) return json.hits.length
  }
  return 0
}

const buildSearchGroupSummary = (searches: ToolEvent[], autoReads: ToolEvent[]): string => {
  const engineCount = searches.length
  const doneCount = searches.filter((event) => resolveEventStatus(event) === 'success').length
  const runningCount = searches.filter((event) => isActiveStatus(resolveEventStatus(event))).length
  const errorCount = searches.filter((event) => isFailedStatus(resolveEventStatus(event))).length
  const parts: string[] = []

  if (runningCount > 0) {
    parts.push(`并行搜索 ${engineCount} 个引擎，${doneCount}/${engineCount} 完成`)
  } else {
    const totalHits = searches.reduce((sum, event) => sum + countHits(event), 0)
    if (errorCount > 0) {
      parts.push(`搜索 ${engineCount} 个引擎，命中 ${totalHits} 条，${errorCount} 个失败`)
    } else {
      parts.push(`搜索 ${engineCount} 个引擎，命中 ${totalHits} 条`)
    }
  }

  if (autoReads.length > 0) {
    const readDone = autoReads.filter((event) => resolveEventStatus(event) === 'success').length
    const readRunning = autoReads.filter((event) => isActiveStatus(resolveEventStatus(event))).length
    if (readRunning > 0) {
      parts.push(`自动读取 ${autoReads.length} 个网页，${readDone}/${autoReads.length} 完成`)
    } else {
      parts.push(`自动读取 ${autoReads.length} 个网页`)
    }
  }

  return parts.join('，')
}

const buildReadUrlGroupSummary = (reads: ToolEvent[]): string => {
  const doneCount = reads.filter((event) => resolveEventStatus(event) === 'success').length
  const runningCount = reads.filter((event) => isActiveStatus(resolveEventStatus(event))).length
  if (runningCount > 0) {
    return `读取 ${reads.length} 个网页，${doneCount}/${reads.length} 完成`
  }
  return `已读取 ${reads.length} 个网页`
}

const pushReasoningNode = (
  nodes: CotTimelineNode[],
  reasoningRaw: string,
  charStart: number,
  charEnd: number,
) => {
  if (charEnd <= charStart) return
  const rawSlice = reasoningRaw.slice(charStart, charEnd)
  const text = stripToolProgressFromReasoning(rawSlice)
  if (!text) return
  nodes.push({ type: 'reasoning', text, charStart, charEnd })
}

const pushToolsAtOffset = (nodes: CotTimelineNode[], toolsAtOffset: ToolEvent[]) => {
  const searchEvents = toolsAtOffset.filter((event) => resolveToolType(event) === 'web_search')
  const readEvents = toolsAtOffset.filter((event) => resolveToolType(event) === 'read_url')
  const otherEvents = toolsAtOffset.filter((event) => !MERGEABLE_TOOLS.has(resolveToolType(event)))

  if (searchEvents.length > 0 && readEvents.length > 0) {
    const allEvents = [...searchEvents, ...readEvents]
    nodes.push({
      type: 'toolGroup',
      toolType: 'web_search',
      events: allEvents,
      summaryText: buildSearchGroupSummary(searchEvents, readEvents),
      status: aggregateStatus(allEvents),
    })
  } else if (searchEvents.length >= 2) {
    nodes.push({
      type: 'toolGroup',
      toolType: 'web_search',
      events: searchEvents,
      summaryText: buildSearchGroupSummary(searchEvents, []),
      status: aggregateStatus(searchEvents),
    })
  } else if (searchEvents.length === 1) {
    nodes.push({ type: 'tool', event: searchEvents[0] })
  } else if (readEvents.length >= 2) {
    nodes.push({
      type: 'toolGroup',
      toolType: 'read_url',
      events: readEvents,
      summaryText: buildReadUrlGroupSummary(readEvents),
      status: aggregateStatus(readEvents),
    })
  } else if (readEvents.length === 1) {
    nodes.push({ type: 'tool', event: readEvents[0] })
  }

  for (const event of otherEvents) {
    nodes.push({ type: 'tool', event })
  }
}

/**
 * 按 reasoningOffset 将推理文本与工具事件交错为步骤节点。
 * @param reasoningRaw 未 strip 的原始推理文本（offset 坐标系）
 * @param events 工具事件（内部会 merge/sort）
 */
export const buildInterleavedCotNodes = (
  reasoningRaw: string | null | undefined,
  events?: ToolEvent[] | null,
): CotTimelineNode[] => {
  const raw = typeof reasoningRaw === 'string' ? reasoningRaw : ''
  const sorted = mergeAndSortToolEvents(Array.isArray(events) ? events : [])

  const offsetGroups = new Map<number, ToolEvent[]>()
  const orphans: ToolEvent[] = []
  for (const event of sorted) {
    const offset = resolveReasoningOffsetStart(event)
    if (offset != null) {
      const group = offsetGroups.get(offset)
      if (group) group.push(event)
      else offsetGroups.set(offset, [event])
    } else {
      orphans.push(event)
    }
  }

  const nodes: CotTimelineNode[] = []
  let prevOffset = 0
  const sortedOffsets = Array.from(offsetGroups.keys()).sort((a, b) => a - b)

  for (const offset of sortedOffsets) {
    const effectiveOffset = Math.min(offset, raw.length)
    pushReasoningNode(nodes, raw, prevOffset, effectiveOffset)
    pushToolsAtOffset(nodes, offsetGroups.get(offset) || [])
    prevOffset = Math.max(prevOffset, effectiveOffset)
  }

  pushReasoningNode(nodes, raw, prevOffset, raw.length)

  for (const event of orphans) {
    nodes.push({ type: 'tool', event })
  }

  // 无工具且全文被 strip 空：仍可能有纯推理；若完全无节点且 raw strip 后有内容，补一段
  if (nodes.length === 0 && raw.trim()) {
    pushReasoningNode(nodes, raw, 0, raw.length)
  }

  return nodes
}

export const countCotTimelineTools = (nodes: CotTimelineNode[]): {
  totalToolCount: number
  activeToolCount: number
} => {
  let totalToolCount = 0
  let activeToolCount = 0
  for (const node of nodes) {
    if (node.type === 'tool') {
      totalToolCount += 1
      const status = resolveEventStatus(node.event)
      if (status === 'running' || status === 'pending') activeToolCount += 1
    } else if (node.type === 'toolGroup') {
      totalToolCount += node.events.length
      for (const event of node.events) {
        const status = resolveEventStatus(event)
        if (status === 'running' || status === 'pending') activeToolCount += 1
      }
    }
  }
  return { totalToolCount, activeToolCount }
}

export const resolveToolDisplay = (tool?: string | null): ToolDisplayMeta => {
  const id = (tool || '').trim()
  const label = describeTool(id || null)

  if (id === 'web_search') return { label, iconKey: 'globe' }
  if (id === 'read_url') return { label, iconKey: 'file' }
  if (id === 'python_runner') return { label, iconKey: 'code' }
  if (id === 'get_time_info' || id.includes('time')) {
    return { label: describeTool(id || null), iconKey: 'clock' }
  }
  if (id.startsWith('document_') || id.startsWith('kb_')) return { label, iconKey: 'book' }
  if (id.includes('search')) return { label, iconKey: 'search' }
  return { label, iconKey: 'wrench' }
}

export const buildToolStepTitle = (event: ToolEvent): string => {
  const toolId = event.identifier || event.apiName || event.tool
  const { label } = resolveToolDisplay(toolId)
  const query =
    (typeof event.query === 'string' && event.query.trim()) ||
    (typeof event.details?.originalQuery === 'string' && event.details.originalQuery.trim()) ||
    ''
  if ((toolId === 'web_search' || toolId === 'read_url') && query) {
    return `${label}：${query}`
  }
  return label
}

/**
 * React/RN 列表 key：推理段只按 charStart 稳定，避免流式 charEnd 增长导致打字机 remount 回退。
 */
export const cotTimelineNodeKey = (node: CotTimelineNode, index: number): string => {
  if (node.type === 'reasoning') return `r:${node.charStart}`
  if (node.type === 'tool') {
    return `t:${node.event.callId ?? node.event.id}`
  }
  return `g:${node.toolType}:${index}:${node.events.map((event) => event.callId ?? event.id).join(',')}`
}

/** 全文已播放长度 → 某推理段内的初始播放游标（用于 hydrate / 恢复） */
export const resolveSegmentPlayedLength = (
  fullPlayedLength: number | undefined | null,
  charStart: number,
  segmentTextLength: number,
): number => {
  if (typeof fullPlayedLength !== 'number' || !Number.isFinite(fullPlayedLength)) return 0
  return Math.max(0, Math.min(segmentTextLength, Math.floor(fullPlayedLength) - charStart))
}
