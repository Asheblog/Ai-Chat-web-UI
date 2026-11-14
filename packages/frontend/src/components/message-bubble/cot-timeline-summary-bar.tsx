'use client'

import { Check, ChevronDown, ChevronUp, Clock3, AlertTriangle } from 'lucide-react'
import type { CotTimelineSummary } from '@aichat/shared/cot-timeline-view'
import { cn } from '@/lib/utils'

interface CotTimelineSummaryBarProps {
  summary: CotTimelineSummary
  durationText: string | null
  isStreaming: boolean
  activityText?: string | null
  bodyId: string
  onExpand: () => void
}

export function CotTimelineSummaryBar({
  summary, durationText, isStreaming, activityText, bodyId, onExpand,
}: CotTimelineSummaryBarProps) {
  const hasFailures = summary.failedCount > 0
  const label = isStreaming ? activityText || '正在整理回答' : hasFailures ? summary.failedCount + ' 个步骤失败' : '已完成'
  const action = hasFailures && !isStreaming ? '查看失败步骤' : '查看过程'
  const Icon = isStreaming ? Clock3 : hasFailures ? AlertTriangle : Check

  return (
    <button
      type="button"
      className="group flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg bg-surface px-3 py-2 text-left transition-colors duration-200 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onExpand}
      aria-expanded={false}
      aria-controls={bodyId}
      aria-label={label + (durationText ? '，耗时 ' + durationText : '') + '，' + action}
    >
      <Icon aria-hidden className={cn('h-4 w-4 shrink-0', hasFailures ? 'text-destructive' : 'text-primary')} />
      <span className={cn('min-w-0 flex-1 truncate text-sm font-medium sm:flex-none', hasFailures ? 'text-destructive' : 'text-primary')} title={label}>{label}</span>
      {durationText && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{durationText}</span>}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{action}</span>
      <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

interface CotTimelineHeaderProps {
  stepCount: number
  durationText: string | null
  activityText: string | null
  isStreaming: boolean
  failedCount: number
  bodyId: string
  onCollapse: () => void
}

export function CotTimelineHeader({
  stepCount, durationText, activityText, isStreaming, failedCount, bodyId, onCollapse,
}: CotTimelineHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-border px-4 py-2', isStreaming && 'bg-primary/5')}>
      <div className="min-w-0 py-1">
        <div role={isStreaming ? 'status' : undefined} className={cn('flex items-center gap-2 text-sm font-medium', isStreaming && 'text-primary')}>
          {isStreaming && <Clock3 aria-hidden className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 truncate" title={activityText || undefined}>{isStreaming ? activityText || '正在整理回答' : '过程记录'}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {stepCount} 步{durationText ? ' · ' + durationText : ''}
          {failedCount > 0 && <span className="ml-2 text-destructive">{failedCount} 个步骤失败</span>}
        </p>
      </div>
      <button type="button" className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded aria-controls={bodyId} onClick={onCollapse}>
        收起<ChevronUp aria-hidden className="h-4 w-4" />
      </button>
    </div>
  )
}
