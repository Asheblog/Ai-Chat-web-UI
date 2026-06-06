'use client'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import type { ApiResponse, ChatShare, MessageMeta, RichMessagePayload, ShareMessage, ShareMessagesPage, ToolEvent } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { ReasoningSection } from '@/components/message-bubble/reasoning-section'
import { ToolCallsSection } from '@/components/message-bubble/tool-calls-section'
import { RichMessageRenderer } from '@/components/message-content/rich-message-renderer'
import { cn, formatDate } from '@/lib/utils'
import { User, Bot, Copy, Loader2 } from 'lucide-react'

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

const SHARE_CONTAINER_CLASS = 'mx-auto w-full max-w-[1280px] px-3 sm:px-5 lg:px-6'

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
  const searchEngines = new Set<string>()
  const searchQueries = new Set<string>()
  let readTaskCount = 0

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

    const taskType = typeof event.details?.taskType === 'string' ? event.details.taskType : null
    if (taskType === 'search') {
      if (typeof event.details?.engine === 'string' && event.details.engine.trim()) {
        searchEngines.add(event.details.engine.trim())
      }
      const queryCandidate =
        typeof event.details?.expandedQuery === 'string'
          ? event.details.expandedQuery
          : typeof event.query === 'string'
            ? event.query
            : ''
      if (queryCandidate.trim()) {
        searchQueries.add(queryCandidate.trim())
      }
    } else if (taskType === 'read_url') {
      readTaskCount += 1
    }
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
  if (searchEngines.size > 0 || searchQueries.size > 0) {
    parts.push(`并行搜索 ${searchEngines.size} 引擎/${searchQueries.size} 查询`)
  }
  if (readTaskCount > 0) {
    parts.push(`自动读取 ${readTaskCount} 次`)
  }

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
    searchEngineCount: searchEngines.size,
    searchQueryCount: searchQueries.size,
    readTaskCount,
  }
}

