'use client'

import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  describeObservationWindow,
  describeProcessCoverage,
  type NormalizedProcessCoverage,
} from '../model/process-model'
import { formatClockTime, type ProcessRunTerminalView } from '../model/scope'

/** 覆盖提示：覆盖缺口与执行结果分开说，unknown 不显示成 0 或"完整"。 */
export function ProcessCoverageNotices({ coverage }: { coverage: NormalizedProcessCoverage }) {
  const notes = describeProcessCoverage(coverage)
  if (notes.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-label="记录覆盖">
      {notes.map((note) => (
        <li
          key={note.layer}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-caption',
            note.tone === 'warning'
              ? 'border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-foreground'
              : 'border-border bg-surface-subtle text-muted-foreground',
          )}
        >
          {note.tone === 'warning' ? (
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
          ) : (
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 [overflow-wrap:anywhere]">{note.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** 观测窗口：只有真实时间戳才显示，缺失标未知而不是 00:00。 */
export function ProcessObservationWindow({ coverage }: { coverage: NormalizedProcessCoverage }) {
  const { start, end } = describeObservationWindow(coverage)
  const startText = formatClockTime(start)
  const endText = formatClockTime(end)
  return (
    <span className="text-micro text-muted-foreground num-tabular">
      观测窗口：{startText && endText ? `${startText}—${endText}` : startText ? `${startText} 起` : '未知'}
    </span>
  )
}

/** 整轮终态：未生成最终回答是硬事实，不沿用成功徽标。 */
export function ProcessRunTerminalNotice({ terminal }: { terminal: ProcessRunTerminalView }) {
  if (!terminal.note) return null
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-caption',
        terminal.tone === 'warning'
          ? 'border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] text-foreground'
          : 'border-border bg-surface-subtle text-muted-foreground',
      )}
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
      <span>{terminal.note}</span>
    </p>
  )
}

export function ProcessEmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-caption text-muted-foreground [overflow-wrap:anywhere]">{hint}</p>}
    </div>
  )
}
