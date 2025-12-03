'use client'

import { Check, ChevronLeft, ChevronRight, Copy, RefreshCw, Share2 } from 'lucide-react'
import Image from 'next/image'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  variantInfo?: {
    total: number
    index: number
    onPrev: () => void
    onNext: () => void
    onRegenerate: () => void
  }
  shareSelection?: {
    active: boolean
    selectable: boolean
    selected: boolean
    onToggle?: () => void
    onStart?: () => void
  }
}

function MessageBubbleComponent({ meta, body, renderCache, isStreaming, variantInfo, shareSelection }: MessageBubbleProps) {
  const [isCopied, setIsCopied] = useState(false)
  const reasoningRaw = body.reasoning || ''
  const reasoningText = reasoningRaw.trim()
  const currentUser = useAuthStore((state) => state.user)
  const { reasoningDefaultExpand, assistantAvatarUrl, assistantAvatarReady } = useSettingsStore((state) => ({
    reasoningDefaultExpand: Boolean(state.systemSettings?.reasoningDefaultExpand ?? false),
    assistantAvatarUrl: state.systemSettings?.assistantAvatarUrl ?? null,
    assistantAvatarReady: state.assistantAvatarReady,
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

  const describeTool = useCallback((tool?: string | null) => {
    if (!tool) return '工具调用'
    if (tool === 'web_search') return '联网搜索'
    if (tool === 'python_runner') return 'Python 工具'
    return tool
  }, [])

  const toolSummary = useMemo(() => {
    if (sortedToolTimeline.length === 0) {
      return null
    }
    let running = 0
    let success = 0
    let error = 0
    const toolCounts = new Map<string, number>()
    sortedToolTimeline.forEach((event) => {
      if (event.stage === 'result') {
        success += 1
      } else if (event.stage === 'error') {
        error += 1
      } else {
        running += 1
      }
      toolCounts.set(event.tool, (toolCounts.get(event.tool) || 0) + 1)
    })
    const parts: string[] = []
    if (success > 0) parts.push(`完成 ${success} 次`)
    if (running > 0) parts.push(`进行中 ${running} 次`)
    if (error > 0) parts.push(`失败 ${error} 次`)
    const labelParts = Array.from(toolCounts.entries()).map(
      ([tool, count]) => `${describeTool(tool)} ${count} 次`,
    )
    return {
      total: sortedToolTimeline.length,
      summaryText: parts.join(' · ') || '等待工具结果',
      label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
    }
  }, [describeTool, sortedToolTimeline])

  useEffect(() => {
    if (meta.role !== 'assistant') return
    if (reasoningManuallyToggled) return
    if (sortedToolTimeline.length === 0 || showReasoning) return
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[MessageBubble] auto-expand due to tool events', {
        stableKey: meta.stableKey,
        messageId: meta.id,
        toolEvents: sortedToolTimeline.length,
      })
    }
    setShowReasoning(true)
    setReasoningManuallyToggled(true)
  }, [meta.role, reasoningManuallyToggled, showReasoning, sortedToolTimeline.length, meta.id, meta.stableKey])

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
    if (reasoningManuallyToggled) return
    if (
      !hasReasoningState &&
      reasoningText.length === 0 &&
      sortedToolTimeline.length === 0
    ) {
      setReasoningManuallyToggled(false)
      setShowReasoning(false)
    }
  }, [hasReasoningState, reasoningText.length, sortedToolTimeline.length, reasoningManuallyToggled])

  useEffect(() => {
    if (meta.role === 'assistant' && (meta.reasoningStatus === 'idle' || meta.reasoningStatus === 'streaming') && !showReasoning && !reasoningManuallyToggled) {
      setShowReasoning(true)
    }
  }, [meta.reasoningStatus, meta.role, showReasoning, reasoningManuallyToggled])

  const mountStableKeyRef = useRef(meta.stableKey)
  const prevMessageIdRef = useRef(meta.id)
  const prevStableKeyRef = useRef(meta.stableKey)

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    console.debug('[MessageBubble] mount', {
      stableKey: mountStableKeyRef.current,
      messageId: prevMessageIdRef.current,
      streamStatus: meta.streamStatus,
    })
    return () => {
      console.debug('[MessageBubble] unmount', {
        stableKey: mountStableKeyRef.current,
        lastMessageId: prevMessageIdRef.current,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (prevStableKeyRef.current !== meta.stableKey) {
      console.debug('[MessageBubble] stableKey changed', {
        prevStableKey: prevStableKeyRef.current,
        nextStableKey: meta.stableKey,
        messageId: meta.id,
      })
      prevStableKeyRef.current = meta.stableKey
    }
  }, [meta.stableKey, meta.id])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (prevMessageIdRef.current !== meta.id) {
      console.debug('[MessageBubble] messageId changed', {
        stableKey: meta.stableKey,
        prevId: prevMessageIdRef.current,
        nextId: meta.id,
        streamStatus: meta.streamStatus,
      })
      prevMessageIdRef.current = meta.id
    }
  }, [meta.id, meta.streamStatus, meta.stableKey])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    console.debug('[MessageBubble] reasoning panel state', {
      stableKey: meta.stableKey,
      messageId: meta.id,
      showReasoning,
      reasoningManuallyToggled,
      defaultShouldShow,
      toolEvents: sortedToolTimeline.length,
      reasoningStatus: meta.reasoningStatus,
      streamStatus: meta.streamStatus,
    })
  }, [
    defaultShouldShow,
    meta.id,
    meta.reasoningStatus,
    meta.stableKey,
    meta.streamStatus,
    reasoningManuallyToggled,
    showReasoning,
    sortedToolTimeline.length,
  ])

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
  const assistantFallbackHidden = !isUser && assistantAvatarReady && Boolean(assistantAvatarUrl)
  const showVariantControls = Boolean(variantInfo)
  const showVariantNavigation = Boolean(variantInfo && variantInfo.total > 1)
  const shareableMessageId = typeof meta.id === 'number' ? meta.id : null
  const shareSelectionState = shareSelection ?? null
  const shareModeActive = Boolean(shareSelectionState?.active)
  const shareSelectable = Boolean(shareSelectionState?.selectable)
  const shareSelected = Boolean(shareSelectionState?.selected)
  const shareToggle = shareSelectionState?.onToggle
  const shareEntryHandler = shareSelectionState?.onStart
  const shareEntryAvailable =
    !shareModeActive &&
    Boolean(shareEntryHandler) &&
    shareableMessageId !== null &&
    !meta.pendingSync &&
    !isStreaming
  const selectionWrapperClass = shareModeActive
    ? `rounded-2xl border ${
        shareSelected
          ? 'border-primary/50 bg-primary/5'
          : shareSelectable
          ? 'border-dashed border-primary/40 bg-muted/40'
          : 'border-dashed border-border/60 bg-muted/30'
      } p-2 transition-colors`
    : ''

  return (
    <div className={`relative ${selectionWrapperClass}`}>
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-muted' : 'bg-muted'}`}>
          <AvatarImage src={avatarSrc} alt={isUser ? '用户头像' : 'AI 头像'} />
          <AvatarFallback
            className={`${isUser ? 'text-muted-foreground' : 'text-muted-foreground'} ${
              assistantFallbackHidden ? 'opacity-0' : ''
            }`}
            aria-hidden={assistantFallbackHidden ? 'true' : undefined}
          >
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
          <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title="复制消息"
            >
              {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
            </Button>
            {shareEntryAvailable && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="进入分享选择模式"
                onClick={() => shareEntryHandler?.()}
              >
                <Share2 className="h-3 w-3" />
              </Button>
            )}
            {showVariantControls && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="重新生成回答"
                onClick={() => variantInfo?.onRegenerate()}
                disabled={Boolean(isStreaming)}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
            {showVariantNavigation && (
              <div className="flex items-center gap-1 ml-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => variantInfo?.onPrev()}
                  title="查看更早的回答"
                  disabled={Boolean(isStreaming)}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="w-12 text-center">
                  {(variantInfo?.index ?? 0) + 1}/{variantInfo?.total ?? 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => variantInfo?.onNext()}
                  title="查看最新回答"
                  disabled={Boolean(isStreaming)}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
            <span className="ml-auto">{formatDate(meta.createdAt)}</span>
          </div>
        )}

        {!isUser && meta.pendingSync && (
          <div className="text-xs text-amber-600 mt-1">等待后端同步</div>
        )}

        {isUser && (
          <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title="复制消息"
            >
              {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
            </Button>
            {shareEntryAvailable && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="进入分享选择模式"
                onClick={() => shareEntryHandler?.()}
              >
                <Share2 className="h-3 w-3" />
              </Button>
            )}
            <span>{formatDate(meta.createdAt)}</span>
          </div>
        )}
        </div>
      </div>

      {shareModeActive && shareSelectable && shareToggle && (
        <button
          type="button"
          className={`absolute ${isUser ? 'right-3' : 'left-3'} top-3 h-6 w-6 rounded-full border ${
            shareSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/40 bg-background'
          } flex items-center justify-center shadow-sm transition-colors`}
          onClick={() => shareToggle()}
          aria-pressed={shareSelected}
          aria-label={shareSelected ? '取消选择此消息' : '选择此消息'}
        >
          {shareSelected ? <Check className="h-3 w-3" /> : null}
        </button>
      )}
      {shareModeActive && !shareSelectable && (
        <span
          className={`absolute ${isUser ? 'right-3' : 'left-3'} top-3 text-[11px] text-muted-foreground`}
        >
          待同步
        </span>
      )}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
