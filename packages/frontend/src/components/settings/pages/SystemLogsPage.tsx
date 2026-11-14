"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, ChevronLeft, ChevronRight, ScrollText } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { Button } from "@/components/ui/button"
import { getSystemLogs, getSystemLogTags, type SystemLogEntry } from "@/features/system/api"
import { LogEntries } from "./system-logs/log-entries"
import { EMPTY_LOG_FILTERS, LogFilters, type LogFiltersValue } from "./system-logs/log-filters"

const PAGE_SIZE = 50

export function SystemLogsPage() {
  const { user, actorState } = useAuthStore(state => ({ user: state.user, actorState: state.actorState }))
  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
  const [query, setQuery] = useState({ filters: EMPTY_LOG_FILTERS, page: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ items: SystemLogEntry[]; total: number; hasMore: boolean; page: number } | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const requestId = useRef(0)

  const fetchLogs = useCallback(async () => {
    if (!isAdmin) return
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { filters, page } = query
      const response = await getSystemLogs({ page, pageSize: PAGE_SIZE, level: filters.level || undefined,
        tag: filters.tag || undefined, search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined })
      if (id !== requestId.current) return
      if (!response.data || response.success === false) throw new Error(response.error || "日志响应为空，请重试。")
      setResult({ items: response.data?.items ?? [], total: response.data?.total ?? 0, hasMore: response.data?.hasMore ?? false, page })
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : "日志服务暂不可用，请重试。")
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [isAdmin, query])

  const fetchTags = useCallback(async () => {
    if (!isAdmin) return
    try { const response = await getSystemLogTags(); setTags(response.data?.tags ?? []) } catch { /* 标签建议失败不影响日志与已有筛选。 */ }
  }, [isAdmin])

  useEffect(() => { void fetchLogs(); return () => { requestId.current += 1 } }, [fetchLogs])
  useEffect(() => { void fetchTags() }, [fetchTags])

  if (!isAdmin) return <div className="rounded-lg border border-border bg-surface-subtle p-6 text-center text-sm text-ink-secondary">只有管理员可以查看系统日志</div>

  const items = result?.items ?? []
  const page = result?.page ?? query.page
  const total = result?.total ?? 0
  const changeFilters = (filters: LogFiltersValue) => setQuery({ filters, page: 1 })
  const range = items.length ? " · 显示 " + ((page - 1) * PAGE_SIZE + 1) + "–" + ((page - 1) * PAGE_SIZE + items.length) : ""

  return (
    <div className="min-w-0 space-y-4">
      <LogFilters filters={query.filters} onChange={changeFilters} tags={tags} loading={loading} onRefresh={() => { void fetchLogs(); void fetchTags() }} />
      {error ? (
        <div role="alert" className="flex min-w-0 flex-wrap items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]"><p className="font-medium text-destructive">日志加载失败</p><p className="mt-1 text-ink-secondary">{error}</p>{result ? <p className="mt-1 text-xs text-ink-tertiary">保留上次成功加载的日志，当前筛选结果尚未更新。</p> : null}</div>
          <Button type="button" variant="outline" className="h-11 sm:h-10" aria-label="重试加载日志" onClick={() => void fetchLogs()}>重试</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-tertiary">
        <p role="status" aria-live="polite">{loading ? "正在加载日志…" : result ? "共 " + total + " 条日志" + range : "尚未加载日志"}</p>
        <nav aria-label="日志分页" className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setQuery(current => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <span className="tabular-nums">{page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" aria-label="下一页" disabled={!result?.hasMore || loading} onClick={() => setQuery(current => ({ ...current, page: page + 1 }))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </nav>
      </div>
      {items.length ? <LogEntries items={items} /> : !error ? (
        <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-subtle px-5 py-8 text-center">
          <ScrollText className="mb-1 h-6 w-6 text-ink-tertiary" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{loading ? "加载中…" : "暂无日志记录"}</p>
          {!loading ? <p className="text-xs text-ink-tertiary">试着调整关键词、日志级别或日期范围。</p> : null}
        </div>
      ) : null}
    </div>
  )
}
