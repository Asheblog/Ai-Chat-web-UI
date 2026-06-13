'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import * as mcpApi from '@/features/mcp/api'
import type { McpToolView, McpToolDetail } from '@/types'
import { Search, Pin, PinOff, FileText, Wrench } from 'lucide-react'

export function ToolsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState<McpToolView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [detail, setDetail] = useState<McpToolDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const doSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true); setError(null)
    setSearched(true)
    try {
      const res = await mcpApi.searchTools(trimmed)
      setItems(res.data ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '搜索失败')
    } finally { setLoading(false) }
  }

  const handleDetail = async (connId: number, name: string) => {
    setDetailLoading(true)
    try {
      const res = await mcpApi.getToolDetail(connId, name)
      setDetail(res.data ?? null)
    } catch (err: any) {
      toast({ title: '加载工具详情失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setDetailLoading(false) }
  }

  const handlePin = async (connId: number, name: string, pinned: boolean) => {
    try {
      if (pinned) await mcpApi.unpinTool(connId, name)
      else await mcpApi.pinTool(connId, name)
      setItems((prev) => prev.map((t) => (t.connectionId === connId && t.originalName === name ? { ...t, pinned: !pinned } : t)))
      toast({ title: pinned ? '已取消固定' : '已固定' })
    } catch (err: any) {
      toast({ title: '操作失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="搜索工具名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query) }}
          className="h-9 max-w-xs text-xs"
        />
        <Button size="sm" variant="outline" onClick={() => doSearch(query)} disabled={!query.trim()}>
          <Search className="mr-1 h-3.5 w-3.5" />搜索
        </Button>
      </div>

      {loading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && items.length > 0 && (
        <div className="v2-table-wrap">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">工具名</th>
                <th className="py-2 pr-3">connectionId</th>
                <th className="py-2 pr-3">描述</th>
                <th className="py-2 pr-3">详情</th>
                <th className="py-2 pr-3">固定</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={`${t.connectionId}-${t.originalName}`} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3 font-mono max-w-[180px] truncate" title={t.originalName}>{t.originalName}</td>
                  <td className="py-2 pr-3">{t.connectionId}</td>
                  <td className="py-2 pr-3 max-w-[200px] truncate text-muted-foreground" title={t.description || undefined}>{t.description || '-'}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => handleDetail(t.connectionId, t.originalName)} title="查看 schema" disabled={detailLoading} className="inline-flex p-1 rounded hover:bg-accent">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => handlePin(t.connectionId, t.originalName, !!t.pinned)} title={t.pinned ? '取消固定' : '固定'} className="inline-flex p-1 rounded hover:bg-accent">
                      {t.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && !searched && (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <Wrench className="h-9 w-9 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground/60">搜索 MCP 工具</p>
          <p className="mt-1 text-xs text-muted-foreground/60 max-w-[260px]">
            输入关键词搜索已连接 MCP 服务中的可用工具
          </p>
        </div>
      )}

      {!loading && !error && items.length === 0 && searched && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <p className="text-sm text-muted-foreground/60">未找到匹配的工具</p>
          <p className="mt-1 text-xs text-muted-foreground/40">尝试不同的关键词或确认连接已刷新</p>
        </div>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{detail?.originalName ?? '工具详情'}</DialogTitle>
            <DialogDescription>{detail?.description || '无描述'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Input Schema</p>
              <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                {detail ? JSON.stringify(detail.inputSchema ?? null, null, 2) : '加载中...'}
              </pre>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>connectionId: {detail?.connectionId}</span>
              <span>|</span>
              <span>pinned: {detail?.pinned ? '是' : '否'}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
