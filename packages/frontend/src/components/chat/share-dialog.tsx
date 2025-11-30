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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Copy } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { apiClient } from '@/lib/api'
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

const EXPIRATION_OPTIONS = [
  { value: '24', label: '24 小时' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '720', label: '30 天' },
  { value: 'never', label: '不自动失效' },
  { value: 'custom', label: '自定义（小时）' },
]

const messageKey = (id: number | string) => (typeof id === 'string' ? id : String(id))

interface ShareDialogProps {
  sessionId: number
  pivotMessageId: number | string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ShareCandidate = {
  key: string
  id: number
  role: 'user' | 'assistant'
  createdAt: string
  text: string
}

export function ShareDialog({ sessionId, pivotMessageId, open, onOpenChange }: ShareDialogProps) {
  const { toast } = useToast()
  const messageMetas = useChatStore((state) => state.messageMetas)
  const messageBodies = useChatStore((state) => state.messageBodies)
  const currentSession = useChatStore((state) => state.currentSession)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [shareResult, setShareResult] = useState<{ detail: ChatShare; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [expiryPreset, setExpiryPreset] = useState('72')
  const [customExpiryHours, setCustomExpiryHours] = useState('')

  const candidates = useMemo<ShareCandidate[]>(() => {
    return messageMetas
      .filter((meta) => typeof meta.id === 'number')
      .map((meta) => {
        const key = messageKey(meta.id)
        const body = messageBodies[key]
        const text = (body?.content || '').trim()
        return {
          key,
          id: Number(meta.id),
          role: meta.role,
          createdAt: meta.createdAt,
          text: text || (meta.role === 'user' ? '（暂无文本内容）' : '（AI 尚未返回文本）'),
        }
      })
  }, [messageBodies, messageMetas])

  const pivotKey = useMemo(() => messageKey(pivotMessageId), [pivotMessageId])

  useEffect(() => {
    if (!open) {
      return
    }
    const pivotIndex = candidates.findIndex((item) => item.key === pivotKey)
    const count = pivotIndex >= 0 ? pivotIndex + 1 : candidates.length
    setSelectedKeys(candidates.slice(0, count).map((item) => item.key))
    setShareResult(null)
    setError(null)
    setTitleInput((currentSession?.title || '分享链接').slice(0, 60))
    setExpiryPreset('72')
    setCustomExpiryHours('')
  }, [candidates, open, pivotKey, currentSession?.title])

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      setShareResult(null)
      setError(null)
    }
  }, [open])

  const selectedCandidates = useMemo(
    () => candidates.filter((item) => selectedKeys.includes(item.key)),
    [candidates, selectedKeys],
  )

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((item) => item !== key)
      }
      return [...prev, key]
    })
  }

  const handleSelectAll = () => {
    setSelectedKeys(candidates.map((item) => item.key))
  }

  const handleClearSelection = () => {
    setSelectedKeys([])
  }

  const handleCreateShare = async () => {
    if (selectedCandidates.length === 0) {
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
        messageIds: selectedCandidates.map((item) => item.id),
        title: titleInput.trim() || undefined,
        expiresInHours,
      }
      const response = await apiClient.createChatShare(payload)
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

  const canSubmit = selectedCandidates.length > 0 && !isSubmitting && candidates.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>分享对话内容</DialogTitle>
          <DialogDescription>
            选择要分享的消息并生成公开链接，任何人可通过链接查看内容（无需登录）。
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
              <Button variant="outline" onClick={() => setShareResult(null)}>
                返回选择
              </Button>
              <Button onClick={() => onOpenChange(false)}>完成</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
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

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                已选择 {selectedCandidates.length} / {candidates.length} 条消息
              </span>
              <div className="space-x-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={candidates.length === 0}
                >
                  全选
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSelection}
                  disabled={selectedKeys.length === 0}
                >
                  清空
                </Button>
              </div>
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto space-y-2 pr-2">
              {candidates.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  当前会话暂无可分享的消息
                </div>
              ) : (
                candidates.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 hover:bg-muted/60 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedKeys.includes(item.key)}
                      onCheckedChange={() => toggleSelection(item.key)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {item.role === 'user' ? '用户' : 'AI'}
                        </span>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground break-words">
                        {item.text}
                      </p>
                    </div>
                  </label>
                ))
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
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
