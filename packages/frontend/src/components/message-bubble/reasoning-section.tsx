'use client'

import { useEffect, useMemo, useReducer } from 'react'
import type { MessageMeta, ToolEvent } from '@/types'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'
import { ToolTimeline } from './tool-timeline'

const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.reasoning_visibility'
const REASONING_VISIBILITY_LIMIT = 200

interface ReasoningVisibilityEntry {
  expanded: boolean
  updatedAt: number
}

const readVisibilityMap = (): Record<string, ReasoningVisibilityEntry> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(REASONING_VISIBILITY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ReasoningVisibilityEntry>
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
  const pruned = entries.slice(0, REASONING_VISIBILITY_LIMIT)
  const next: Record<string, ReasoningVisibilityEntry> = {}
  for (const [entryKey, entryValue] of pruned) {
    next[entryKey] = entryValue
  }
  try {
    window.localStorage.setItem(REASONING_VISIBILITY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage quota exceeded; best-effort ignore
  }
}

interface ReasoningSectionProps {
  meta: MessageMeta
  reasoningRaw: string
  reasoningHtml?: string
  reasoningPlayedLength?: number
  timeline: ToolEvent[]
  summary: ToolTimelineSummary | null
  defaultExpanded: boolean
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

export function ReasoningSection({
  meta,
  reasoningRaw,
  reasoningHtml,
  reasoningPlayedLength,
  timeline,
  summary,
  defaultExpanded,
}: ReasoningSectionProps) {
  const persistenceKey = useMemo(() => {
    if (meta.stableKey) return `msg:${meta.stableKey}`
    if (meta.id != null) return `msg:${String(meta.id)}`
    if (meta.clientMessageId) return `msg:${meta.clientMessageId}`
    return ''
  }, [meta.clientMessageId, meta.id, meta.stableKey])
  const reasoningTextLength = useMemo(() => reasoningRaw.trim().length, [reasoningRaw])
  const hasReasoningState = typeof meta.reasoningStatus === 'string'
  const [{ expanded: showReasoning }, dispatch] = useReducer(
    expandReducer,
    { expanded: defaultExpanded, source: 'default' },
    () => expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )
  const hasAnyContent = hasReasoningState || reasoningTextLength > 0 || timeline.length > 0
  const isAssistant = meta.role === 'assistant'
  const isActiveReasoning =
    isAssistant && (meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming')

  useEffect(() => {
    if (!persistenceKey) return
    const persisted = loadPersistedVisibility(persistenceKey)
    dispatch({ type: 'load-persisted', expanded: persisted })
  }, [persistenceKey])

  useEffect(() => {
    dispatch({ type: 'set-default', defaultExpanded })
  }, [defaultExpanded])

  useEffect(() => {
    dispatch({ type: 'hide-if-empty', hasAnyData: hasAnyContent })
  }, [hasAnyContent])

  useEffect(() => {
    if (isActiveReasoning) dispatch({ type: 'auto-expand' })
  }, [isActiveReasoning])

  useEffect(() => {
    if (!isAssistant) return
    if (timeline.length === 0) return
    dispatch({ type: 'auto-expand' })
  }, [isAssistant, timeline.length])

  if (
    reasoningTextLength === 0 &&
    !hasReasoningState &&
    (timeline == null || timeline.length === 0)
  ) {
    return null
  }

  return (
    <div className="mb-3">
      <ToolTimeline
        meta={meta}
        reasoningRaw={reasoningRaw}
        reasoningHtml={reasoningHtml}
        reasoningPlayedLength={reasoningPlayedLength}
        summary={summary}
        timeline={timeline}
        expanded={showReasoning}
        onToggle={() => {
          dispatch({ type: 'toggle' })
          const next = !showReasoning
          if (persistenceKey) persistVisibility(persistenceKey, next)
        }}
      />
    </div>
  )
}
