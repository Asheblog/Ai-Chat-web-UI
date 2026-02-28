'use client'

import type { MessageMeta, ToolEvent } from '@/types'
import { ReasoningPanel } from '@/components/reasoning-panel'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'

interface ToolTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  reasoningHtml?: string
  reasoningPlayedLength?: number
  summary: ToolTimelineSummary | null
  timeline: ToolEvent[]
  expanded: boolean
  onToggle: () => void
}

export function ToolTimeline({
  meta,
  reasoningRaw,
  reasoningHtml,
  reasoningPlayedLength,
  summary,
  timeline,
  expanded,
  onToggle,
}: ToolTimelineProps) {
  return (
    <ReasoningPanel
      status={meta.reasoningStatus}
      durationSeconds={meta.reasoningDurationSeconds}
      idleMs={meta.reasoningIdleMs}
      expanded={expanded}
      onToggle={onToggle}
      reasoningRaw={reasoningRaw}
      reasoningHtml={reasoningHtml}
      reasoningPlayedLength={reasoningPlayedLength}
      isStreaming={meta.reasoningStatus === 'streaming'}
      reasoningUnavailableCode={meta.reasoningUnavailableCode}
      reasoningUnavailableReason={meta.reasoningUnavailableReason}
      reasoningUnavailableSuggestion={meta.reasoningUnavailableSuggestion}
      toolSummary={summary}
      toolTimeline={timeline}
    />
  )
}
