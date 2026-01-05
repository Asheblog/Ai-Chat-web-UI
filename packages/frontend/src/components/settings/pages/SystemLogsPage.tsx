"use client"
import { useEffect, useState, useCallback } from "react"
import { useAuthStore } from "@/store/auth-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from '@/components/ui/use-toast'
import { getSystemLogs, getSystemLogTags, type SystemLogEntry } from '@/features/system/api'
import { RefreshCcw, Search, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const levelColors: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  warn: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const levelLabels: Record<string, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

export function SystemLogsPage() {
  const { toast } = useToast()
  const { user, actorState } = useAuthStore((state) => ({ user: state.user, actorState: state.actorState }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<SystemLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)

  // 过滤条件
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [availableTags, setAvailableTags] = useState<string[]>([])

  // 展开的日志项
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const fetchLogs = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const params: Record<string, any> = { page, pageSize }
      if (levelFilter) params.level = levelFilter
      if (tagFilter) params.tag = tagFilter
      if (searchFilter) params.search = searchFilter
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo

      const res = await getSystemLogs(params)
      setItems(res.data?.items ?? [])
      setTotal(res.data?.total ?? 0)
      setHasMore(res.data?.hasMore ?? false)
    } catch (error: any) {
      toast({ title: '获取日志失败', description: error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [isAdmin, page, pageSize, levelFilter, tagFilter, searchFilter, dateFrom, dateTo, toast])

  const fetchTags = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await getSystemLogTags()
      setAvailableTags(res.data?.tags ?? [])
    } catch {
      // 忽略
    }
  }, [isAdmin])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const handleSearch = () => {
    setPage(1)
    fetchLogs()
  }

  const handleRefresh = () => {
    fetchLogs()
    fetchTags()
  }

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const formatTime = (ts: string) => {
    try {
      const date = new Date(ts)
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return ts
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        只有管理员可以查看系统日志
      </div>
    )
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      {/* 过滤条件 */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground mb-1 block">搜索关键词</label>
          <div className="flex gap-2">
            <Input
              placeholder="搜索消息内容..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={handleSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="w-[140px]">
          <label className="text-xs text-muted-foreground mb-1 block">日志级别</label>
          <Select value={levelFilter} onValueChange={(v) => { setLevelFilter(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger>
              <SelectValue placeholder="全部级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="debug">DEBUG</SelectItem>
              <SelectItem value="info">INFO</SelectItem>
              <SelectItem value="warn">WARN</SelectItem>
              <SelectItem value="error">ERROR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-[160px]">
          <label className="text-xs text-muted-foreground mb-1 block">模块标签</label>
          <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger>
              <SelectValue placeholder="全部模块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {availableTags.map(tag => (
                <SelectItem key={tag} value={tag}>{tag}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[130px]">
          <label className="text-xs text-muted-foreground mb-1 block">开始日期</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
          />
        </div>

        <div className="w-[130px]">
          <label className="text-xs text-muted-foreground mb-1 block">结束日期</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
          />
        </div>

        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCcw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          刷新
        </Button>
      </div>

      {/* 统计信息 */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 {total} 条日志
          {items.length > 0 && ` (显示 ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)})`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs">
            {page} / {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 日志列表 */}
      <div className="border rounded-lg overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            暂无日志记录
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "px-4 py-2 hover:bg-muted/50 cursor-pointer transition-colors",
                  expandedIds.has(item.id) && "bg-muted/30"
                )}
                onClick={() => toggleExpand(item.id)}
              >
                <div className="flex items-start gap-3">
                  {/* 时间 */}
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {formatTime(item.ts)}
                  </span>

                  {/* 级别 */}
                  <Badge
                    variant="secondary"
                    className={cn("text-xs font-mono px-1.5 py-0", levelColors[item.level])}
                  >
                    {levelLabels[item.level] || item.level.toUpperCase()}
                  </Badge>

                  {/* 标签 */}
                  {item.tag && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {item.tag}
                    </Badge>
                  )}

                  {/* 消息 */}
                  <span className={cn(
                    "flex-1 text-sm",
                    item.level === 'error' && "text-red-600 dark:text-red-400",
                    item.level === 'warn' && "text-yellow-600 dark:text-yellow-400"
                  )}>
                    {item.msg}
                  </span>
                </div>

                {/* 展开的上下文 */}
                {expandedIds.has(item.id) && item.ctx && (
                  <div className="mt-2 ml-20 p-2 bg-muted rounded text-xs font-mono overflow-x-auto">
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(item.ctx, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}