'use client'

import { useMemo, useState } from 'react'
import type { ApiResponse, ChatShare, MessageMeta, ShareMessage, ShareMessagesPage, ToolEvent } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { ReasoningSection } from '@/components/message-bubble/reasoning-section'
import { ToolCallsSection } from '@/components/message-bubble/tool-calls-section'
import { cn, formatDate } from '@/lib/utils'
import { User, Bot } from 'lucide-react'

interface ShareViewerProps {
  share: ChatShare
  token: string
  initialMessages: ShareMessage[]
  initialPagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  brandText?: string
}

const SHARE_CONTAINER_CLASS = 'mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-10'

/** 格式化相对时间 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** 根据 toolEvents 生成工具摘要 */
function buildToolSummary(toolEvents?: ToolEvent[]) {
  if (!toolEvents || toolEvents.length === 0) return null

  const normalizeStatus = (event: ToolEvent): ToolEvent['status'] => {
    if (
      event.status === 'running' ||
      event.status === 'success' ||
      event.status === 'error' ||
      event.status === 'pending' ||
      event.status === 'rejected' ||
      event.status === 'aborted'
    ) {
      return event.status
    }
    if (event.phase === 'pending_approval') return 'pending'
    if (event.phase === 'result') return 'success'
    if (event.phase === 'error') return 'error'
    if (event.phase === 'rejected') return 'rejected'
    if (event.phase === 'aborted') return 'aborted'
    if (event.stage === 'result') return 'success'
    if (event.stage === 'error') return 'error'
    return 'running'
  }

  const toolCounts = new Map<string, number>()
  let successCount = 0
  let runningCount = 0
  let pendingCount = 0
  let errorCount = 0
  let rejectedCount = 0
  let abortedCount = 0

  toolEvents.forEach((event) => {
    const status = normalizeStatus(event)
    const toolName = event.identifier || event.apiName || event.tool
    toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1)
    if (status === 'success') successCount += 1
    else if (status === 'pending') pendingCount += 1
    else if (status === 'rejected') rejectedCount += 1
    else if (status === 'aborted') abortedCount += 1
    else if (status === 'error') errorCount += 1
    else runningCount += 1
  })

  const describeTool = (tool: string) => {
    if (tool === 'web_search') return '联网搜索'
    if (tool === 'python_runner') return 'Python 工具'
    if (tool === 'read_url') return '网页读取'
    if (tool === 'document_list') return '文档列表'
    if (tool === 'document_search') return '文档搜索'
    if (tool === 'kb_search') return '知识库搜索'
    if (tool.startsWith('workspace_')) return '工作区工具'
    return tool
  }

  const parts: string[] = []
  if (successCount > 0) parts.push(`完成 ${successCount} 次`)
  if (runningCount > 0) parts.push(`进行中 ${runningCount} 次`)
  if (pendingCount > 0) parts.push(`待审批 ${pendingCount} 次`)
  if (rejectedCount > 0) parts.push(`拒绝 ${rejectedCount} 次`)
  if (abortedCount > 0) parts.push(`中止 ${abortedCount} 次`)
  if (errorCount > 0) parts.push(`失败 ${errorCount} 次`)

  const labelParts = Array.from(toolCounts.entries()).map(
    ([tool, count]) => `${describeTool(tool)} ${count} 次`
  )

  return {
    total: toolEvents.length,
    summaryText: parts.join(' · ') || '等待工具结果',
    label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
    successCount,
    runningCount,
    pendingCount,
    errorCount,
    rejectedCount,
    abortedCount,
  }
}

interface ShareMessageItemProps {
  msg: ChatShare['messages'][number]
  sessionId: number
  defaultReasoningExpanded?: boolean
}

