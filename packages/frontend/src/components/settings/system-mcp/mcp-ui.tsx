'use client'

import { cn } from '@/lib/utils'
import { Plus, AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * MCP 段的展示基元：列表头、空状态、表单面板、字段与提示条。
 * 导航（MCP_TABS / McpNavRail）与内容页头（McpContentHeader）已随 6 标签页壳删除，
 * 改由能力扩展页的段页头 + SegmentedTabs 承担。
 */

// ── Table list header (count + action button) ────────────

export function McpListHeader({
  count,
  actionLabel,
  onAction,
}: {
  count: number
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs text-muted-foreground">共 {count} 项</p>
      <Button size="sm" variant="outline" onClick={onAction}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {actionLabel}
      </Button>
    </div>
  )
}

// ── Rich empty state ─────────────────────────────────────

export function McpEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Icon className="h-9 w-9 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium text-foreground/60">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground/60 max-w-[260px]">{description}</p>
      {action && (
        <Button size="sm" variant="outline" className="mt-4" onClick={action.onClick}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {action.label}
        </Button>
      )}
    </div>
  )
}

// ── Form panel (replaces SectionCard for forms) ──────────

export function McpFormPanel({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="v2-panel-soft space-y-4 mb-4 p-4">
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      {children}
      <div className="flex gap-2 pt-1">{actions}</div>
    </div>
  )
}

// ── Field label wrapper ──────────────────────────────────

export function McpField({
  label,
  required,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Select with label ────────────────────────────────────

export function McpSelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: (string | { value: string; label: string })[]
  placeholder?: string
  required?: boolean
}) {
  return (
    <McpField label={label} required={required}>
      <select
        className="h-9 w-full rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const val = typeof o === 'string' ? o : o.value
          const lbl = typeof o === 'string' ? o : o.label
          return <option key={val} value={val}>{lbl}</option>
        })}
      </select>
    </McpField>
  )
}

// ── Inline warning banner ────────────────────────────────

export function McpInlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}
