'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import {
  buildInterleavedCotNodes,
  cotTimelineNodeKey,
  countCotTimelineTools,
  resolveSegmentPlayedLength,
  type CotTimelineNode,
} from '@aichat/shared/cot-timeline'
import type { MessageMeta, ToolEvent } from '@/types'
import { formatDurationSeconds } from './message-metrics'
import { CotReasoningStep, CotToolGroupStep, CotToolStep } from './cot-step-parts'

const STORAGE_KEY = 'aichat.cot_step_timeline_visibility'
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
    const parsed = JSON.parse(raw) as Record<string, VisibilityEntry>
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // ignore
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
  for (const [entryKey, entryValue] of pruned) next[entryKey] = entryValue
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore quota
  }
}

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

export interface CotStepTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  defaultExpanded?: boolean
  /** 流式中：推理末段打字机 */
  isStreaming?: boolean
  reasoningPlayedLength?: number
}

export function CotStepTimeline({
  meta,
  reasoningRaw,
  toolEvents,
  defaultExpanded = false,
  isStreaming = false,
  reasoningPlayedLength,
}: CotStepTimelineProps) {
  const persistenceKey = useMemo(() => {
    if (meta.stableKey) return `cot:${meta.stableKey}`
    if (meta.id != null) return `cot:${String(meta.id)}`
    if (meta.clientMessageId) return `cot:${meta.clientMessageId}`
    return ''
  }, [meta.clientMessageId, meta.id, meta.stableKey])

  const nodes = useMemo(
    () => buildInterleavedCotNodes(reasoningRaw, toolEvents),
    [reasoningRaw, toolEvents],
  )
  const { totalToolCount, activeToolCount } = useMemo(() => countCotTimelineTools(nodes), [nodes])
  const hasAnyData = nodes.length > 0
  const isActive =
    Boolean(isStreaming) ||
    meta.reasoningStatus === 'idle' ||
    meta.reasoningStatus === 'streaming' ||
    activeToolCount > 0

  const [{ expanded }, dispatch] = useReducer(
    expandReducer,
    { expanded: defaultExpanded, source: 'default' },
    () => expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )

  const durationText = formatDurationSeconds(meta.reasoningDurationSeconds)
  const hasMeaningfulDuration =
    durationText !== null && (meta.reasoningDurationSeconds ?? 0) > 0

  // 末段推理用于流式打字机：找最后一个 reasoning 节点
  const lastReasoningIndex = useMemo(() => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].type === 'reasoning') return i
    }
    return -1
  }, [nodes])

  useEffect(() => {
    if (!persistenceKey) return
    dispatch({ type: 'load-persisted', expanded: loadPersisted(persistenceKey) })
  }, [persistenceKey])

  useEffect(() => {
    dispatch({ type: 'set-default', defaultExpanded })
  }, [defaultExpanded])

  useEffect(() => {
    dispatch({ type: 'hide-if-empty', hasAnyData })
  }, [hasAnyData])

  useEffect(() => {
    if (isActive) dispatch({ type: 'auto-expand' })
    else dispatch({ type: 'set-default', defaultExpanded })
  }, [isActive, defaultExpanded])

  if (!hasAnyData) return null

  const headerLabel = isActive ? '深度思考过程' : '深度思考过程'
  const toolHint = totalToolCount > 0 ? ` · ${totalToolCount} 个工具` : ''

  return (
    <div className="mb-3 overflow-hidden rounded-[8px] border border-primary/20 bg-primary/5" data-message-panel="interactive">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-primary/10"
        onClick={() => {
          dispatch({ type: 'toggle' })
          const next = !expanded
          if (persistenceKey) persistVisibility(persistenceKey, next)
        }}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-primary">
          <Brain className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {expanded ? '收起' : '展开'}
            {` · ${headerLabel}`}
            {hasMeaningfulDuration && durationText ? ` · ${durationText}` : ''}
            {toolHint}
          </span>
          {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-primary/20 px-3 py-3 sm:px-4">
          {nodes.map((node, index) => (
            <CotStepNode
              key={cotTimelineNodeKey(node, index)}
              node={node}
              isStreamingTail={Boolean(isStreaming) && index === lastReasoningIndex && node.type === 'reasoning'}
              fullPlayedLength={reasoningPlayedLength}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CotStepNode({
  node,
  isStreamingTail,
  fullPlayedLength,
}: {
  node: CotTimelineNode
  isStreamingTail?: boolean
  fullPlayedLength?: number
}) {
  if (node.type === 'reasoning') {
    const segmentPlayed = resolveSegmentPlayedLength(
      fullPlayedLength,
      node.charStart,
      node.text.length,
    )
    return (
      <CotReasoningStep
        text={node.text}
        isStreamingTail={isStreamingTail}
        playedLength={segmentPlayed}
      />
    )
  }
  if (node.type === 'toolGroup') {
    return <CotToolGroupStep node={node} />
  }
  return <CotToolStep event={node.event} />
}
