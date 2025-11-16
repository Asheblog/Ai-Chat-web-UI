'use client'

import { Copy } from 'lucide-react'
import Image from 'next/image'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MarkdownRenderer } from './markdown-renderer'
import { formatDate, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { MessageBody, MessageMeta, MessageRenderCacheEntry, ToolEvent } from '@/types'
import { requestMarkdownRender } from '@/lib/markdown-worker-client'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useAuthStore } from '@/store/auth-store'
import { ReasoningPanel } from './reasoning-panel'

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
  const currentUser = useAuthStore((state) => state.user)
  const { reasoningDefaultExpand, assistantAvatarUrl } = useSettingsStore((state) => ({
    reasoningDefaultExpand: Boolean(state.systemSettings?.reasoningDefaultExpand ?? false),
    assistantAvatarUrl: state.systemSettings?.assistantAvatarUrl ?? null,
  }))
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

  const toolSummary = useMemo(() => {
    if (sortedToolTimeline.length === 0) {
      return null
    }
    let running = 0
    let success = 0
    let error = 0
    sortedToolTimeline.forEach((event) => {
      if (event.stage === 'result') {
        success += 1
      } else if (event.stage === 'error') {
        error += 1
      } else {
        running += 1
      }
    })
    const parts: string[] = []
    if (success > 0) parts.push(`完成 ${success} 次`)
    if (running > 0) parts.push(`进行中 ${running} 次`)
    if (error > 0) parts.push(`失败 ${error} 次`)
    return {
      total: sortedToolTimeline.length,
      summaryText: parts.join(' · ') || '等待搜索结果',
    }
  }, [sortedToolTimeline])

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
  const reasoningHtml = cacheMatches && renderCache?.reasoningHtml ? renderCache.reasoningHtml : ''

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
    const hasContent = Boolean(body.content)
    const hasReasoning = Boolean(body.reasoning && body.reasoning.trim().length > 0)
    if (!hasContent && !hasReasoning) return
    if (!hasContent && body.reasoningVersion === 0) return
    if (cacheMatches) return

    let cancelled = false
    const delay = isStreaming ? 160 : 40
    const timer = window.setTimeout(() => {
      setIsRendering(true)
      const reasoningMarkdown = hasReasoning ? toReasoningMarkdown(body.reasoning!) : ''
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

  const bubbleClass = `inline-block max-w-full box-border rounded-lg ${
    isUser ? 'px-4 py-3' : isCodeOnly ? 'p-0' : 'px-4 py-3'
  } ${
    isUser
      ? 'bg-muted text-foreground ml-auto'
      : isCodeOnly
      ? 'bg-transparent border-0 text-foreground'
      : 'bg-background text-foreground'
  }`

  const avatarSrc = isUser ? currentUser?.avatarUrl ?? undefined : assistantAvatarUrl ?? undefined
  const avatarFallbackText = isUser
    ? currentUser?.username?.charAt(0).toUpperCase() || 'U'
    : 'A'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-muted' : 'bg-muted'}`}>
        <AvatarImage src={avatarSrc} alt={isUser ? '用户头像' : 'AI 头像'} />
        <AvatarFallback className={isUser ? 'text-muted-foreground' : 'text-muted-foreground'}>
          {avatarFallbackText}
        </AvatarFallback>
      </Avatar>

      <div className={`flex-1 min-w-0 max-w-full lg:max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        {isUser ? (
          <div className={bubbleClass}>
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
              <p className="whitespace-pre-wrap break-words text-left leading-[1.5] sm:leading-[1.6]">
                {content}
              </p>
            </div>
          </div>
        ) : (
          <>
            {shouldShowReasoningSection && (
              <div className="mb-3">
                <ReasoningPanel
                  status={meta.reasoningStatus}
                  durationSeconds={meta.reasoningDurationSeconds}
                  idleMs={meta.reasoningIdleMs}
                  expanded={showReasoning}
                  onToggle={() => {
                    setReasoningManuallyToggled(true)
                    setShowReasoning((v) => !v)
                  }}
                  reasoningRaw={reasoningRaw}
                  reasoningHtml={reasoningHtml || undefined}
                  isStreaming={meta.reasoningStatus === 'streaming'}
                  toolSummary={toolSummary}
                  toolTimeline={sortedToolTimeline}
                />
              </div>
            )}
            <div className={bubbleClass}>
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
          </>
        )}

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
