'use client'

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  HelpCircle,
  Loader2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessOutcome, ProcessRecord } from '../model/process-model'

export type ProcessTone = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export interface ProcessStatusView {
  label: string
  tone: ProcessTone
  icon: typeof CheckCircle2
  /** 图标是纯装饰时隐藏，避免屏幕阅读器重复朗读状态 */
  iconSpinning: boolean
}

const OUTCOME_VIEWS: Record<ProcessOutcome, ProcessStatusView> = {
  succeeded: { label: '已完成', tone: 'success', icon: CheckCircle2, iconSpinning: false },
  failed: { label: '失败', tone: 'danger', icon: XCircle, iconSpinning: false },
  rejected: { label: '未获许可', tone: 'warning', icon: Ban, iconSpinning: false },
  aborted: { label: '中止', tone: 'warning', icon: CircleSlash, iconSpinning: false },
  in_flight: { label: '执行中', tone: 'active', icon: Loader2, iconSpinning: true },
  unknown: { label: '结果未知', tone: 'neutral', icon: HelpCircle, iconSpinning: false },
}

export const describeProcessStatus = (record: ProcessRecord): ProcessStatusView => {
  if (record.outcome === 'in_flight' && record.status === 'pending') {
    return { label: '等待确认', tone: 'neutral', icon: CircleDashed, iconSpinning: false }
  }
  return OUTCOME_VIEWS[record.outcome]
}

const TONE_CLASSES: Record<ProcessTone, string> = {
  success: 'v2-status v2-status-success',
  warning: 'v2-status v2-status-warning',
  danger: 'v2-status v2-status-danger',
  neutral: 'v2-status',
  active: 'v2-status',
}

export function ProcessStatusChip({
  record,
  className,
}: {
  record: ProcessRecord
  className?: string
}) {
  const view = describeProcessStatus(record)
  const Icon = view.icon
  return (
    <span className={cn(TONE_CLASSES[view.tone], className)}>
      <Icon
        aria-hidden
        className={cn('h-3 w-3 shrink-0', view.iconSpinning && 'animate-spin motion-reduce:animate-none')}
      />
      {view.label}
    </span>
  )
}

export function ProcessChip({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-[1.375rem] items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium',
        tone === 'warning' && 'border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]',
        tone === 'danger' && 'border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.1)] text-destructive',
        tone === 'neutral' && 'border-border bg-surface-subtle text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 关系类标记：孤儿与歧义必须显式说明，不能看起来像正常子任务。 */
export function ProcessRelationChip({ record }: { record: ProcessRecord }) {
  if (record.relation === 'orphan') {
    return (
      <ProcessChip tone="warning">
        <AlertTriangle aria-hidden className="h-3 w-3" />
        归属未知
      </ProcessChip>
    )
  }
  if (record.relation === 'ambiguous') {
    return (
      <ProcessChip tone="warning">
        <AlertTriangle aria-hidden className="h-3 w-3" />
        父调用歧义
      </ProcessChip>
    )
  }
  return null
}
