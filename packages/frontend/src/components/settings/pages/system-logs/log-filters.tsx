"use client"

import { useId, useState } from "react"
import { RefreshCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type LogFiltersValue = { level: "" | "debug" | "info" | "warn" | "error"; tag: string; search: string; dateFrom: string; dateTo: string }
export const EMPTY_LOG_FILTERS: LogFiltersValue = { level: "", tag: "", search: "", dateFrom: "", dateTo: "" }
const labelClass = "mb-1.5 block text-xs font-medium text-ink-secondary"

export function LogFilters({ filters, onChange, tags, loading, onRefresh }: {
  filters: LogFiltersValue
  onChange: (filters: LogFiltersValue) => void
  tags: string[]
  loading: boolean
  onRefresh: () => void
}) {
  const id = useId()
  const [search, setSearch] = useState(filters.search)
  return (
    <form onSubmit={event => { event.preventDefault(); onChange({ ...filters, search: search.trim() }) }} className="grid min-w-0 grid-cols-2 items-end gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-4">
      <div className="col-span-2 min-w-0">
        <label htmlFor={id + "-search"} className={labelClass}>搜索关键词</label>
        <div className="flex min-w-0 gap-2">
          <Input id={id + "-search"} placeholder="搜索消息内容…" value={search} onChange={event => setSearch(event.target.value)} className="h-11 sm:h-10 min-w-0 flex-1 text-base sm:text-sm" />
          <Button type="submit" variant="outline" size="icon" className="h-11 sm:h-10 w-11 sm:w-10 shrink-0" aria-label="搜索日志" disabled={loading}><Search className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={id + "-level"} className={labelClass}>日志级别</label>
        <Select value={filters.level || "all"} onValueChange={value => onChange({ ...filters, level: value === "debug" || value === "info" || value === "warn" || value === "error" ? value : "" })}>
          <SelectTrigger id={id + "-level"} className="h-11 sm:h-10"><SelectValue placeholder="全部级别" /></SelectTrigger>
          <SelectContent>{["all", "debug", "info", "warn", "error"].map(value => <SelectItem key={value} value={value}>{value === "all" ? "全部级别" : value.toUpperCase()}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <label htmlFor={id + "-tag"} className={labelClass}>模块标签</label>
        <Select value={filters.tag || "all"} onValueChange={value => onChange({ ...filters, tag: value === "all" ? "" : value })}>
          <SelectTrigger id={id + "-tag"} className="h-11 sm:h-10 min-w-0"><SelectValue placeholder="全部模块" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部模块</SelectItem>{tags.map(tag => <SelectItem key={tag} value={tag} className="[overflow-wrap:anywhere]">{tag}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-0"><label htmlFor={id + "-from"} className={labelClass}>开始日期</label><Input id={id + "-from"} type="date" className="h-11 sm:h-10 min-w-0 text-base sm:text-sm" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={event => onChange({ ...filters, dateFrom: event.target.value })} /></div>
      <div className="min-w-0"><label htmlFor={id + "-to"} className={labelClass}>结束日期</label><Input id={id + "-to"} type="date" className="h-11 sm:h-10 min-w-0 text-base sm:text-sm" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={event => onChange({ ...filters, dateTo: event.target.value })} /></div>
      <Button type="button" variant="outline" onClick={onRefresh} disabled={loading} className="col-span-2 h-11 sm:h-10 sm:col-span-1 sm:col-start-4"><RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />刷新</Button>
    </form>
  )
}
