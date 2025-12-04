'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MessageMeta, ToolEvent } from '@/types'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'
import { ToolTimeline } from './tool-timeline'

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
  const [showReasoning, setShowReasoning] = useState(defaultExpanded)
  const [reasoningManuallyToggled, setReasoningManuallyToggled] = useState(false)
  const reasoningTextLength = useMemo(() => reasoningRaw.trim().length, [reasoningRaw])
  const hasReasoningState = typeof meta.reasoningStatus === 'string'

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
          setShowReasoning((v) => !v)
        }}
      />
    </div>
  )
}
