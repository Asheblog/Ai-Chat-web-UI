"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Clock3, Copy, ExternalLink, Loader2, RefreshCw, Search, Trash2 } from "lucide-react"
import { listChatShares, revokeChatShare, updateChatShare } from '@/features/share/api'
import type { ChatShareSummary } from '@/types'
import { copyToClipboard, formatDate } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

const EXPIRATION_SHORTCUTS: Array<{ label: string; value: number | null }> = [
  { label: "24 小时", value: 24 },
  { label: "3 天", value: 72 },
  { label: "7 天", value: 168 },
  { label: "30 天", value: 720 },
  { label: "不自动失效", value: null },
]

const buildShareUrl = (token: string) => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, "")}/share/${token}`
  }
  return `/share/${token}`
}

const toShareSummary = (share: ChatShareSummary): ChatShareSummary => ({
  ...share,
  expiresAt: share.expiresAt ?? null,
  revokedAt: share.revokedAt ?? null,
})

export function ShareManagementPanel() {
  const { toast } = useToast()
  const [shares, setShares] = useState<ChatShareSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [query, setQuery] = useState("")

  const fetchShares = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listChatShares({ status: "all", limit: 100 })
      if (response?.success && response.data) {
        setShares(response.data.shares)
      } else {
        setShares([])
        if (response?.error) {
          setError(response.error)
        }
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "获取分享列表失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchShares()
  }, [fetchShares])

  const filteredShares = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return shares
    return shares.filter((share) => {
      return [share.title, share.sessionTitle, share.token]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized))
    })
  }, [query, shares])

  const recentShares = useMemo(() => filteredShares.slice(0, 6), [filteredShares])

  const handleCopy = async (share: ChatShareSummary) => {
    try {
      await copyToClipboard(buildShareUrl(share.token))
      toast({ title: "已复制", description: "分享链接已复制到剪贴板" })
    } catch (error) {
      toast({
        title: "复制失败",
        description: error instanceof Error ? error.message : "无法复制链接",
        variant: "destructive",
      })
    }
  }

  const handleRevoke = async (shareId: number) => {
    setUpdatingId(shareId)
    try {
      const response = await revokeChatShare(shareId)
      if (!response?.success || !response.data) {
        throw new Error(response?.error || "撤销失败")
      }
      toast({ title: "已撤销分享链接" })
      const updated = toShareSummary(response.data)
      setShares((prev) => prev.map((item) => (item.id === shareId ? updated : item)))
    } catch (err: any) {
      toast({
        title: "撤销失败",
        description: err?.response?.data?.error || err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setUpdatingId(null)
    }
  }

  const handleExpiryChange = async (shareId: number, hours: number | null) => {
    setUpdatingId(shareId)
    try {
      const response = await updateChatShare(shareId, { expiresInHours: hours })
      if (!response?.success || !response.data) {
        throw new Error(response?.error || "更新失败")
      }
      toast({ title: "有效期已更新" })
      const updated: ChatShareSummary = {
        id: response.data.id,
        sessionId: response.data.sessionId,
        token: response.data.token,
        title: response.data.title,
        sessionTitle: response.data.sessionTitle,
        messageCount: response.data.messageCount,
        createdAt: response.data.createdAt,
        expiresAt: response.data.expiresAt ?? null,
        revokedAt: response.data.revokedAt ?? null,
      }
      setShares((prev) => prev.map((item) => (item.id === shareId ? updated : item)))
    } catch (err: any) {
      toast({
        title: "更新失败",
        description: err?.response?.data?.error || err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setUpdatingId(null)
    }
  }

  const renderStatus = (share: ChatShareSummary) => {
    if (share.revokedAt) {
      return <span className="v2-status v2-status-danger">已撤销</span>
    }
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
      return <span className="v2-status v2-status-warning">已过期</span>
    }
    return <span className="v2-status v2-status-success">有效</span>
  }

  return (
    <section className="v2-panel p-4 shadow-none sm:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h2 className="v2-section-title shrink-0">最近分享</h2>
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索分享内容或备注"
              className="h-9 bg-background pl-9"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="text-xs text-muted-foreground">共 {shares.length} 条</span>
          {error ? <span className="v2-status v2-status-warning">同步失败</span> : null}
          <Button variant="ghost" size="sm" onClick={fetchShares} disabled={loading} className="h-8 px-2">
            <RefreshCw className={cn("mr-1 h-4 w-4", loading ? "animate-spin" : "")} />
            刷新
          </Button>
        </div>
      </div>

      <div>
        {error && shares.length > 0 ? (
          <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {error}
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载分享数据...
          </div>
        ) : shares.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {error ? '分享服务暂不可用，请稍后刷新。' : '暂无分享记录，您可以在聊天气泡的分享按钮中创建。'}
          </div>
        ) : recentShares.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            没有匹配的分享记录。
          </div>
        ) : (
          <div className="v2-table-wrap overflow-x-auto border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">分享内容</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium">消息数</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {recentShares.map((share, index) => (
                  <tr
                    key={share.id}
                    className={cn(
                      "border-b border-border/50 text-sm last:border-b-0",
                      index === 0 ? "bg-primary/5" : "bg-background/70"
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <span className="line-clamp-1">{share.title}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-1">对话内容：{share.sessionTitle}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(share.createdAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{share.messageCount}</td>
                    <td className="px-4 py-3">{renderStatus(share)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleCopy(share)}
                          disabled={Boolean(share.revokedAt)}
                          aria-label="复制分享链接"
                          title="复制分享链接"
                          className="h-8 w-8 bg-background"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          asChild
                          aria-label="打开分享"
                          title="打开分享"
                          className={cn(
                            "h-8 w-8 bg-background",
                            share.revokedAt ? "pointer-events-none opacity-45" : ""
                          )}
                        >
                          <a href={buildShareUrl(share.token)} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              disabled={Boolean(share.revokedAt) || updatingId === share.id}
                              aria-label="调整有效期"
                              title={share.expiresAt ? `有效期：${formatDate(share.expiresAt)}` : '不自动失效'}
                              className="h-8 w-8 bg-background"
                            >
                              {updatingId === share.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Clock3 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {EXPIRATION_SHORTCUTS.map((option) => (
                              <DropdownMenuItem
                                key={`${share.id}-${option.label}`}
                                onClick={() => handleExpiryChange(share.id, option.value)}
                              >
                                {option.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleRevoke(share.id)}
                          disabled={Boolean(share.revokedAt) || updatingId === share.id}
                          aria-label="撤销分享"
                          title="撤销分享"
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default ShareManagementPanel
