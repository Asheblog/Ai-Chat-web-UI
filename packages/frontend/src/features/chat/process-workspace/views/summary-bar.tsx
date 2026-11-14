'use client'

import type { Ref } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessRunTerminalView } from '../model/scope'

interface ProcessSummaryBarProps {
  statusText: string
  durationText: string | null
  terminal: ProcessRunTerminalView
  anomalyCount: number
  activity: string | null
  isStreaming: boolean
  expanded: boolean
  bodyId: string
  /** 就地展开时 aria-controls 指向面板；抽屉用 aria-haspopup，不指向不存在的元素 */
  presentation?: 'drawer' | 'inline'
  onOpen: () => void
  /** 关闭工作区后焦点回到这个按钮 */
  triggerRef?: Ref<HTMLButtonElement>
}

/**
 * 一行摘要：完成状态 + 真实耗时 + 打开入口。答案区不被压缩，
 * 流式时把当前活动放在同一行的 status 区，不制造进度百分比。
 */
export function ProcessSummaryBar({
  statusText,
  durationText,
  terminal,
  anomalyCount,
  activity,
  isStreaming,
  expanded,
  bodyId,
  presentation = 'drawer',
  onOpen,
  triggerRef,
}: ProcessSummaryBarProps) {
  const accessibleName = [`查看过程：${statusText}`, durationText, terminal.note, anomalyCount > 0 ? `${anomalyCount} 处异常` : null]
    .filter(Boolean)
    .join('，')

  return (
    <div className="mb-3 min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={onOpen}
        aria-expanded={expanded}
        aria-haspopup={presentation === 'drawer' ? 'dialog' : undefined}
        aria-controls={presentation === 'inline' && expanded ? bodyId : undefined}
        aria-label={accessibleName}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {terminal.finalAnswerMissing ? (
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" />
        ) : isStreaming ? (
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        ) : (
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-foreground">
            <span>{statusText}</span>
            {durationText && <span className="num-tabular text-caption text-muted-foreground">{durationText}</span>}
            {anomalyCount > 0 && (
              <span className="text-caption text-[hsl(var(--warning))]">{anomalyCount} 处异常</span>
            )}
          </span>
          {activity ? (
            <span role="status" className="mt-0.5 block truncate text-micro text-muted-foreground">
              {activity}
            </span>
          ) : terminal.note && !terminal.finalAnswerMissing ? (
            <span className="mt-0.5 block text-micro text-muted-foreground">{terminal.note}</span>
          ) : null}
        </span>
        <span className={cn('flex shrink-0 items-center gap-0.5 text-caption font-medium text-muted-foreground')}>
          过程
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  )
}
