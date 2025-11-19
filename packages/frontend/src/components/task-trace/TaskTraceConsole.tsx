"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { useAuthStore } from "@/store/auth-store"
import { apiClient } from "@/lib/api"
import type { TaskTraceSummary, TaskTraceEventRecord, LatexTraceSummary, LatexTraceEventRecord } from "@/types"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, RefreshCcw, Search, Trash2 } from "lucide-react"

const statusLabels: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  error: '失败',
  cancelled: '已取消',
}

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

const formatDuration = (ms?: number | null) => {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m${remain}s`
}

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
      const res = await apiClient.getTaskTraces(params)
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
      const res = await apiClient.getTaskTrace(trace.id)
      setDetail(res.data ?? null)
    } catch (error: any) {
      toast({ title: '读取追踪详情失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setDetailLoading(false)
    }
  }

  const handleExport = async (traceId: number) => {
    try {
      const blob = await apiClient.exportTaskTrace(traceId)
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
      const blob = await apiClient.exportLatexTrace(traceId)
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
      await apiClient.deleteLatexTrace(traceId)
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
        const res = await apiClient.getLatexTraceEvents(traceId)
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
      await apiClient.deleteTaskTrace(trace.id)
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
      const res = await apiClient.deleteAllTaskTraces()
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

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        仅管理员可以查看任务追踪日志
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-sm text-muted-foreground" htmlFor="sessionFilter">会话 ID</label>
            <Input id="sessionFilter" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} placeholder="输入数字 ID" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-sm text-muted-foreground" htmlFor="keyword">关键字</label>
            <Input id="keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="支持 Actor / Client ID" />
          </div>
          <div className="w-full space-y-1 md:w-48">
            <label className="text-sm text-muted-foreground">状态</label>
            <Select value={status || undefined} onValueChange={(value) => setStatus(value === '__all' ? '' : value)}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">全部</SelectItem>
                <SelectItem value="running">进行中</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="error">失败</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button className="flex items-center gap-2" onClick={() => { setPage(1); fetchList() }}>
              <Search className="h-4 w-4" />
              搜索
            </Button>
            <Button variant="outline" onClick={() => { setKeyword(''); setSessionFilter(''); setStatus(''); setPage(1) }}>
              重置
            </Button>
          </div>
        </div>
      </Card>

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

        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '400px' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>会话</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>事件数</TableHead>
                <TableHead>LaTeX</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                    暂无记录
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer hover:bg-muted/40" onClick={() => handleOpenDetail(item)}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.sessionId ?? '-'}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-muted-foreground">{item.actor}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'completed' ? 'default' : item.status === 'error' ? 'destructive' : 'secondary'}>
                      {statusLabels[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(item.startedAt)}</TableCell>
                  <TableCell>{formatDuration(item.durationMs)}</TableCell>
                  <TableCell>{item.eventCount}</TableCell>
                  <TableCell>
                    {item.latexTrace ? (
                      <div className="text-xs text-muted-foreground">
                        <div>匹配 {item.latexTrace.matchedBlocks}</div>
                        <div>遗漏 {item.latexTrace.unmatchedBlocks}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="text-primary" onClick={(e) => { e.stopPropagation(); handleExport(item.id) }}>
                        <Download className="mr-1 h-4 w-4" />导出
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={deletingId === item.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(item)
                        }}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        {deletingId === item.id ? '删除中' : '删除'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setDetail(null) } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>追踪详情 #{selected?.id}</DialogTitle>
          </DialogHeader>
          {detailLoading && <Skeleton className="h-24 w-full" />}
          {!detailLoading && detail && (
            <div className="space-y-4 overflow-y-auto">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className="truncate">
                  <span className="text-muted-foreground">会话：</span>
                  <span>{detail.trace.sessionId ?? '-'}</span>
                </div>
                <div className="truncate">
                  <span className="text-muted-foreground">Actor：</span>
                  <span className="text-xs">{detail.trace.actor}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <Badge variant={detail.trace.status === 'completed' ? 'default' : detail.trace.status === 'error' ? 'destructive' : 'secondary'} className="ml-2">
                    {statusLabels[detail.trace.status] ?? detail.trace.status}
                  </Badge>
                </div>
                <div className="truncate">
                  <span className="text-muted-foreground">开始：</span>
                  <span className="text-xs">{formatDateTime(detail.trace.startedAt)}</span>
                </div>
                <div className="truncate">
                  <span className="text-muted-foreground">结束：</span>
                  <span className="text-xs">{formatDateTime(detail.trace.endedAt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">耗时：</span>
                  <span>{formatDuration(detail.trace.durationMs)}</span>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                LaTeX 日志：{detail.latexTrace ? `${detail.latexTrace.matchedBlocks} / ${detail.latexTrace.unmatchedBlocks}` : '未记录'}
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-2">
                    <Button size="sm" variant={detailTab === 'trace' ? 'default' : 'outline'} onClick={() => setDetailTab('trace')}>
                      主日志
                    </Button>
                    <Button
                      size="sm"
                      variant={detailTab === 'latex' ? 'default' : 'outline'}
                      disabled={!detail.latexTrace}
                      onClick={() => {
                        setDetailTab('latex')
                        if (detail.latexTrace && latexEvents.length === 0 && !latexLoading) {
                          ensureLatexEvents(detail.trace.id)
                        }
                      }}
                    >
                      LaTeX 日志
                    </Button>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleExport(detail.trace.id)}>
                      导出主日志
                    </Button>
                    {detail.latexTrace && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleExportLatex(detail.trace.id)}>
                          导出 LaTeX
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteLatex(detail.trace.id)}>
                          删除 LaTeX
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {detailTab === 'trace' && (
                  <ScrollArea className="h-[50vh] rounded-xl border bg-muted/30 p-4">
                    <div className="space-y-3">
                      {detail.events.map((evt) => (
                        <div key={evt.id} className="rounded-lg border bg-card p-3 transition-all hover:shadow-sm">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-mono">#{evt.seq}</span>
                            <span>{formatDateTime(evt.timestamp)}</span>
                          </div>
                          <div className="mt-1 font-semibold text-sm">{evt.eventType}</div>
                          <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-xs font-mono">{JSON.stringify(evt.payload ?? {}, null, 2)}</pre>
                        </div>
                      ))}
                      {detail.events.length === 0 && (
                        <div className="py-8 text-center text-sm text-muted-foreground">暂无事件</div>
                      )}
                      {detail.truncated && (
                        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
                          ⚠️ 仅显示前 2000 条事件，完整记录请使用导出功能
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
                {detailTab === 'latex' && detail.latexTrace && (
                  <ScrollArea className="h-[50vh] rounded-xl border bg-muted/30 p-4">
                    {latexLoading && <Skeleton className="h-16 w-full" />}
                    {!latexLoading && (
                      <div className="space-y-3">
                        {latexEvents.map((evt) => (
                          <div key={evt.seq} className="rounded-lg border bg-card p-3 transition-all hover:shadow-sm">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="font-mono">#{evt.seq}</span>
                              <Badge variant={evt.matched ? 'default' : 'secondary'}>{evt.matched ? '命中' : '未匹配'}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">原因：{evt.reason}</div>
                            <div className="mt-2 text-xs font-semibold">原始：</div>
                            <pre className="mb-2 mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs font-mono">{evt.raw}</pre>
                            <div className="text-xs font-semibold">转换：</div>
                            <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs font-mono">{evt.normalized}</pre>
                          </div>
                        ))}
                        {latexEvents.length === 0 && (
                          <div className="py-8 text-center text-sm text-muted-foreground">暂无 LaTeX 记录</div>
                        )}
                        {latexTruncated && (
                          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
                            ⚠️ 内容较多，仅展示部分段落
                          </div>
                        )}
                      </div>
                    )}
                  </ScrollArea>
                )}
                {detailTab === 'latex' && !detail.latexTrace && (
                  <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">该任务未记录 LaTeX 日志</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
