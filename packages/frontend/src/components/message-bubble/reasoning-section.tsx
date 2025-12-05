'use client'

import { useEffect, useMemo, useState } from 'react'
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
  const [showReasoning, setShowReasoning] = useState(defaultExpanded)
  const [reasoningManuallyToggled, setReasoningManuallyToggled] = useState(false)
  const reasoningTextLength = useMemo(() => reasoningRaw.trim().length, [reasoningRaw])
  const hasReasoningState = typeof meta.reasoningStatus === 'string'

  useEffect(() => {
    if (!persistenceKey) return
    const persisted = loadPersistedVisibility(persistenceKey)
    if (persisted == null) return
    setShowReasoning(persisted)
    setReasoningManuallyToggled(true)
  }, [persistenceKey])

  useEffect(() => {
    if (reasoningManuallyToggled) return
    setShowReasoning(defaultExpanded)
  }, [defaultExpanded, reasoningManuallyToggled])

  useEffect(() => {
    if (reasoningManuallyToggled) return
    if (!hasReasoningState && reasoningTextLength === 0 && timeline.length === 0) {
      setShowReasoning(false)
      setReasoningManuallyToggled(false)
    }
  }, [hasReasoningState, reasoningManuallyToggled, reasoningTextLength, timeline.length])

  useEffect(() => {
    if (meta.role === 'assistant' && (meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming') && !showReasoning && !reasoningManuallyToggled) {
      setShowReasoning(true)
    }
  }, [meta.reasoningStatus, meta.role, reasoningManuallyToggled, showReasoning])

  useEffect(() => {
    if (meta.role !== 'assistant') return
    if (reasoningManuallyToggled) return
    if (timeline.length === 0 || showReasoning) return
    setShowReasoning(true)
    setReasoningManuallyToggled(true)
  }, [meta.role, reasoningManuallyToggled, showReasoning, timeline.length])

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
          setReasoningManuallyToggled(true)
          setShowReasoning((v) => {
            const next = !v
            if (persistenceKey) persistVisibility(persistenceKey, next)
            return next
          })
        }}
      />
    </div>
  )
}
