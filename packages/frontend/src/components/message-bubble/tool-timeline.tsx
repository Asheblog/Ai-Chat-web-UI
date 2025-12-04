'use client'

import type { MessageMeta, ToolEvent } from '@/types'
import { ReasoningPanel } from '@/components/reasoning-panel'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'

interface ToolTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  reasoningHtml?: string
  summary: ToolTimelineSummary | null
  timeline: ToolEvent[]
  expanded: boolean
  onToggle: () => void
}

export function ToolTimeline({
  meta,
  reasoningRaw,
  reasoningHtml,
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
      isStreaming={meta.reasoningStatus === 'streaming'}
      toolSummary={summary}
      toolTimeline={timeline}
    />
  )
}
