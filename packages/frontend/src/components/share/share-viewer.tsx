'use client'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import type { ApiResponse, ChatShare, MessageMeta, RichMessagePayload, ShareMessage, ShareMessagesPage, ToolEvent } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { CotTimeline } from '@/components/message-bubble/cot-timeline'
import { RichMessageRenderer } from '@/components/message-content/rich-message-renderer'
import { cn, formatDate } from '@/lib/utils'
import { mergeAndSortToolEvents } from '@aichat/shared/tool-events'
import { User, Bot } from 'lucide-react'
import { SharePageHeader, SharePageFooter, SHARE_CONTAINER_CLASS } from './share-page-chrome'

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
  const reasoningRaw = msg.reasoning || ''
  const toolEvents = (msg as { toolEvents?: ToolEvent[] }).toolEvents
  const normalizedToolEvents = useMemo(() => {
    if (!toolEvents || toolEvents.length === 0) return []
    return mergeAndSortToolEvents(toolEvents)
  }, [toolEvents])
  const hasProcess = Boolean(reasoningRaw.trim()) || normalizedToolEvents.length > 0 || Boolean(msg.artifacts?.length) || msg.finalAnswerGenerated === false || Boolean(msg.stopReason)
  const meta = useMemo<MessageMeta>(() => ({
    id: msg.id,
    sessionId,
    stableKey: `share-${msg.id}-${msg.createdAt}`,
    role: msg.role,
    createdAt: msg.createdAt,
    reasoningStatus: reasoningRaw.trim() ? 'done' : undefined,
    reasoningDurationSeconds: null,
    reasoningIdleMs: null,
    reasoningUnavailableCode: null,
    reasoningUnavailableReason: null,
    reasoningUnavailableSuggestion: null,
  }), [msg.createdAt, msg.id, msg.role, msg.reasoning, sessionId])

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
            : 'bg-foreground text-background'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', isUser ? 'justify-end' : 'justify-start')}>
          <span className="font-medium uppercase tracking-[0.08em] text-muted-foreground">{isUser ? '用户' : 'AI 助手'}</span>
          <span className="text-muted-foreground/80">{formatDate(msg.createdAt)}</span>
        </div>

        <div
          className={cn(
            'max-w-none break-words text-sm leading-7 [overflow-wrap:anywhere]',
            isUser &&
              'ml-auto w-fit rounded-lg bg-surface-subtle px-4 py-2.5 text-left'
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

        {!isUser && hasProcess && (
          <CotTimeline meta={meta} reasoningRaw={reasoningRaw} toolEvents={normalizedToolEvents}
            defaultExpanded={defaultReasoningExpanded} content={msg.content} artifacts={msg.artifacts}
            coverage={msg.toolLogCoverage} readOnly
            runTerminal={{ stopReason: msg.stopReason ?? undefined, finalAnswerGenerated: msg.finalAnswerGenerated ?? undefined }} />
        )}

        {!richPayload && msg.images && msg.images.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {msg.images.map((src, index) => (
              <img
                key={`${src}-${index}`}
                src={src}
                alt="分享图片"
                className="max-h-48 w-full rounded-lg border border-border bg-[hsl(var(--surface))] object-contain"
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
  const [loadError, setLoadError] = useState(false)
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
    setLoadError(false)
    try {
      const nextPage = pagination.page + 1
      const response = await fetch(`/api/shares/${encodeURIComponent(token)}/messages?page=${nextPage}&limit=${pagination.limit}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('share-pagination')
      const payload = (await response.json()) as ApiResponse<ShareMessagesPage>
      if (!payload.success || !payload.data) throw new Error('share-pagination')
      setMessages((prev) => [...prev, ...payload.data!.messages])
      setPagination(payload.data.pagination)
    } catch {
      setLoadError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="v2-app-surface flex min-h-dvh flex-col text-foreground">
      <SharePageHeader brandText={brandText} isLive={isLive} />

      <div className={cn(SHARE_CONTAINER_CLASS, 'flex-1 py-2 sm:py-3')}>
        <section className="py-4 sm:py-6">
          <div className="mb-7 space-y-3 text-left">
            <h1 className="break-words text-2xl font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-[30px]">
              {share.title || share.sessionTitle}
            </h1>
            <p className="text-xs leading-relaxed text-muted-foreground">公开分享 · {formatDate(share.createdAt)} · {share.messageCount} 条消息</p>
          </div>
          {mergedMessages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
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
          <div className="mt-6 flex flex-col items-center gap-3">
            {loadError && <p role="alert" className="text-sm text-destructive">消息加载失败，请重试</p>}
            <button
              type="button"
              className="min-h-11 rounded-md border border-border bg-surface px-4 py-2 text-sm transition-colors hover:bg-surface-hover disabled:cursor-wait disabled:text-muted-foreground"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中...' : loadError ? '重试加载' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      <SharePageFooter brandText={brandText} />
    </div>
  )
}
