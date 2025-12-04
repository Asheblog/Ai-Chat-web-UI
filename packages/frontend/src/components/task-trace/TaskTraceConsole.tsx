"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth-store'
import {
  deleteAllTaskTraces as deleteAllTaskTracesApi,
  deleteLatexTrace as deleteLatexTraceApi,
  deleteTaskTrace as deleteTaskTraceApi,
  exportLatexTrace as exportLatexTraceApi,
  exportTaskTrace as exportTaskTraceApi,
  getLatexTraceEvents as getLatexTraceEventsApi,
  getTaskTrace as getTaskTraceApi,
  getTaskTraces as getTaskTracesApi,
} from '@/features/system/api'
import type { TaskTraceSummary, TaskTraceEventRecord, LatexTraceSummary, LatexTraceEventRecord } from '@/types'
import { Button } from '@/components/ui/button'
import { RefreshCcw, Trash2 } from 'lucide-react'
import { TaskTraceDetailDialog } from './TaskTraceDetailDialog'
import { TaskTraceFilters } from './TaskTraceFilters'
import { TaskTraceTable } from './TaskTraceTable'

export function TaskTraceConsole() {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({ actorState: state.actorState, user: state.user }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [status, setStatus] = useState<string>('')
  const [sessionFilter, setSessionFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<TaskTraceSummary[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<TaskTraceSummary | null>(null)
  const [detail, setDetail] = useState<{ trace: TaskTraceSummary; latexTrace: LatexTraceSummary | null; events: TaskTraceEventRecord[]; truncated: boolean } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<'trace' | 'latex'>('trace')
  const [latexEvents, setLatexEvents] = useState<LatexTraceEventRecord[]>([])
  const [latexTruncated, setLatexTruncated] = useState(false)
  const [latexLoading, setLatexLoading] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, pageSize }
      if (status) params.status = status
      if (keyword.trim()) params.keyword = keyword.trim()
      const sessionId = Number.parseInt(sessionFilter, 10)
      if (!Number.isNaN(sessionId) && sessionId > 0) {
        params.sessionId = sessionId
      }
      const res = await getTaskTracesApi(params)
      setItems(res.data?.items ?? [])
      setTotal(res.data?.total ?? 0)
    } catch (error: any) {
      toast({ title: '加载任务追踪失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [keyword, page, pageSize, sessionFilter, status, toast])

  useEffect(() => {
    if (isAdmin) {
      fetchList()
    }
  }, [fetchList, isAdmin])

  const handleOpenDetail = async (trace: TaskTraceSummary) => {
    setSelected(trace)
    setDetail(null)
    setDetailTab('trace')
    setLatexEvents([])
    setLatexTruncated(false)
    setDetailLoading(true)
    try {
      const res = await getTaskTraceApi(trace.id)
      setDetail(res.data ?? null)
    } catch (error: any) {
      toast({ title: '读取追踪详情失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setDetailLoading(false)
    }
  }

  const handleExport = async (traceId: number) => {
    try {
      const blob = await exportTaskTraceApi(traceId)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `task-trace-${traceId}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      toast({ title: '导出失败', description: error?.message || '无法导出日志', variant: 'destructive' })
    }
  }

  const handleExportLatex = async (traceId: number) => {
    try {
      const blob = await exportLatexTraceApi(traceId)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `latex-trace-${traceId}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      toast({ title: '导出 LaTeX 日志失败', description: error?.message || '无法导出 LaTeX 日志', variant: 'destructive' })
    }
  }

  const handleDeleteLatex = async (traceId: number) => {
    if (!window.confirm(`确定要删除 #${traceId} 的 LaTeX 日志吗？`)) {
      return
    }
    try {
      await deleteLatexTraceApi(traceId)
      toast({ title: '已删除 LaTeX 日志' })
      setLatexEvents([])
      setLatexTruncated(false)
      setDetail((prev) => (prev ? { ...prev, latexTrace: null } : prev))
      fetchList()
    } catch (error: any) {
      toast({ title: '删除失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    }
  }

  const ensureLatexEvents = useCallback(
    async (traceId: number) => {
      try {
        setLatexLoading(true)
        const res = await getLatexTraceEventsApi(traceId)
        setLatexEvents(res.data?.events ?? [])
        setLatexTruncated(Boolean(res.data?.truncated))
      } catch (error: any) {
        toast({ title: '读取 LaTeX 日志失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
      } finally {
        setLatexLoading(false)
      }
    },
    [toast],
  )

  const handleDelete = async (trace: TaskTraceSummary) => {
    if (!window.confirm(`确定要删除追踪 #${trace.id} 吗？该操作无法恢复。`)) {
      return
    }
    setDeletingId(trace.id)
    try {
      await deleteTaskTraceApi(trace.id)
      toast({ title: '已删除任务追踪' })
      fetchList()
    } catch (error: any) {
      toast({ title: '删除失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteAll = async () => {
    if (!window.confirm('确定要清空所有任务追踪日志吗？该操作会删除全部记录且无法恢复。')) {
      return
    }
    setClearingAll(true)
    try {
      const res = await deleteAllTaskTracesApi()
      const deleted = res.data?.deleted ?? 0
      toast({ title: '已清空任务追踪日志', description: `共删除 ${deleted} 条记录` })
      setPage(1)
      fetchList()
    } catch (error: any) {
      toast({ title: '清空失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setClearingAll(false)
    }
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])
  const handleDetailClose = () => {
    setSelected(null)
    setDetail(null)
  }

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        仅管理员可以查看任务追踪日志
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <TaskTraceFilters
        sessionFilter={sessionFilter}
        keyword={keyword}
        status={status}
        onSessionFilterChange={setSessionFilter}
        onKeywordChange={setKeyword}
        onStatusChange={setStatus}
        onSearch={() => {
          setPage(1)
          fetchList()
        }}
        onReset={() => {
          setKeyword('')
          setSessionFilter('')
          setStatus('')
          setPage(1)
        }}
      />

      <div className="rounded-2xl border bg-card transition-all hover:shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="text-sm font-semibold">追踪记录</div>
            <div className="text-xs text-muted-foreground">共 {total} 条</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={fetchList} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="destructive" size="sm" disabled={loading || clearingAll} onClick={handleDeleteAll}>
              <Trash2 className="mr-1 h-4 w-4" />
              {clearingAll ? '清空中' : '清空全部'}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <TaskTraceTable
            items={items}
            loading={loading}
            deletingId={deletingId}
            onOpenDetail={handleOpenDetail}
            onExport={handleExport}
            onDelete={handleDelete}
          />
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-4 text-sm text-muted-foreground">
            <div>第 {page} / {totalPages} 页</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>下一页</Button>
            </div>
          </div>
        )}
      </div>

      <TaskTraceDetailDialog
        open={!!selected}
        selected={selected}
        detail={detail}
        detailLoading={detailLoading}
        detailTab={detailTab}
        onTabChange={setDetailTab}
        onClose={handleDetailClose}
        onExportTrace={handleExport}
        onExportLatex={handleExportLatex}
        onDeleteLatex={handleDeleteLatex}
        onEnsureLatexEvents={ensureLatexEvents}
        latexEvents={latexEvents}
        latexTruncated={latexTruncated}
        latexLoading={latexLoading}
      />
    </div>
  )
}
