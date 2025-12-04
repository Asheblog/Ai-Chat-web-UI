"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Copy, Loader2, RefreshCw, ShieldX } from "lucide-react"
import { listChatShares, revokeChatShare, updateChatShare } from '@/features/share/api'
import type { ChatShareSummary } from '@/types'
import { copyToClipboard, formatDate } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

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

export function ShareManagementPanel() {
  const { toast } = useToast()
  const [shares, setShares] = useState<ChatShareSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

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

  const activeShares = useMemo(() => shares.length, [shares])

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
      if (response?.success && response.data) {
        toast({ title: "已撤销分享链接" })
        setShares((prev) => prev.map((item) => (item.id === shareId ? response.data : item)))
      } else {
        throw new Error(response?.error || "撤销失败")
      }
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
      if (response?.success && response.data) {
        toast({ title: "有效期已更新" })
        setShares((prev) => prev.map((item) => (item.id === shareId ? response.data : item)))
      } else {
        throw new Error(response?.error || "更新失败")
      }
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
      return <Badge variant="destructive">已撤销</Badge>
    }
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
      return <Badge variant="secondary">已过期</Badge>
    }
    return <Badge>生效中</Badge>
  }

  return (
    <Card className="border-dashed border-primary/30 bg-muted/10">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-xl">分享链接管理</CardTitle>
          <CardDescription>
            已生成 {activeShares} 条分享链接，可在此处复制、调整有效期或立即撤销。
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchShares} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载分享数据...
          </div>
        ) : shares.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            暂无分享记录，您可以在聊天气泡的分享按钮中创建。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">标题</th>
                  <th className="py-2 pr-2 font-medium">所属会话</th>
                  <th className="py-2 pr-2 font-medium">创建时间</th>
                  <th className="py-2 pr-2 font-medium">有效期</th>
                  <th className="py-2 pr-2 font-medium">状态</th>
                  <th className="py-2 pr-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id} className="border-t border-border/60 text-sm">
                    <td className="py-3 pr-2 font-medium text-foreground">{share.title}</td>
                    <td className="py-3 pr-2 text-muted-foreground">{share.sessionTitle}</td>
                    <td className="py-3 pr-2 text-muted-foreground">{formatDate(share.createdAt)}</td>
                    <td className="py-3 pr-2 text-muted-foreground">
                      {share.expiresAt ? formatDate(share.expiresAt) : '不自动失效'}
                    </td>
                    <td className="py-3 pr-2">{renderStatus(share)}</td>
                    <td className="py-3 pl-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(share)}
                          disabled={Boolean(share.revokedAt)}
                        >
                          <Copy className="mr-1 h-3 w-3" />
                          复制
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={Boolean(share.revokedAt) || updatingId === share.id}
                            >
                              调整有效期
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
                          size="sm"
                          onClick={() => handleRevoke(share.id)}
                          disabled={Boolean(share.revokedAt) || updatingId === share.id}
                        >
                          <ShieldX className="mr-1 h-3 w-3" />
                          撤销
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default ShareManagementPanel
