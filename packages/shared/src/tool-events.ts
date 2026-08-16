/**
 * ToolEvent 归一化 / 合并 / 排序 / 摘要 —— web 共用。
 *
 * 收敛历史 4 份重复实现：
 * - features/chat/tool-events/tool-event-utils.ts（规范版）
 * - features/chat/tool-events/useToolTimeline.ts（内联副本）
 * - features/battle/hooks/useBattleFlow.ts（merge/compare/key 变体）
 * - components/share/share-viewer.tsx（内联 normalizeStatus + merge/sort）
 *
 * 必须保持 React Native 安全：不依赖 DOM / Node API。
 */
import type {
  ToolCallPhase,
  ToolCallSource,
  ToolCallStatus,
  ToolEventDetails,
  ToolEventStage,
  ToolInterventionState,
  WebSearchHit,
} from './chat-stream-contract.js'

export interface ToolEvent {
  // 兼容字段（旧链路）
  id: string
  sessionId: number
  messageId: number | string
  tool: string
  stage: ToolEventStage
  status: ToolCallStatus
  query?: string
  hits?: WebSearchHit[]
  error?: string
  summary?: string
  createdAt: number
  details?: ToolEventDetails
  // ToolCall V2
  callId?: string
  identifier?: string
  apiName?: string
  source?: ToolCallSource
  phase?: ToolCallPhase
  argumentsText?: string
  argumentsPatch?: string
  resultText?: string
  resultJson?: unknown
  intervention?: ToolInterventionState
  thoughtSignature?: string | null
  updatedAt?: number
}

const isValidReasoningOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * 基于当前推理 buffer 长度回填 ToolEventDetails 的 reasoningOffsetStart/End/offset。
 * - start 或首次见到 callId：缺 Start 时写入
 * - result/error：写入 End
 * 未发生变更时返回原对象引用，调用方可用于判断是否需要复制 payload。
 */
export const applyReasoningOffsetsToDetails = (
  details: ToolEventDetails | undefined,
  reasoningBufferLength: number,
  stage: ToolEventStage,
  isFirstSight = false,
): ToolEventDetails | undefined => {
  if (stage !== 'start' && stage !== 'result' && stage !== 'error') {
    return details
  }

  const offset = Math.max(0, Math.floor(reasoningBufferLength))
  const next: ToolEventDetails = { ...(details ?? {}) }
  let changed = false

  if (!isValidReasoningOffset(next.reasoningOffsetStart) && (stage === 'start' || isFirstSight)) {
    next.reasoningOffsetStart = offset
    changed = true
  }

  if (stage === 'result' || stage === 'error') {
    next.reasoningOffsetEnd = offset
    changed = true
  }

  if (!isValidReasoningOffset(next.reasoningOffset) && isValidReasoningOffset(next.reasoningOffsetStart)) {
    next.reasoningOffset = next.reasoningOffsetStart
    changed = true
  }

  if (!changed) return details
  return next
}

