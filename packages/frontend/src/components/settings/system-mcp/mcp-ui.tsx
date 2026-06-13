'use client'

import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Cable, KeyRound, Wrench, Link2,
  Plus, AlertTriangle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

// ── Tab metadata ──────────────────────────────────────────

export type McpSubTab = 'overview' | 'installations' | 'connections' | 'secrets' | 'tools' | 'bindings'

export interface McpTabMeta {
  key: McpSubTab
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export const MCP_TABS: McpTabMeta[] = [
  { key: 'overview', label: '总览', shortLabel: '总览', description: 'MCP 全局开关与配置流程总览', icon: LayoutDashboard },
  { key: 'installations', label: '安装模板', shortLabel: '安装', description: '管理 MCP 服务模板，定义远程或本地工具的连接方式', icon: Package },
  { key: 'connections', label: '连接', shortLabel: '连接', description: '基于模板创建连接实例，管理凭据与工具缓存', icon: Cable },
  { key: 'secrets', label: '凭据', shortLabel: '凭据', description: '管理 API 密钥与 MCP 凭据', icon: KeyRound },
  { key: 'tools', label: '工具', shortLabel: '工具', description: '搜索、查看 Schema 并固定常用工具', icon: Wrench },
  { key: 'bindings', label: '绑定', shortLabel: '绑定', description: '将连接绑定到 system / user / session 作用域', icon: Link2 },
]

// ── Desktop sidebar nav + Mobile horizontal scroll ────────

export function McpNavRail({
  active,
  onChange,
}: {
  active: McpSubTab
  onChange: (v: McpSubTab) => void
}) {
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-44 shrink-0 flex-col gap-0.5" aria-label="MCP 管理导航">
        {MCP_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              data-active={isActive || undefined}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
              {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          )
        })}
      </nav>

      {/* Mobile horizontal scroll */}
      <div
        className="flex md:hidden overflow-x-auto gap-1 pb-1 -mx-1 px-1"
        role="tablist"
        aria-label="MCP 管理导航"
      >
        {MCP_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary/70 bg-primary/10 text-primary'
                  : 'border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.shortLabel}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ── Content area header ──────────────────────────────────

export function McpContentHeader({ tab }: { tab: McpTabMeta }) {
  const Icon = tab.icon
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {tab.label}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{tab.description}</p>
    </div>
  )
}

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