function ShareMessageItem({
  msg,
  sessionId,
  defaultReasoningExpanded = false,
}: ShareMessageItemProps) {
  const hasReasoning = msg.reasoning && msg.reasoning.trim().length > 0
  const toolEvents = (msg as { toolEvents?: ToolEvent[] }).toolEvents
  const normalizedToolEvents = useMemo(() => {
    if (!toolEvents || toolEvents.length === 0) return []
    const merged = new Map<string, ToolEvent>()
    let fallbackIndex = 0
    for (const event of toolEvents) {
      const key =
        typeof event.callId === 'string' && event.callId.trim().length > 0
          ? `call:${event.callId}`
          : typeof event.id === 'string' && event.id.trim().length > 0
            ? `id:${event.id}`
            : `fallback:${fallbackIndex++}`
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, event)
        continue
      }
      merged.set(key, {
        ...existing,
        ...event,
        createdAt: Math.min(existing.createdAt, event.createdAt),
        updatedAt: Math.max(
          existing.updatedAt ?? existing.createdAt,
          event.updatedAt ?? event.createdAt,
        ),
        details:
          existing.details || event.details
            ? { ...(existing.details ?? {}), ...(event.details ?? {}) }
            : undefined,
      })
    }
    return Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt)
  }, [toolEvents])
  const toolSummary = useMemo(() => buildToolSummary(normalizedToolEvents), [normalizedToolEvents])
  const hasReasoningSection = hasReasoning || normalizedToolEvents.length > 0
  const meta = useMemo<MessageMeta>(() => ({
    id: msg.id,
    sessionId,
    stableKey: `share-${msg.id}-${msg.createdAt}`,
    role: msg.role,
    createdAt: msg.createdAt,
    reasoningStatus: hasReasoning ? 'done' : undefined,
    reasoningDurationSeconds: null,
    reasoningIdleMs: null,
    reasoningUnavailableCode: null,
    reasoningUnavailableReason: null,
    reasoningUnavailableSuggestion: null,
  }), [hasReasoning, msg.createdAt, msg.id, msg.role, sessionId])

  const isUser = msg.role === 'user'

  return (
    <article className={cn('flex gap-3 border-b border-border/70 py-5', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-[hsl(var(--surface-hover))] text-muted-foreground'
            : 'bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-primary-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className={cn('flex items-center gap-2 text-xs', isUser ? 'justify-end' : 'justify-start')}>
          <span className="font-medium uppercase tracking-[0.08em] text-muted-foreground">{isUser ? '用户' : 'AI 助手'}</span>
          <span className="text-muted-foreground/80">{formatDate(msg.createdAt)}</span>
        </div>

        {!isUser && hasReasoningSection && (
          <>
            {hasReasoning && (
              <ReasoningSection
                meta={meta}
                reasoningRaw={msg.reasoning || ''}
                reasoningHtml={undefined}
                reasoningPlayedLength={msg.reasoning?.length || 0}
                defaultExpanded={defaultReasoningExpanded}
              />
            )}
            {normalizedToolEvents.length > 0 && (
              <ToolCallsSection
                meta={meta}
                timeline={normalizedToolEvents}
                summary={toolSummary}
                defaultExpanded={false}
              />
            )}
          </>
        )}

        <div
          className={cn(
            'max-w-none text-sm leading-7',
            isUser &&
              'ml-auto inline-block rounded-2xl rounded-tr-md border border-border/80 bg-[hsl(var(--surface-hover))] px-4 py-2.5'
          )}
        >
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <MarkdownRenderer html={null} fallback={msg.content} />
          </div>
        </div>

        {msg.images && msg.images.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {msg.images.map((src, index) => (
              <img
                key={`${src}-${index}`}
                src={src}
                alt="分享图片"
                className="max-h-48 w-full rounded-lg border border-border/70 bg-[hsl(var(--surface))] object-contain"
                loading="lazy"
              />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

export function ShareViewer({
  share,
  token,
  initialMessages,
  initialPagination,
  brandText = 'AIChat',
}: ShareViewerProps) {
  const [messages, setMessages] = useState<ShareMessage[]>(initialMessages)
  const [pagination, setPagination] = useState(initialPagination)
  const [loadingMore, setLoadingMore] = useState(false)
  const hasMore = pagination.page < pagination.totalPages

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = pagination.page + 1
      const response = await fetch(`/api/shares/${encodeURIComponent(token)}/messages?page=${nextPage}&limit=${pagination.limit}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) return
      const payload = (await response.json()) as ApiResponse<ShareMessagesPage>
      if (!payload.success || !payload.data) return
      setMessages((prev) => [...prev, ...payload.data!.messages])
      setPagination(payload.data.pagination)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--background))] text-foreground">
      <header className={cn(SHARE_CONTAINER_CLASS, 'flex flex-col gap-3 border-b border-border/80 py-5 sm:flex-row sm:items-center sm:justify-between')}>
        <div className="flex items-center gap-3 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-xs font-bold text-primary-foreground">
            AI
          </span>
          {brandText} 分享
        </div>
        <div className="flex items-center gap-3 self-start text-xs text-muted-foreground sm:self-auto">
          <span className="rounded-md bg-[hsl(var(--surface-hover))] px-2.5 py-1">{share.messageCount} 条消息</span>
          <span>{formatRelativeTime(share.createdAt)}</span>
        </div>
      </header>

      <div className={cn(SHARE_CONTAINER_CLASS, 'flex-1 py-6 sm:py-8')}>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{share.title || share.sessionTitle}</h1>
        <section>
          {messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-muted-foreground">
              分享中暂无可展示的内容
            </div>
          ) : (
            messages.map((msg) => (
              <ShareMessageItem
                key={`${msg.id}-${msg.createdAt}`}
                msg={msg}
                sessionId={share.sessionId}
                defaultReasoningExpanded={false}
              />
            ))
          )}
        </section>
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.65] px-4 py-2 text-sm hover:bg-[hsl(var(--surface-hover))]"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      <footer className="border-t border-border/80 py-4">
        <div className={cn(SHARE_CONTAINER_CLASS, 'text-center text-xs text-muted-foreground')}>
          本页面分享由 <span className="font-medium text-foreground">{brandText}</span> 系统生成
        </div>
      </footer>
    </div>
  )
}
