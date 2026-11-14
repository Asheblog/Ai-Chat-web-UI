"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SystemLogEntry } from "@/features/system/api"

const levelColors: Record<string, string> = {
  debug: "border-border bg-surface-subtle text-ink-secondary",
  info: "border-signal/30 bg-signal-soft text-signal-text",
  warn: "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

function LogEntry({ item }: { item: SystemLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const contextId = useId()
  const date = new Date(item.ts)
  const time = Number.isNaN(date.getTime()) ? item.ts : date.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  return (
    <li className="min-w-0 px-4 py-3">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 lg:grid-cols-[8.5rem_4.5rem_8rem_minmax(0,1fr)_2.5rem]">
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 lg:contents">
          <time dateTime={item.ts} className="font-mono text-[11px] tabular-nums text-ink-tertiary lg:pt-1">{time}</time>
          <span><Badge variant="outline" className={cn("font-mono text-[10px] leading-4", levelColors[item.level])}>{item.level.toUpperCase()}</Badge></span>
          <span className="min-w-0 max-w-full whitespace-pre-wrap font-mono text-[11px] leading-5 text-ink-secondary [overflow-wrap:anywhere]">{item.tag}</span>
        </div>
        <p className={cn("min-w-0 whitespace-pre-wrap text-[13px] leading-6 [overflow-wrap:anywhere]", item.level === "error" ? "text-destructive" : "text-foreground")}>{item.msg}</p>
        {item.ctx != null ? (
          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 lg:-mt-1" aria-label={expanded ? "收起日志上下文" : "展开日志上下文"} aria-expanded={expanded} aria-controls={contextId} onClick={() => setExpanded(value => !value)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          </Button>
        ) : <span aria-hidden="true" />}
      </div>
      {expanded && item.ctx != null ? (
        <div id={contextId} className="mt-3 min-w-0 rounded-lg border border-border bg-surface-subtle p-3">
          <p className="mb-2 text-xs font-medium text-ink-secondary">日志上下文</p>
          <pre className="min-w-0 whitespace-pre-wrap font-mono text-[11px] leading-5 text-ink-secondary [overflow-wrap:anywhere]">{JSON.stringify(item.ctx, null, 2)}</pre>
        </div>
      ) : null}
    </li>
  )
}

export function LogEntries({ items }: { items: SystemLogEntry[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <div aria-hidden="true" className="hidden grid-cols-[8.5rem_4.5rem_8rem_minmax(0,1fr)_2.5rem] gap-x-3 border-b border-border bg-surface-subtle px-4 py-2.5 text-[11px] font-medium text-ink-tertiary lg:grid">
        <span>时间</span><span>级别</span><span>模块</span><span>消息</span><span />
      </div>
      <ul aria-label="系统日志记录" className="divide-y divide-border">{items.map(item => <LogEntry key={item.id} item={item} />)}</ul>
    </div>
  )
}