function mergeRichPayloadText(
  richPayload: RichMessagePayload | null | undefined,
  content: string,
): RichMessagePayload | null | undefined {
  if (!richPayload || !Array.isArray(richPayload.parts)) return richPayload

  let hasTextPart = false
  const parts = richPayload.parts.map((part) => {
    if (part.type !== 'text') return part
    hasTextPart = true
    return { ...part, text: content, format: part.format ?? 'markdown' }
  })

  if (!hasTextPart && content.trim().length > 0) {
    const hasImages = parts.some((part) => part.type === 'image')
    return {
      ...richPayload,
      layout: hasImages ? 'side-by-side' : 'auto',
      parts: [{ type: 'text', text: content, format: 'markdown' }, ...parts],
    }
  }

  return { ...richPayload, parts }
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
  const richPayload =
    !isUser && msg.richPayload && Array.isArray(msg.richPayload.parts) && msg.richPayload.parts.length > 0
      ? msg.richPayload
      : null

  return (
    <article className={cn('flex gap-3 border-b border-border py-5 last:border-b-0', isUser && 'flex-row-reverse')}>
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
              'ml-auto inline-block rounded-[10px] border border-primary/15 bg-primary/10 px-4 py-2.5'
          )}
        >
          {richPayload ? (
            <RichMessageRenderer payload={richPayload} />
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownRenderer html={null} fallback={msg.content} />
            </div>
          )}
        </div>

        {!richPayload && msg.images && msg.images.length > 0 && (
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
  const [liveDeltas, setLiveDeltas] = useState<Map<number, { content: string; reasoning: string }>>(new Map())
  const [liveToolEvents, setLiveToolEvents] = useState<Map<number, ToolEvent[]>>(new Map())
  const [isLive, setIsLive] = useState(share.isLive ?? false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mountedRef = useRef(true)
  const hasMore = pagination.page < pagination.totalPages

  const fetchFinalMessages = useCallback(async () => {
    if (!token) return
    try {
      const response = await fetch(`/api/shares/${encodeURIComponent(token)}/messages?page=1&limit=${Math.max(pagination.limit, initialMessages.length)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok || !mountedRef.current) return
      const payload = (await response.json()) as ApiResponse<ShareMessagesPage>
      if (!payload?.success || !payload.data) return
      setMessages(payload.data.messages)
      setPagination(payload.data.pagination)
      setLiveDeltas(new Map())
      setLiveToolEvents(new Map())
    } catch {}
  }, [token, pagination.limit, initialMessages.length])

  const fetchFinalMessagesRef = useRef(fetchFinalMessages)
  fetchFinalMessagesRef.current = fetchFinalMessages

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!isLive || !token) return

    const streamUrl = `/api/shares/${encodeURIComponent(token)}/stream`
    const source = new EventSource(streamUrl)
    eventSourceRef.current = source

    source.onmessage = (event) => {
      if (!event?.data || event.data === '[DONE]') return
      let eventPayload: any = null
      try { eventPayload = JSON.parse(event.data) } catch { return }
      if (!eventPayload || !mountedRef.current) return

      const msgId = typeof eventPayload.messageId === 'number' ? eventPayload.messageId : null

      switch (eventPayload.type) {
        case 'content_delta':
          if (typeof eventPayload.delta !== 'string' || !msgId) return
          setLiveDeltas((prev) => {
            const next = new Map(prev)
            const cur = next.get(msgId) || { content: '', reasoning: '' }
            next.set(msgId, { ...cur, content: cur.content + eventPayload.delta })
            return next
          })
          break
        case 'reasoning_delta':
          if (typeof eventPayload.delta !== 'string' || !msgId) return
          setLiveDeltas((prev) => {
            const next = new Map(prev)
            const cur = next.get(msgId) || { content: '', reasoning: '' }
            next.set(msgId, { ...cur, reasoning: cur.reasoning + eventPayload.delta })
            return next
          })
          break
        case 'tool_call':
          if (!msgId) return
          setLiveToolEvents((prev) => {
            const next = new Map(prev)
            const current = next.get(msgId) || []
            next.set(msgId, [...current, eventPayload.toolEvent as ToolEvent])
            return next
          })
          break
        case 'message_complete':
          break
        case 'share_complete':
          setIsLive(false)
          fetchFinalMessagesRef.current()
          source.close()
          break
        case 'stream_error':
          setIsLive(false)
          fetchFinalMessagesRef.current()
          source.close()
          break
        default:
          break
      }
    }

    source.onerror = () => {
      source.close()
      eventSourceRef.current = null
      setIsLive(false)
      fetchFinalMessagesRef.current()
    }

    return () => {
      source.close()
      eventSourceRef.current = null
    }
  }, [isLive, token])

  const mergedMessages = useMemo(() => {
    if (liveDeltas.size === 0 && liveToolEvents.size === 0) return messages
    return messages.map((msg) => {
      const deltas = liveDeltas.get(msg.id)
      const tools = liveToolEvents.get(msg.id)
      if (!deltas && !tools) return msg
      const content = deltas ? msg.content + deltas.content : msg.content
      return {
        ...msg,
        content,
        reasoning: deltas ? (msg.reasoning || '') + deltas.reasoning : msg.reasoning,
        toolEvents: tools ? [...(msg.toolEvents || []), ...tools] : msg.toolEvents,
        richPayload: deltas ? mergeRichPayloadText(msg.richPayload, content) : msg.richPayload,
      }
    })
  }, [messages, liveDeltas, liveToolEvents])

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
    <div className="v2-app-surface flex min-h-screen flex-col text-foreground">
      <header className={cn(SHARE_CONTAINER_CLASS, 'pt-4')}>
        <div className="v2-panel flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3 font-semibold">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-xs font-bold text-primary-foreground">
              AI
            </span>
            <span className="truncate">{brandText}</span>
            {isLive && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                实时
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start text-xs text-muted-foreground sm:self-auto">
            <span className="rounded-md bg-[hsl(var(--surface-hover))] px-2.5 py-1">{share.messageCount} 条消息</span>
            <span>{formatRelativeTime(share.createdAt)}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-[8px] border border-primary/30 bg-background px-3 py-1.5 text-primary transition hover:bg-accent"
              onClick={() => {
                if (typeof window === 'undefined') return
                void navigator.clipboard?.writeText(window.location.href)
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制分享链接
            </button>
          </div>
        </div>
      </header>

      <div className={cn(SHARE_CONTAINER_CLASS, 'flex-1 py-2 sm:py-3')}>
        <section className="v2-panel p-4 sm:p-6">
          <div className="mb-6 text-center">
            <h1 className="mx-auto max-w-5xl text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              {share.title || share.sessionTitle}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">公开分享 · {formatDate(share.createdAt)}</p>
          </div>
          {mergedMessages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-muted-foreground">
              分享中暂无可展示的内容
            </div>
          ) : (
            mergedMessages.map((msg) => (
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
