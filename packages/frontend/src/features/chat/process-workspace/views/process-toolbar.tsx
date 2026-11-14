'use client'

import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessFilter, ProcessStatusFilter } from '../model/derived-views'
import { PROCESS_STATUS_OPTIONS } from '../model/status-options'

const controlClass =
  'min-h-11 rounded-lg border border-border bg-surface px-2 text-caption text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** 检索与筛选：查询词匹配工具名/查询词/callId，异常与分组各自独立开关。 */
export function ProcessToolbar({
  filter,
  onChange,
  anomalyCount,
}: {
  filter: ProcessFilter
  onChange: (next: ProcessFilter) => void
  anomalyCount: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder="搜索调用名称、查询词、域名或 callId"
          aria-label="搜索调用"
          className="min-h-11 w-full rounded-lg border border-border bg-surface pl-8 pr-2.5 text-caption text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={filter.status}
          onChange={(event) => onChange({ ...filter, status: event.target.value as ProcessStatusFilter })}
          aria-label="按状态筛选"
          className={controlClass}
        >
          {PROCESS_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{'状态：' + option.label}</option>
          ))}
        </select>
        <select
          value={filter.grouping}
          onChange={(event) => onChange({ ...filter, grouping: event.target.value as ProcessFilter['grouping'] })}
          aria-label="分组方式"
          className={controlClass}
        >
          <option value="by-parent">按父任务分组</option>
          <option value="timeline">按时间线</option>
        </select>
        <button
          type="button"
          aria-pressed={filter.onlyAnomalies}
          onClick={() => onChange({ ...filter, onlyAnomalies: !filter.onlyAnomalies })}
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-2 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filter.onlyAnomalies
              ? 'border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.1)] text-foreground'
              : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
          )}
        >
          只看异常{anomalyCount > 0 ? ` · ${anomalyCount}` : ''}
        </button>
      </div>
    </div>
  )
}