export const resolveReasoningOffsetStart = (event: ToolEvent) => {
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

/**
 * 为工具事件 payload 写入 reasoningOffsetStart/End（基于当前推理 buffer 长度）。
 * - start 或首次见到 callId：缺 Start 时写入
 * - result/error：写入 End
 */
export const enrichToolEventReasoningOffsets = (
  payload: Record<string, unknown>,
  reasoningBufferLength: number,
  isFirstSight = false,
): Record<string, unknown> => {
  const stage = payload.stage
  if (stage !== 'start' && stage !== 'result' && stage !== 'error') {
    return payload
  }

  const rawDetails =
    payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
      ? (payload.details as ToolEventDetails)
      : undefined
  const details = applyReasoningOffsetsToDetails(
    rawDetails,
    reasoningBufferLength,
    stage,
    isFirstSight,
  )

  if (details === rawDetails) return payload
  return { ...payload, details }
}

export const compareToolEvents = (a: ToolEvent, b: ToolEvent) => {
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

export const resolveEventStatus = (event: ToolEvent): ToolEvent['status'] => {
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

export const mergeToolEvents = (previous: ToolEvent, incoming: ToolEvent): ToolEvent => {
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
    merged.stage =
      status === 'success' ? 'result' : status === 'running' || status === 'pending' ? 'start' : 'error'
  }
  return merged
}

export const buildEventKey = (event: ToolEvent, fallbackIndex: number) => {
  if (typeof event.callId === 'string' && event.callId.trim().length > 0) return `call:${event.callId}`
  if (typeof event.id === 'string' && event.id.trim().length > 0) return `id:${event.id}`
  return `fallback:${fallbackIndex}`
}

/**
 * 列表级合并 + 排序：按 callId/id 去重合并，返回按 reasoningOffset/createdAt 排序的时间轴。
 */
export const mergeAndSortToolEvents = (events: ToolEvent[]): ToolEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return []
  const merged = new Map<string, ToolEvent>()
  let fallbackIndex = 0
  for (const event of events) {
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
}

export const describeTool = (tool?: string | null) => {
  if (!tool) return '工具调用'
  if (tool === 'web_search') return '联网搜索'
  if (tool === 'python_runner') return 'Python 工具'
  if (tool === 'read_url') return '网页读取'
  if (tool === 'get_time_info') return '时间信息'
  if (tool === 'document_search') return '文档搜索'
  if (tool === 'document_list') return '文档列表'
  if (tool === 'kb_search') return '知识库搜索'
  if (tool === 'research_plan') return '研究计划'
  if (tool === 'export_pdf') return 'PDF 导出'
  if (tool.startsWith('workspace_')) return '工作区工具'
  return tool
}

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
  searchEngineCount: number
  searchQueryCount: number
  readTaskCount: number
}

/** 根据工具事件生成中文摘要（时间轴标签 / 分享视图共用） */
export const buildToolSummary = (toolEvents?: ToolEvent[]): ToolTimelineSummary | null => {
  if (!toolEvents || toolEvents.length === 0) return null

  const toolCounts = new Map<string, number>()
  let successCount = 0
  let runningCount = 0
  let pendingCount = 0
  let errorCount = 0
  let rejectedCount = 0
  let abortedCount = 0
  const searchEngines = new Set<string>()
  const searchQueries = new Set<string>()
  let readTaskCount = 0

  toolEvents.forEach((event) => {
    const status = resolveEventStatus(event)
    const toolName = event.identifier || event.apiName || event.tool
    toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1)
    if (status === 'success') successCount += 1
    else if (status === 'pending') pendingCount += 1
    else if (status === 'rejected') rejectedCount += 1
    else if (status === 'aborted') abortedCount += 1
    else if (status === 'error') errorCount += 1
    else runningCount += 1

    const taskType = typeof event.details?.taskType === 'string' ? event.details.taskType : null
    if (taskType === 'search') {
      if (typeof event.details?.engine === 'string' && event.details.engine.trim()) {
        searchEngines.add(event.details.engine.trim())
      }
      const queryCandidate =
        typeof event.details?.expandedQuery === 'string'
          ? event.details.expandedQuery
          : typeof event.query === 'string'
            ? event.query
            : ''
      if (queryCandidate.trim()) {
        searchQueries.add(queryCandidate.trim())
      }
    } else if (taskType === 'read_url') {
      readTaskCount += 1
    }
  })

  const parts: string[] = []
  if (successCount > 0) parts.push(`完成 ${successCount} 次`)
  if (runningCount > 0) parts.push(`进行中 ${runningCount} 次`)
  if (pendingCount > 0) parts.push(`待审批 ${pendingCount} 次`)
  if (rejectedCount > 0) parts.push(`拒绝 ${rejectedCount} 次`)
  if (abortedCount > 0) parts.push(`中止 ${abortedCount} 次`)
  if (errorCount > 0) parts.push(`失败 ${errorCount} 次`)
  if (searchEngines.size > 0 || searchQueries.size > 0) {
    parts.push(`并行搜索 ${searchEngines.size} 引擎/${searchQueries.size} 查询`)
  }
  if (readTaskCount > 0) {
    parts.push(`自动读取 ${readTaskCount} 次`)
  }

  const labelParts = Array.from(toolCounts.entries()).map(
    ([tool, count]) => `${describeTool(tool)} ${count} 次`,
  )

  return {
    total: toolEvents.length,
    summaryText: parts.join(' · ') || '等待工具结果',
    label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
    successCount,
    runningCount,
    pendingCount,
    errorCount,
    rejectedCount,
    abortedCount,
    searchEngineCount: searchEngines.size,
    searchQueryCount: searchQueries.size,
    readTaskCount,
  }
}
