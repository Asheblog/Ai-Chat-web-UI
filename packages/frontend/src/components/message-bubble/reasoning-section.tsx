'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { AlertTriangle, Brain, ChevronDown, Loader2 } from 'lucide-react'
import type { MessageMeta } from '@/types'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'

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

const statusTextMap: Record<'idle' | 'streaming' | 'done', string> = {
  idle: '正在思考',
  streaming: '正在思考',
  done: '思考完成',
}

interface ReasoningSectionProps {
  meta: MessageMeta
  reasoningRaw: string
  reasoningHtml?: string
  reasoningPlayedLength?: number
  defaultExpanded: boolean
}

export function ReasoningSection({
  meta,
  reasoningRaw,
  reasoningHtml,
  reasoningPlayedLength,
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
  const hasUnavailableReason =
    Boolean(meta.reasoningUnavailableCode) ||
    Boolean(meta.reasoningUnavailableReason) ||
    Boolean(meta.reasoningUnavailableSuggestion)
  const [{ expanded }, dispatch] = useReducer(
    expandReducer,
    { expanded: defaultExpanded, source: 'default' },
    () => expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )

  const hasAnyContent = hasReasoningState || reasoningTextLength > 0 || hasUnavailableReason
  const isAssistant = meta.role === 'assistant'
  const isActiveReasoning =
    isAssistant && (meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming')
  const statusText = meta.reasoningStatus ? statusTextMap[meta.reasoningStatus] : '思考轨迹'
  const showStreamingIndicator = meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming'
  const durationText =
    typeof meta.reasoningDurationSeconds === 'number' && Number.isFinite(meta.reasoningDurationSeconds)
      ? `${meta.reasoningDurationSeconds.toFixed(1)}s`
      : null

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

  if (!hasAnyContent) {
    return null
  }

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
            <Brain className="h-4 w-4" />
            <span>{statusText}</span>
            {showStreamingIndicator && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {durationText && <span className="text-xs text-muted-foreground">· {durationText}</span>}
          </div>
          {meta.reasoningUnavailableReason && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.reasoningUnavailableReason}</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          {hasUnavailableReason && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{meta.reasoningUnavailableCode || '推理不可用'}</span>
              </div>
              {meta.reasoningUnavailableReason && <p className="mt-1">{meta.reasoningUnavailableReason}</p>}
              {meta.reasoningUnavailableSuggestion && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">{meta.reasoningUnavailableSuggestion}</p>
              )}
            </div>
          )}
          {reasoningTextLength > 0 ? (
            !showStreamingIndicator && reasoningHtml ? (
              <div
                className="markdown-body markdown-body--reasoning text-sm"
                dangerouslySetInnerHTML={{ __html: reasoningHtml }}
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                <TypewriterReasoning
                  text={reasoningRaw}
                  isStreaming={showStreamingIndicator}
                  initialPlayedLength={reasoningPlayedLength}
                  speed={20}
                />
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">暂无可展示的思考内容。</p>
          )}
        </div>
      )}
    </div>
  )
}
