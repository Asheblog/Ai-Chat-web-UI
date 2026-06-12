'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type McpSubTab = 'overview' | 'installations' | 'connections' | 'secrets' | 'tools' | 'bindings'

export function SubTabBar({ active, onChange }: { active: McpSubTab; onChange: (v: McpSubTab) => void }) {
  const tabs: { key: McpSubTab; label: string }[] = [
    { key: 'overview', label: '总览' },
    { key: 'installations', label: '安装模板' },
    { key: 'connections', label: '连接' },
    { key: 'secrets', label: '凭据' },
    { key: 'tools', label: '工具' },
    { key: 'bindings', label: '绑定' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors',
            active === t.key
              ? 'border-primary/70 bg-primary/10 text-primary'
              : 'border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function SectionCard({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('v2-panel-soft space-y-3', className)}>
      {title && <p className="text-sm font-semibold text-foreground/80">{title}</p>}
      {children}
    </div>
  )
}
