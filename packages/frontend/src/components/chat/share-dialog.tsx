'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Copy } from 'lucide-react'
import { useChatMessages } from '@/store/chat-store'
import { createChatShare } from '@/features/share/api'
import { copyToClipboard, formatDate } from '@/lib/utils'
import type { ChatShare } from '@/types'
import { useToast } from '@/components/ui/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { messageKey } from '@/features/chat/store/utils'
import { ShareSelectionToolSummary } from '@/components/chat/share-selection-tool-summary'

const EXPIRATION_OPTIONS = [
  { value: '24', label: '24 小时' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '720', label: '30 天' },
  { value: 'never', label: '不自动失效' },
  { value: 'custom', label: '自定义（小时）' },
]

interface ShareDialogProps {
  sessionId: number
  sessionTitle?: string | null
  selectedMessageIds: number[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onShareCompleted?: () => void
}

export function ShareDialog({ sessionId, sessionTitle, selectedMessageIds, open, onOpenChange, onShareCompleted }: ShareDialogProps) {
  const { toast } = useToast()
  const { messageMetas, messageBodies } = useChatMessages((state) => ({
    messageMetas: state.messageMetas,
    messageBodies: state.messageBodies,
  }))
  const [shareResult, setShareResult] = useState<{ detail: ChatShare; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [expiryPreset, setExpiryPreset] = useState('72')
  const [customExpiryHours, setCustomExpiryHours] = useState('')

  const sortedMessageIds = useMemo(() => {
    if (!selectedMessageIds?.length) return []
    const orderMap = new Map<number, number>()
    messageMetas.forEach((meta, index) => {
      if (typeof meta.id === 'number' && meta.sessionId === sessionId) {
        orderMap.set(Number(meta.id), index)
      }
    })
    return [...new Set(selectedMessageIds)]
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => {
        const orderA = orderMap.get(a) ?? a
        const orderB = orderMap.get(b) ?? b
        return orderA - orderB
      })
  }, [messageMetas, selectedMessageIds, sessionId])
  const previewMessageId = sortedMessageIds[0] ?? null
  const previewBodyEvents = useMemo(() => {
    if (previewMessageId == null) return null
    const key = messageKey(previewMessageId)
    return messageBodies[key]?.toolEvents ?? null
  }, [previewMessageId, messageBodies])

  useEffect(() => {
    if (!open) {
      return
    }
    setShareResult(null)
    setError(null)
    setTitleInput((sessionTitle || '分享链接').slice(0, 60))
    setExpiryPreset('72')
    setCustomExpiryHours('')
  }, [open, sessionTitle])

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      setShareResult(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setShareResult(null)
    setError(null)
  }, [selectedMessageIds, open])

  const handleCreateShare = async () => {
    if (sortedMessageIds.length === 0) {
      setError('请至少选择一条消息')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      let expiresInHours: number | null | undefined
      if (expiryPreset === 'never') {
        expiresInHours = null
      } else if (expiryPreset === 'custom') {
        const parsed = Number(customExpiryHours)
        if (!Number.isFinite(parsed) || parsed < 1) {
          setError('自定义有效期需为 1-720 小时')
          setIsSubmitting(false)
          return
        }
        expiresInHours = Math.min(parsed, 24 * 30)
      } else {
        expiresInHours = Number(expiryPreset)
      }
      const payload = {
        sessionId,
        messageIds: sortedMessageIds,
        title: titleInput.trim() || undefined,
        expiresInHours,
      }
      const response = await createChatShare(payload)
      if (!response?.success || !response.data) {
        throw new Error(response?.error || '分享返回结果为空')
      }
      const detail = response.data as ChatShare
      if (!detail.token) {
        throw new Error('分享返回结果不完整')
      }
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin.replace(/\/$/, '')
          : ''
      const shareUrl = origin ? `${origin}/share/${detail.token}` : `/share/${detail.token}`
      setShareResult({ detail, url: shareUrl })
      toast({ title: '分享链接已生成', description: '复制后即可分享给任何人查看' })
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        '生成分享链接失败，请稍后重试'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = async () => {
    if (!shareResult?.url) return
    try {
      await copyToClipboard(shareResult.url)
      toast({ title: '已复制', description: '分享链接已复制到剪贴板' })
    } catch (err) {
      toast({
        title: '复制失败',
        description: err instanceof Error ? err.message : '无法复制分享链接',
        variant: 'destructive',
      })
    }
  }

  const canSubmit = sortedMessageIds.length > 0 && !isSubmitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>分享对话内容</DialogTitle>
          <DialogDescription>
            已在聊天界面选定要分享的内容，这里配置标题和有效期，即可生成公开链接。
          </DialogDescription>
        </DialogHeader>

        {shareResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              分享链接生成于 {formatDate(shareResult.detail.createdAt)}，包含
              {shareResult.detail.messageCount} 条消息。
            </p>
            <div className="flex gap-2">
              <Input readOnly value={shareResult.url} />
              <Button variant="outline" onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />
                复制
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                返回聊天
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setShareResult(null)}>
                  重新配置
                </Button>
                <Button
                  onClick={() => {
                    if (onShareCompleted) {
                      onShareCompleted()
                    } else {
                      onOpenChange(false)
                    }
                  }}
                >
                  完成
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary/80">
                当前已选 {sortedMessageIds.length} 条消息。如需调整，请先关闭本对话框返回聊天界面。
              </div>
              {sortedMessageIds.length === 0 && (
                <p className="text-xs text-destructive">暂无选中内容，请在聊天界面勾选要分享的消息。</p>
              )}
            </div>

            <ShareSelectionToolSummary
              sessionId={sessionId}
              messageId={previewMessageId}
              bodyEvents={previewBodyEvents ?? undefined}
              title="首条选中消息的工具调用"
            />

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">分享标题</p>
                <Input
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="给分享链接起个名字"
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">有效期</p>
                <Select value={expiryPreset} onValueChange={(value) => setExpiryPreset(value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择有效期" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {expiryPreset === 'custom' && (
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={customExpiryHours}
                    onChange={(e) => setCustomExpiryHours(e.target.value)}
                    placeholder="输入小时数（1-720）"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  超过有效期的链接会自动失效，可在分享管理中延长或撤销。
                </p>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                返回聊天
              </Button>
              <Button onClick={handleCreateShare} disabled={!canSubmit}>
                {isSubmitting ? '生成中…' : '生成分享链接'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
