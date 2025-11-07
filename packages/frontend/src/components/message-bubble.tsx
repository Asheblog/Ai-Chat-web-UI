'use client'

import { Copy } from 'lucide-react'
import Image from 'next/image'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MarkdownRenderer } from './markdown-renderer'
import { formatDate, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { MessageBody, MessageMeta, MessageRenderCacheEntry } from '@/types'
import { requestMarkdownRender } from '@/lib/markdown-worker-client'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { TypewriterReasoning } from './typewriter-reasoning'

const messageKey = (id: number | string) => (typeof id === 'string' ? id : String(id))

const toReasoningMarkdown = (input: string) =>
  input
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd()
      if (trimmed.length === 0) return '>'
      return trimmed.startsWith('>') ? trimmed : `> ${trimmed}`
    })
    .join('\n')

interface MessageBubbleProps {
  meta: MessageMeta
  body: MessageBody
  renderCache?: MessageRenderCacheEntry
  isStreaming?: boolean
}

function MessageBubbleComponent({ meta, body, renderCache, isStreaming }: MessageBubbleProps) {
  const [isCopied, setIsCopied] = useState(false)
  const reasoningRaw = body.reasoning || ''
  const reasoningText = reasoningRaw.trim()
  const reasoningDefaultExpand = useSettingsStore(
    (state) => Boolean(state.systemSettings?.reasoningDefaultExpand ?? false),
  )
  const defaultShouldShow = useMemo(() => {
    if (meta.role !== 'assistant') return false
    if (typeof meta.reasoningStatus === 'string') {
      if (meta.reasoningStatus === 'done') {
        return reasoningDefaultExpand && reasoningText.length > 0
      }
      return true
    }
    if (reasoningText.length === 0) return false
    return reasoningDefaultExpand
  }, [meta.role, meta.reasoningStatus, reasoningDefaultExpand, reasoningText.length])
  const [showReasoning, setShowReasoning] = useState(defaultShouldShow)
  const [reasoningManuallyToggled, setReasoningManuallyToggled] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const applyRenderedContent = useChatStore((state) => state.applyRenderedContent)
  const streamingToolEvents = useChatStore(
    useCallback(
      (state) =>
        state.toolEvents.filter(
          (event) =>
            event.sessionId === meta.sessionId && messageKey(event.messageId) === messageKey(meta.id),
        ),
      [meta.id, meta.sessionId],
    ),
  )
  const historicalToolEvents = useMemo(() => {
    const list = Array.isArray(body.toolEvents) ? body.toolEvents : []
    return list
  }, [body.toolEvents])

  const sortedToolTimeline = useMemo(() => {
    const merged: Record<string, ToolEvent> = {}
    for (const evt of historicalToolEvents) {
      merged[evt.id] = evt
    }
    for (const evt of streamingToolEvents) {
      merged[evt.id] = evt
    }
    return Object.values(merged).sort((a, b) => a.createdAt - b.createdAt)
  }, [historicalToolEvents, streamingToolEvents])
  const [toolTimelineOpen, setToolTimelineOpen] = useState(false)
  const { toast } = useToast()

  const isUser = meta.role === 'user'
  const content = body.content || ''
  const outsideText = content.replace(/```[\s\S]*?```/g, '').trim()
  const isCodeOnly = !isUser && content.includes('```') && outsideText === ''
  const hasContent = content.length > 0
  const shouldShowStreamingPlaceholder = isStreaming && !hasContent && meta.role === 'assistant'
  const hasReasoningState = typeof meta.reasoningStatus === 'string'
  const shouldShowReasoningSection =
    !isUser &&
    (reasoningText.length > 0 ||
      (hasReasoningState && meta.reasoningStatus !== 'done') ||
      (isStreaming && meta.role === 'assistant' && hasReasoningState))

  const cacheMatches =
    renderCache &&
    renderCache.contentVersion === body.version &&
    renderCache.reasoningVersion === body.reasoningVersion
  const contentHtml = cacheMatches ? renderCache?.contentHtml ?? '' : ''
  const reasoningHtml =
    cacheMatches && renderCache?.reasoningHtml && reasoningText.length > 0
      ? renderCache.reasoningHtml
      : ''

  useEffect(() => {
    if (reasoningManuallyToggled) return
    setShowReasoning(defaultShouldShow)
  }, [defaultShouldShow, reasoningManuallyToggled])

  useEffect(() => {
    if (
      !hasReasoningState &&
      reasoningText.length === 0
    ) {
      setReasoningManuallyToggled(false)
      setShowReasoning(false)
    }
  }, [hasReasoningState, reasoningText.length])

  useEffect(() => {
    if (meta.role === 'assistant' && (meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming') && !showReasoning && !reasoningManuallyToggled) {
      setShowReasoning(true)
    }
  }, [meta.reasoningStatus, meta.role, showReasoning, reasoningManuallyToggled])

  useEffect(() => {
    if (isUser) return
    if (!body.content && !body.reasoning) return
    if (body.version === 0 && body.reasoningVersion === 0) return
    if (cacheMatches) return

    let cancelled = false
    const delay = isStreaming ? 160 : 40
    const timer = window.setTimeout(() => {
      setIsRendering(true)
      const reasoningMarkdown =
        body.reasoning && body.reasoning.trim().length > 0 ? toReasoningMarkdown(body.reasoning) : ''
      requestMarkdownRender({
        messageId: meta.id,
        content: body.content,
        reasoning: reasoningMarkdown,
        contentVersion: body.version,
        reasoningVersion: body.reasoningVersion,
      })
        .then((result) => {
          if (cancelled) return
          applyRenderedContent(meta.id, result)
        })
        .catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[MessageBubble] Markdown render failed', error)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsRendering(false)
          }
        })
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    applyRenderedContent,
    body.content,
    body.reasoning,
    body.reasoningVersion,
    body.version,
    cacheMatches,
    isStreaming,
    isUser,
    meta.id,
  ])

  const handleCopy = async () => {
    try {
      await copyToClipboard(content)
      setIsCopied(true)
      toast({
        title: '已复制',
        description: '消息内容已复制到剪贴板',
        duration: 2000,
      })
      setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      toast({
        title: '复制失败',
        description: '无法复制消息内容',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-muted' : 'bg-muted'}`}>
        <AvatarImage src={undefined} />
        <AvatarFallback className={isUser ? 'text-muted-foreground' : 'text-muted-foreground'}>
          {isUser ? 'U' : 'A'}
        </AvatarFallback>
      </Avatar>

      <div className={`flex-1 min-w-0 max-w-full lg:max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block max-w-full box-border rounded-lg ${
            isUser ? 'px-4 py-3' : isCodeOnly ? 'p-0' : 'px-4 py-3'
          } ${
            isUser
              ? 'bg-muted text-foreground ml-auto'
              : isCodeOnly
              ? 'bg-transparent border-0 text-foreground'
              : 'bg-background border text-foreground'
          }`}
        >
          {isUser ? (
            <div className="text-left">
              {meta.images && meta.images.length > 0 && (
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {meta.images.map((src, i) => (
                    <Image
                      key={i}
                      src={src}
                      alt={`消息图片 ${i + 1}`}
                      width={160}
                      height={160}
                      unoptimized
                      className="max-h-40 rounded border object-contain"
                    />
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap text-left">{content}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {shouldShowReasoningSection && (
                <div className="border rounded bg-background/60">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs text-muted-foreground flex items-center justify-between"
                    onClick={() => {
                      setReasoningManuallyToggled(true)
                      setShowReasoning((v) => !v)
                    }}
                    title="思维过程（可折叠）"
                  >
                    <span>
                      {meta.reasoningStatus === 'idle'
                        ? '思维过程 · 正在思考'
                        : meta.reasoningStatus === 'streaming'
                        ? '思维过程 · 输出中'
                        : meta.reasoningDurationSeconds && !isStreaming
                        ? `思维过程 · 用时 ${meta.reasoningDurationSeconds}s`
                        : '思维过程'}
                    </span>
                    <span className="ml-2">{showReasoning ? '▼' : '▶'}</span>
                  </button>
                  {showReasoning && (
                    <div className="px-3 pb-2 space-y-2 w-full break-words">
                      {meta.reasoningStatus === 'idle' && (
                        <div className="text-xs text-muted-foreground mb-1">
                          模型正在思考…
                          {typeof meta.reasoningIdleMs === 'number' && meta.reasoningIdleMs > 0
                            ? `（静默 ${Math.round(meta.reasoningIdleMs / 1000)}s）`
                            : null}
                        </div>
                      )}
                      {reasoningText ? (
                        reasoningHtml ? (
                          <div
                            className="markdown-body markdown-body--reasoning text-xs text-muted-foreground"
                            dangerouslySetInnerHTML={{ __html: reasoningHtml }}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            <TypewriterReasoning
                              text={reasoningRaw}
                              isStreaming={meta.reasoningStatus === 'streaming'}
                              speed={20}
                            />
                          </div>
                        )
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {meta.reasoningStatus === 'streaming' ? '推理内容接收中…' : '正在思考中…'}
                        </div>
                      )}
                      {sortedToolTimeline.length > 0 && (
                        <div className="mt-3 border border-dashed border-muted-foreground/50 rounded-lg bg-muted/30">
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between font-medium"
                            onClick={() => setToolTimelineOpen((prev) => !prev)}
                          >
                            <span>
                              联网搜索（{sortedToolTimeline.length} 次）
                              {toolTimelineOpen ? '' : ' · 点击展开'}
                            </span>
                            <span>{toolTimelineOpen ? '▲' : '▼'}</span>
                          </button>
                          {toolTimelineOpen && (
                            <div className="px-3 pb-3 space-y-2 text-[11px]">
                              {sortedToolTimeline.map((event) => {
                                const statusLabel =
                                  event.stage === 'start'
                                    ? '检索中'
                                    : event.stage === 'result'
                                      ? `${event.hits?.length ?? 0} 条结果`
                                      : event.error || '搜索失败'
                                const statusClass =
                                  event.stage === 'start'
                                    ? 'text-amber-600'
                                    : event.stage === 'result'
                                      ? 'text-emerald-600'
                                      : 'text-destructive'
                                return (
                                  <div key={event.id} className="rounded-md border border-muted-foreground/40 bg-background px-2 py-2">
                                    <div className="flex items-center justify-between gap-2 font-semibold text-muted-foreground">
                                      <span>{event.query || '未提供查询'}</span>
                                      <span className={statusClass}>{statusLabel}</span>
                                    </div>
                                    {event.hits && event.hits.length > 0 && (
                                      <ul className="mt-2 space-y-1">
                                        {event.hits.slice(0, 3).map((hit, idx) => (
                                          <li key={`${event.id}-${idx}`}>
                                            <a
                                              href={hit.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-primary hover:underline"
                                            >
                                              {hit.title || hit.url}
                                            </a>
                                            {hit.snippet && (
                                              <p className="text-muted-foreground">{hit.snippet}</p>
                                            )}
                                          </li>
                                        ))}
                                        {event.hits.length > 3 && (
                                          <li className="text-muted-foreground">……</li>
                                        )}
                                      </ul>
                                    )}
                                    {event.error && (
                                      <p className="mt-2 text-destructive">{event.error}</p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {shouldShowStreamingPlaceholder ? (
                <div className="flex items-center gap-1">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-muted-foreground ml-2">AI正在思考...</span>
                </div>
              ) : (
                <MarkdownRenderer
                  html={contentHtml}
                  fallback={content}
                  isStreaming={isStreaming}
                  isRendering={isRendering}
                />
              )}
            </div>
          )}
        </div>

        {!isUser && (
          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title="复制消息"
            >
              {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
            </Button>
            <span className="ml-2">{formatDate(meta.createdAt)}</span>
          </div>
        )}

        {isUser && (
          <div className="text-xs text-muted-foreground mt-2">
            {formatDate(meta.createdAt)}
          </div>
        )}
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
