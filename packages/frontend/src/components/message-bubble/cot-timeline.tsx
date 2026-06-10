'use client'

import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Octagon,
  Shield,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MessageMeta, ToolEvent } from '@/types'
import type { TimelineNode, ToolGroupNode } from '@/features/chat/tool-events/useCoTTimeline'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'
import { formatDurationSeconds } from './message-metrics'
import { cn } from '@/lib/utils'
import { ToolCallCard } from './tool-call-card'

// ============================================================
// Utility functions (copied from tool-call-card.tsx)
// ============================================================

const formatToolName = (tool: string | undefined) => {
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

const statusMeta: Record<
  ToolEvent['status'],
  { label: string; icon: LucideIcon; className: string }
> = {
  running: {
    label: '执行中',
    icon: Loader2,
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  },
  success: {
    label: '完成',
    icon: CheckCircle2,
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  pending: {
    label: '待审批',
    icon: Clock3,
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
  error: {
    label: '失败',
    icon: XCircle,
    className: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  },
  rejected: {
    label: '已拒绝',
    icon: Shield,
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
  },
  aborted: {
    label: '已中止',
    icon: Octagon,
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  },
}

const resolvePrimaryText = (event: ToolEvent) => {
  if (event.status === 'error' || event.status === 'rejected' || event.status === 'aborted') {
    return event.error || event.summary || '调用未成功'
  }
  if (event.summary) return event.summary
  if (event.status === 'pending') return '等待工具审批后执行'
  if (event.status === 'running') return '工具执行中'
  return event.resultText || '工具调用完成'
}

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

const stringifyDetail = (value: unknown) => {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatDuration = (durationMs: unknown) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs)}ms`
}


// ============================================================
// localStorage persistence (same pattern as ReasoningSection)
// ============================================================

const STORAGE_KEY = 'aichat.cot_timeline_visibility'
const STORAGE_LIMIT = 200

interface VisibilityEntry {
  expanded: boolean
  updatedAt: number
}

const readVisibilityMap = (): Record<string, VisibilityEntry> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, VisibilityEntry>
  } catch {
    // ignore broken JSON
  }
  return {}
}

const loadPersisted = (key: string): boolean | null => {
  if (!key) return null
  const map = readVisibilityMap()
  return typeof map[key]?.expanded === 'boolean' ? map[key].expanded : null
}

const persistVisibility = (key: string, expanded: boolean) => {
  if (!key || typeof window === 'undefined') return
  const map = readVisibilityMap()
  map[key] = { expanded, updatedAt: Date.now() }
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const pruned = entries.slice(0, STORAGE_LIMIT)
  const next: Record<string, VisibilityEntry> = {}
  for (const [entryKey, entryValue] of pruned) {
    next[entryKey] = entryValue
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage quota exceeded; best-effort ignore
  }
}

// ============================================================
// Expand reducer (identical to ReasoningSection's)
// ============================================================

type ExpandSource = 'user' | 'auto' | 'default'

interface ExpandState {
  expanded: boolean
  source: ExpandSource
}

type ExpandAction =
  | { type: 'init'; defaultExpanded: boolean }
  | { type: 'set-default'; defaultExpanded: boolean }
  | { type: 'load-persisted'; expanded: boolean | null }
  | { type: 'auto-expand' }
  | { type: 'hide-if-empty'; hasAnyData: boolean }
  | { type: 'toggle' }

const expandReducer = (state: ExpandState, action: ExpandAction): ExpandState => {
  switch (action.type) {
    case 'init':
      return { expanded: action.defaultExpanded, source: 'default' }
    case 'set-default':
      if (state.source === 'user') return state
      return { ...state, expanded: action.defaultExpanded, source: 'default' }
    case 'load-persisted':
      if (action.expanded == null) return state
      return { expanded: action.expanded, source: 'user' }
    case 'auto-expand':
      if (state.source === 'user' || state.expanded) return state
      return { expanded: true, source: 'auto' }
    case 'hide-if-empty':
      if (state.source === 'user') return state
      if (action.hasAnyData) return state
      return { expanded: false, source: 'default' }
    case 'toggle':
      return { expanded: !state.expanded, source: 'user' }
    default:
      return state
  }
}

// ============================================================
// Sub-components
// ============================================================

interface ReasoningNodeItemProps {
  text: string
  isStreaming: boolean
  reasoningPlayedLength: number
}

function ReasoningNodeItem({ text, isStreaming, reasoningPlayedLength }: ReasoningNodeItemProps) {
  const lines = text.split('\n')
  const isLong = lines.length > 4
  const [expanded, setExpanded] = useState(false)

  if (isStreaming) {
    return (
      <div className="relative">
        {/* Dot */}
        <div className="absolute left-[-13px] top-[0.6rem] h-[6px] w-[6px] rounded-full border border-background bg-muted-foreground/40 sm:left-[-15px]" />
        <div className="text-sm leading-relaxed text-muted-foreground">
          <TypewriterReasoning
            text={text}
            isStreaming={true}
            initialPlayedLength={Math.max(0, reasoningPlayedLength)}
            speed={20}
          />
        </div>
      </div>
    )
  }

  const displayText = isLong && !expanded ? lines.slice(0, 4).join('\n') : text

  return (
    <div className="relative">
      {/* Dot */}
      <div className="absolute left-[-13px] top-[0.6rem] h-[6px] w-[6px] rounded-full border border-background bg-muted-foreground/40 sm:left-[-15px]" />
      <div className="text-sm leading-relaxed text-muted-foreground">
        <p className="whitespace-pre-wrap">{displayText}</p>
        {isLong && (
          <button
            type="button"
            className="mt-1 text-xs text-primary hover:underline"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起' : '展开全部'}
          </button>
        )}
      </div>
    </div>
  )
}

interface ToolNodeItemProps {
  event: ToolEvent
  onViewDetail: (event: ToolEvent) => void
}

function ToolNodeItem({ event, onViewDetail }: ToolNodeItemProps) {
  const meta = statusMeta[event.status]
  const StatusIcon = meta.icon
  const toolLabel = formatToolName(event.identifier || event.apiName || event.tool)
  const primaryText = resolvePrimaryText(event)
  const duration = formatDuration(event.details?.durationMs)
  const [expanded, setExpanded] = useState(false)

  const argumentText =
    pickString(
      event.argumentsText,
      event.details?.argumentsText,
      event.details?.input,
      event.details?.code,
      event.query,
    )
  const resultText =
    event.status !== 'running' && event.status !== 'pending'
      ? pickString(
          event.resultText,
          event.details?.resultText,
          event.details?.stdout,
        ) || stringifyDetail(event.resultJson ?? event.details?.resultJson)
      : null

  return (
    <div className="relative">
      {/* Tool dot */}
      <div className="absolute left-[-14px] top-[0.55rem] flex h-[10px] w-[10px] items-center justify-center rounded-full border border-border bg-background sm:left-[-16px]">
        <StatusIcon
          className={`h-[7px] w-[7px] ${event.status === 'running' ? 'animate-spin' : ''}`}
        />
      </div>

      {/* Compact card */}
      <div
        className={cn(
          'ml-1 cursor-pointer rounded-[6px] border border-border bg-card/60 px-2.5 py-2 transition-colors hover:border-primary/30',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <span className="truncate text-sm font-medium text-foreground">{toolLabel}</span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] ${meta.className}`}
          >
            {meta.label}
          </span>
          {duration && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{duration}</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">
          {primaryText}
        </p>
      </div>

      {/* Inline expansion */}
      {expanded && (
        <div className="ml-1 mt-1.5 space-y-1.5 border-t border-border/60 px-2.5 pb-1.5 pt-1.5">
          {argumentText && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                调用参数
              </span>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-border bg-muted/40 px-2 py-1.5 text-[11px] font-mono leading-5 text-foreground [overflow-wrap:anywhere]">
                {argumentText}
              </pre>
            </div>
          )}
          {resultText && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                执行结果
              </span>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-border bg-muted/40 px-2 py-1.5 text-[11px] font-mono leading-5 text-foreground [overflow-wrap:anywhere]">
                {resultText}
              </pre>
            </div>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation()
              onViewDetail(event)
            }}
          >
            查看完整详情
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Tool group node (merged tool calls)
// ============================================================

interface ToolGroupNodeItemProps {
  node: ToolGroupNode
  onViewDetail: (event: ToolEvent) => void
}

function ToolGroupNodeItem({ node, onViewDetail }: ToolGroupNodeItemProps) {
  const meta = statusMeta[node.status]
  const StatusIcon = meta.icon
  const toolLabel = formatToolName(node.toolType)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="relative">
      {/* Dot — uses same position as ToolNodeItem */}
      <div className="absolute left-[-14px] top-[0.55rem] flex h-[10px] w-[10px] items-center justify-center rounded-full border border-border bg-background sm:left-[-16px]">
        <StatusIcon
          className={`h-[7px] w-[7px] ${node.status === 'running' ? 'animate-spin' : ''}`}
        />
      </div>

      {/* Compact group card */}
      <div
        className={cn(
          'ml-1 cursor-pointer rounded-[6px] border border-border bg-card/60 px-2.5 py-2 transition-colors hover:border-primary/30',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <span className="truncate text-sm font-medium text-foreground">{toolLabel}</span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] ${meta.className}`}
          >
            {meta.label}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {node.events.length} 个调用
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">
          {node.summaryText}
        </p>
      </div>

      {/* Expanded child events */}
      {expanded && (
        <div className="ml-1 mt-1.5 space-y-1.5 border-t border-border/60 px-2.5 pb-1.5 pt-1.5">
          {node.events.map((event) => (
            <ToolNodeItem
              key={event.callId || event.id || `sub-${event.tool}`}
              event={event}
              onViewDetail={onViewDetail}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Props
// ============================================================

export interface CoTTimelineProps {
  meta: MessageMeta
  nodes: TimelineNode[]
  isStreaming: boolean
  reasoningStatus?: 'idle' | 'streaming' | 'done'
  reasoningDurationSeconds?: number
  reasoningPlayedLength?: number
  defaultExpanded: boolean
  reasoningUnavailableCode?: string
  reasoningUnavailableReason?: string
  reasoningUnavailableSuggestion?: string
}

const statusTextMap: Record<string, string> = {
  idle: '正在思考',
  streaming: '正在思考',
  done: '思考过程',
}

// ============================================================
// Main component
// ============================================================

export function CoTTimeline({
  meta,
  nodes,
  isStreaming,
  reasoningStatus,
  reasoningDurationSeconds,
  reasoningPlayedLength = 0,
  defaultExpanded,
  reasoningUnavailableCode,
  reasoningUnavailableReason,
  reasoningUnavailableSuggestion,
}: CoTTimelineProps) {
  // Persistence key: 'cot:{stableKey || id || clientMessageId}'
  const persistenceKey = useMemo(() => {
    if (meta.stableKey) return `cot:${meta.stableKey}`
    if (meta.id != null) return `cot:${String(meta.id)}`
    if (meta.clientMessageId) return `cot:${meta.clientMessageId}`
    return ''
  }, [meta.stableKey, meta.id, meta.clientMessageId])

  // Derived state
  const hasReasoningState = typeof reasoningStatus === 'string'
  const hasUnavailableReason =
    Boolean(reasoningUnavailableCode) ||
    Boolean(reasoningUnavailableReason) ||
    Boolean(reasoningUnavailableSuggestion)
  const hasAnyContent = nodes.length > 0 || hasReasoningState || hasUnavailableReason

  const isActiveStreaming = isStreaming && reasoningStatus !== 'done'
  const statusText = reasoningStatus ? (statusTextMap[reasoningStatus] ?? '思考过程') : '思考过程'
  const showStreamingIndicator =
    reasoningStatus === 'idle' || reasoningStatus === 'streaming'
  const durationText = formatDurationSeconds(reasoningDurationSeconds)

  const toolCount = useMemo(() => {
    let count = 0
    for (const n of nodes) {
      if (n.type === 'tool') count += 1
      else if (n.type === 'toolGroup') count += n.events.length
    }
    return count
  }, [nodes])

  // Expand state (same reducer pattern as ReasoningSection)
  const [{ expanded }, dispatch] = useReducer(
    expandReducer,
    { expanded: defaultExpanded, source: 'default' },
    () =>
      expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )

  useEffect(() => {
    if (!persistenceKey) return
    const persisted = loadPersisted(persistenceKey)
    dispatch({ type: 'load-persisted', expanded: persisted })
    // Only run on mount and when persistenceKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceKey])

  useEffect(() => {
    dispatch({ type: 'set-default', defaultExpanded })
  }, [defaultExpanded])

  useEffect(() => {
    dispatch({ type: 'hide-if-empty', hasAnyData: hasAnyContent })
  }, [hasAnyContent])

  useEffect(() => {
    if (isActiveStreaming) dispatch({ type: 'auto-expand' })
  }, [isActiveStreaming])

  // Find index of last reasoning node (for TypewriterReasoning)
  const lastReasoningIndex = useMemo(() => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type === 'reasoning') return i
    }
    return -1
  }, [nodes])

  // Full detail dialog state
  const [detailEvent, setDetailEvent] = useState<ToolEvent | null>(null)

  if (!hasAnyContent) {
    return null
  }

  return (
    <div className="mb-3 overflow-hidden rounded-[8px] border border-primary/20 bg-primary/5">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-primary/10"
        onClick={() => {
          dispatch({ type: 'toggle' })
          if (persistenceKey) persistVisibility(persistenceKey, !expanded)
        }}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-primary">
          <Brain className="h-4 w-4 shrink-0" />
          <span className="truncate">{statusText}</span>
          {showStreamingIndicator && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          {durationText && (
            <span className="shrink-0 text-xs text-muted-foreground">· {durationText}</span>
          )}
          {toolCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {toolCount} 个工具
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-primary/20">
          {/* Error banner */}
          {hasUnavailableReason && (
            <div className="mx-3 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{reasoningUnavailableCode || '推理不可用'}</span>
              </div>
              {reasoningUnavailableReason && (
                <p className="mt-1">{reasoningUnavailableReason}</p>
              )}
              {reasoningUnavailableSuggestion && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  {reasoningUnavailableSuggestion}
                </p>
              )}
            </div>
          )}

          {/* Empty placeholder when reasoning state exists but no nodes yet */}
          {nodes.length === 0 && hasReasoningState && (
            <div className="px-3 py-3 text-sm text-muted-foreground">等待思考内容...</div>
          )}

          {/* Timeline nodes */}
          {nodes.length > 0 && (
            <div className="relative py-2 pl-5 sm:pl-6">
              {/* Timeline line */}
              <div className="absolute bottom-3 left-[7px] top-3 w-px bg-border/60 sm:left-[9px]" />

              <div className="space-y-3">
                {nodes.map((node, index) => {
                  if (node.type === 'reasoning') {
                    const isLastReasoning = index === lastReasoningIndex
                    // Compute played length for this segment
                    const nodePlayedLength = isLastReasoning
                      ? Math.max(0, reasoningPlayedLength - node.charStart)
                      : 0
                    return (
                      <ReasoningNodeItem
                        key={`reasoning-${index}`}
                        text={node.text}
                        isStreaming={isLastReasoning && isActiveStreaming}
                        reasoningPlayedLength={nodePlayedLength}
                      />
                    )
                  }

                  if (node.type === 'tool') {
                    return (
                      <ToolNodeItem
                        key={`tool-${node.event.callId || node.event.id || index}`}
                        event={node.event}
                        onViewDetail={setDetailEvent}
                      />
                    )
                  }

                  if (node.type === 'toolGroup') {
                    return (
                      <ToolGroupNodeItem
                        key={`toolgroup-${node.toolType}-${index}`}
                        node={node}
                        onViewDetail={setDetailEvent}
                      />
                    )
                  }

                  return null
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full detail Dialog (reuses ToolCallCard in controlled mode) */}
      {detailEvent && (
        <ToolCallCard
          event={detailEvent}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDetailEvent(null)
          }}
        />
      )}
    </div>
  )
}
