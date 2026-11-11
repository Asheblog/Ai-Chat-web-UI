'use client'

import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2 } from 'lucide-react'
import type { CotTimelineSummary } from '@aichat/shared/cot-timeline-view'
import { cn } from '@/lib/utils'

const MASTER_BUTTON_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

const ICON_BUTTON_CLASS =
  'inline-flex h-[1.625rem] w-[1.625rem] cursor-pointer items-center justify-center rounded-md border border-border/70 bg-background/60 text-muted-foreground transition-colors duration-200 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

const resolveDotClass = (summary: CotTimelineSummary) => {
  if (summary.activeCount > 0) return 'bg-blue-400 animate-pulse'
  if (summary.failedCount > 0) return 'bg-amber-500'
  return 'bg-emerald-400'
}

interface CotTimelineSummaryBarProps {
  summary: CotTimelineSummary
  durationText: string | null
  isStreaming: boolean
  bodyId: string
  onExpand: () => void
}

/**
 * L0：整条时间轴压成一行。
 * 完成后默认就是这一行，正文可以立刻进入视线；点击进入提纲层。
 */
export function CotTimelineSummaryBar({
  summary,
  durationText,
  isStreaming,
  bodyId,
  onExpand,
}: CotTimelineSummaryBarProps) {
  const ariaLabel = `${summary.ariaLabel}${durationText ? `，耗时 ${durationText}` : ''}，展开查看每一步`

  return (
    <button
      type="button"
      className="group flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-left transition-colors duration-200 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      onClick={onExpand}
      aria-expanded={false}
      aria-controls={bodyId}
      aria-label={ariaLabel}
      title="展开过程时间轴"
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', resolveDotClass(summary))}
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        过程时间轴 · {summary.stepCount} 步
      </span>
      {summary.detailChips.length > 0 && (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
          {summary.detailChips.join(' · ')}
        </span>
      )}
      {summary.detailChips.length === 0 && <span className="min-w-0 flex-1" />}
      {isStreaming && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      )}
      {durationText && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{durationText}</span>
      )}
      <ChevronDown
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors duration-200 group-hover:text-foreground"
      />
    </button>
  )
}

interface CotTimelineHeaderProps {
  level: 'outline' | 'expanded'
  stepCount: number
  bodyId: string
  onExpandAll: () => void
  onCollapseAll: () => void
  onCollapse: () => void
}

/** L1 / L2 的标题行：左侧步骤总数，右侧「全部展开 / 全部折叠」与「收起」 */
export function CotTimelineHeader({
  level,
  stepCount,
  bodyId,
  onExpandAll,
  onCollapseAll,
  onCollapse,
}: CotTimelineHeaderProps) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        过程时间轴 · {stepCount} 步
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {level === 'outline' ? (
          <button
            type="button"
            className={MASTER_BUTTON_CLASS}
            onClick={onExpandAll}
            aria-controls={bodyId}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
            全部展开
          </button>
        ) : (
          <button
            type="button"
            className={MASTER_BUTTON_CLASS}
            onClick={onCollapseAll}
            aria-controls={bodyId}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
            全部折叠
          </button>
        )}
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          onClick={onCollapse}
          aria-label="收起过程时间轴"
          title="收起"
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
