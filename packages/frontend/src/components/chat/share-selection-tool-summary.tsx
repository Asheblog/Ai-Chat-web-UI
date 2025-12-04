'use client'

import type { ToolEvent } from '@/types'
import type { MessageId } from '@/features/chat/store/types'
import { useToolTimeline } from '@/features/chat/tool-events/useToolTimeline'

interface ShareSelectionToolSummaryProps {
  sessionId: number
  messageId: number | null
  bodyEvents?: ToolEvent[] | null
  title?: string
  className?: string
}

export function ShareSelectionToolSummary({
  sessionId,
  messageId,
  bodyEvents,
  title = '工具调用概览',
  className,
}: ShareSelectionToolSummaryProps) {
  const timelineResult = useToolTimeline({
    sessionId,
    messageId: (messageId ?? -1) as MessageId,
    bodyEvents,
  })
  if (messageId == null) return null
  const { summary } = timelineResult

  return (
    <div
      className={`rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary/80 ${className ?? ''}`}
    >
      <p className="font-semibold text-primary">{title}</p>
      {summary ? (
        <>
          <p className="mt-1 text-muted-foreground">{summary.label}</p>
          <p className="text-muted-foreground">{summary.summaryText}</p>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">此消息未包含工具调用。</p>
      )}
    </div>
  )
}
