'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { cancelCompressionGroup, updateCompressionGroupState } from '@/features/chat/api/messages'
import { useChatStore } from '@/store/chat-store'
import type { MessageBody, MessageMeta } from '@/types'

const roleLabel = (role: string) => {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  return role || '消息'
}

const formatTime = (raw: string) => {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString()
}

export interface CompressedGroupCardProps {
  meta: MessageMeta
  body: MessageBody
}

export function CompressedGroupCard({ meta, body }: CompressedGroupCardProps) {
  const { toast } = useToast()
  const fetchMessages = useChatStore((state) => state.fetchMessages)
  const [saving, setSaving] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const expanded = Boolean(body.expanded ?? meta.expanded)
  const groupId = meta.messageGroupId ?? null
  const compressedMessages = body.compressedMessages ?? meta.compressedMessages ?? []
  const compressedCount = useMemo(() => {
    if (compressedMessages.length > 0) return compressedMessages.length
    const fallback = Number((body.metadata as any)?.compressedCount ?? (meta.metadata as any)?.compressedCount)
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 0
  }, [body.metadata, compressedMessages.length, meta.metadata])

  const toggleExpanded = async () => {
    if (!groupId || saving || undoing) return
    setSaving(true)
    try {
      await updateCompressionGroupState(meta.sessionId, groupId, !expanded)
      await fetchMessages(meta.sessionId, { page: 'latest', mode: 'replace' })
    } catch (error: any) {
      toast({
        title: '操作失败',
        description: error?.response?.data?.error || error?.message || '更新压缩状态失败',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const cancelGroup = async () => {
    if (!groupId || saving || undoing) return
    setUndoing(true)
    try {
      await cancelCompressionGroup(meta.sessionId, groupId)
      await fetchMessages(meta.sessionId, { page: 'latest', mode: 'replace' })
      toast({ title: '已撤销压缩', description: '历史消息已恢复到时间线中' })
    } catch (error: any) {
      toast({
        title: '撤销失败',
        description: error?.response?.data?.error || error?.message || '撤销压缩失败',
        variant: 'destructive',
      })
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">上下文已自动压缩</span>
          <Badge variant="outline">{compressedCount > 0 ? `${compressedCount} 条` : '摘要'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={toggleExpanded}
            disabled={!groupId || saving || undoing}
          >
            {saving ? '处理中...' : expanded ? '收起历史' : '查看历史'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={cancelGroup}
            disabled={!groupId || saving || undoing}
          >
            {undoing ? '撤销中...' : '撤销压缩'}
          </Button>
        </div>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
        {body.content || ''}
      </p>

      {expanded && compressedMessages.length > 0 && (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-md border bg-background/70 p-3">
          {compressedMessages.map((item) => (
            <div key={`${item.id}-${item.createdAt}`} className="space-y-1 rounded-sm border-b pb-2 last:border-b-0">
              <div className="text-xs text-muted-foreground">{roleLabel(item.role)} · {formatTime(item.createdAt)}</div>
              <div className="whitespace-pre-wrap break-words text-sm">{item.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
