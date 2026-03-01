'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import type { MessageMeta, ToolEvent } from '@/types'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'
import { ToolCallCard } from './tool-call-card'

const TOOL_CALL_VISIBILITY_STORAGE_KEY = 'aichat.tool_calls_visibility'
const TOOL_CALL_VISIBILITY_LIMIT = 200

interface ToolCallVisibilityEntry {
  expanded: boolean
  updatedAt: number
}

const readVisibilityMap = (): Record<string, ToolCallVisibilityEntry> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TOOL_CALL_VISIBILITY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ToolCallVisibilityEntry>
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // ignore broken JSON and fallback
  }
  return {}
}

const loadPersistedVisibility = (key: string): boolean | null => {
  if (!key) return null
  const map = readVisibilityMap()
  return typeof map[key]?.expanded === 'boolean' ? map[key].expanded : null
}

const persistVisibility = (key: string, expanded: boolean) => {
  if (!key || typeof window === 'undefined') return
  const map = readVisibilityMap()
  map[key] = { expanded, updatedAt: Date.now() }
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const pruned = entries.slice(0, TOOL_CALL_VISIBILITY_LIMIT)
  const next: Record<string, ToolCallVisibilityEntry> = {}
  for (const [entryKey, entryValue] of pruned) {
    next[entryKey] = entryValue
  }
  try {
    window.localStorage.setItem(TOOL_CALL_VISIBILITY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage quota exceeded; best-effort ignore
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
      if (state.source !== 'default') return state
      return { ...state, expanded: action.defaultExpanded }
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

interface ToolCallsSectionProps {
  meta: MessageMeta
  timeline: ToolEvent[]
  summary: ToolTimelineSummary | null
  defaultExpanded: boolean
}

export function ToolCallsSection({
  meta,
  timeline,
  summary,
  defaultExpanded,
}: ToolCallsSectionProps) {
  const persistenceKey = useMemo(() => {
    if (meta.stableKey) return `tool:${meta.stableKey}`
    if (meta.id != null) return `tool:${String(meta.id)}`
    if (meta.clientMessageId) return `tool:${meta.clientMessageId}`
    return ''
  }, [meta.clientMessageId, meta.id, meta.stableKey])

  const [{ expanded }, dispatch] = useReducer(
    expandReducer,
    { expanded: defaultExpanded, source: 'default' },
    () => expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )
  const hasToolCalls = timeline.length > 0
  const hasActiveCalls = timeline.some(
    (item) => item.status === 'running' || item.status === 'pending',
  )

  useEffect(() => {
    if (!persistenceKey) return
    const persisted = loadPersistedVisibility(persistenceKey)
    dispatch({ type: 'load-persisted', expanded: persisted })
  }, [persistenceKey])

  useEffect(() => {
    dispatch({ type: 'set-default', defaultExpanded })
  }, [defaultExpanded])

  useEffect(() => {
    dispatch({ type: 'hide-if-empty', hasAnyData: hasToolCalls })
  }, [hasToolCalls])

  useEffect(() => {
    if (hasActiveCalls) {
      dispatch({ type: 'auto-expand' })
    }
  }, [hasActiveCalls])

  if (!hasToolCalls) return null

  return (
    <div className="mb-3 rounded-lg border border-border/70 bg-muted/20" data-message-panel="interactive">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => {
          dispatch({ type: 'toggle' })
          const next = !expanded
          if (persistenceKey) persistVisibility(persistenceKey, next)
        }}
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Wrench className="h-4 w-4" />
            <span>工具调用 ({timeline.length})</span>
          </div>
          {summary?.summaryText && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary.summaryText}</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/60 px-2 py-2">
          {timeline.map((event) => (
            <ToolCallCard key={`${event.callId ?? event.id}-${event.updatedAt ?? event.createdAt}`} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}
