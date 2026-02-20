'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/use-toast'
import { copyToClipboard, formatDate } from '@/lib/utils'
import { requestMarkdownRender } from '@/lib/markdown-worker-client'
import { useChatStore } from '@/store/chat-store'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry, MessageStreamMetrics } from '@/types'
import { useSettingsStore } from '@/store/settings-store'
import { useAuthStore } from '@/store/auth-store'
import { useToolTimeline } from '@/features/chat/tool-events/useToolTimeline'
import { ExpandEditorDialog } from '@/components/chat/expand-editor-dialog'
import { ReasoningSection } from './reasoning-section'
import { MessageBodyContent } from './message-body-content'
import { MessageHeader } from './message-header'
import { ShareBadge } from './share-badge'

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
  metrics?: MessageStreamMetrics | null
  canEditUserMessage?: boolean
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

function MessageBubbleComponent({
  meta,
  body,
  renderCache,
  isStreaming,
  metrics,
  canEditUserMessage,
  variantInfo,
  shareSelection,
}: MessageBubbleProps) {
  const { toast } = useToast()
  const applyRenderedContent = useChatStore((state) => state.applyRenderedContent)
  const editLastUserMessage = useChatStore((state) => state.editLastUserMessage)
  const currentUser = useAuthStore((state) => state.user)
  const { reasoningDefaultExpand, assistantAvatarUrl, assistantAvatarReady } = useSettingsStore((state) => ({
    reasoningDefaultExpand: Boolean(state.systemSettings?.reasoningDefaultExpand ?? false),
    assistantAvatarUrl: state.systemSettings?.assistantAvatarUrl ?? null,
    assistantAvatarReady: state.assistantAvatarReady,
  }))
  const [isCopied, setIsCopied] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [editApplying, setEditApplying] = useState(false)
  const reasoningRaw = body.reasoning || ''
  const reasoningPlayedLength =
    typeof body.reasoningPlayedLength === 'number'
      ? body.reasoningPlayedLength
      : reasoningRaw.length
  const reasoningText = reasoningRaw.trim()
  const isUser = meta.role === 'user'
  const content = body.content || ''
  const outsideText = content.replace(/```[\s\S]*?```/g, '').trim()
  const isCodeOnly = !isUser && content.includes('```') && outsideText === ''
  const hasContent = content.length > 0
  const hasReasoningState = typeof meta.reasoningStatus === 'string'
  const shouldShowReasoningSection =
    !isUser &&
    (reasoningText.length > 0 ||
      (hasReasoningState && meta.reasoningStatus !== 'done') ||
      (isStreaming && meta.role === 'assistant' && hasReasoningState))
  const shouldShowStreamingPlaceholder = Boolean(
    isStreaming && !hasContent && meta.role === 'assistant',
  )
  const { timeline: toolTimeline, summary: toolSummary } = useToolTimeline({
    sessionId: meta.sessionId,
    messageId: meta.id,
    bodyEvents: body.toolEvents,
  })

  // 缓存匹配逻辑：
  // 1. 严格匹配：版本完全相同
  // 2. 宽松匹配：缓存版本与当前版本差距不超过3，且有有效HTML内容（仅用于“先展示”，避免白屏/闪烁）
  // 注意：宽松匹配不应阻止后续重新渲染，否则可能长期卡在不完整的 HTML（例如代码块围栏跨 chunk 时）
  const strictCacheMatches =
    renderCache &&
    renderCache.contentVersion === body.version &&
    renderCache.reasoningVersion === body.reasoningVersion
  const looseCacheMatches =
    renderCache &&
    renderCache.contentHtml &&
    renderCache.contentHtml.length > 0 &&
    body.version - renderCache.contentVersion <= 3 &&
    body.reasoningVersion - renderCache.reasoningVersion <= 3
  const cacheUsableForDisplay = strictCacheMatches || (!isStreaming && looseCacheMatches)
  const contentHtml = cacheUsableForDisplay ? renderCache.contentHtml ?? '' : ''
  const reasoningHtml =
    cacheUsableForDisplay && renderCache?.reasoningHtml ? renderCache.reasoningHtml : ''

  const handleCopy = useCallback(async () => {
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
  }, [content, toast])

  useEffect(() => {
    if (isUser) return
    const hasReasoning = Boolean(body.reasoning && body.reasoning.trim().length > 0)
    if (!hasContent && !hasReasoning) return
    if (!hasContent && body.reasoningVersion === 0) return
    // 严格命中才跳过；宽松命中仅用于先展示，仍应触发一次 Worker 重新渲染以保证结构完整
    if (strictCacheMatches) return
    // 流式传输期间跳过 Worker 渲染，因为内容在不断变化
    // 使用 ReactMarkdown fallback 进行实时渲染，流式结束后再用 Worker 渲染
    if (isStreaming) return

    let cancelled = false
    const delay = 40
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
    strictCacheMatches,
    hasContent,
    isStreaming,
    isUser,
    meta.id,
  ])

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
  const avatarHasImage = Boolean(avatarSrc)
  const avatarFallbackText = isUser
    ? currentUser?.username?.charAt(0).toUpperCase() || 'U'
    : 'A'
  const assistantFallbackHidden = !isUser && assistantAvatarReady && Boolean(assistantAvatarUrl)
  const showVariantControls = Boolean(variantInfo)
  const showVariantNavigation = Boolean(variantInfo && variantInfo.total > 1)
  const shareableMessageId = typeof meta.id === 'number' ? meta.id : null
  const shareState = shareSelection ?? null
  const shareModeActive = Boolean(shareState?.active)
  const shareSelectable = Boolean(shareState?.selectable)
  const shareSelected = Boolean(shareState?.selected)
  const shareToggle = shareState?.onToggle
  const shareEntryHandler = shareState?.onStart
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

  const defaultShouldShowReasoning = useMemo(() => {
    if (meta.role !== 'assistant') return false
    if (typeof meta.reasoningStatus === 'string') {
      if (meta.reasoningStatus === 'done') {
        return reasoningDefaultExpand && reasoningText.length > 0
      }
      return true
    }
    if (reasoningText.length === 0) return false
    return reasoningDefaultExpand
  }, [meta.reasoningStatus, meta.role, reasoningDefaultExpand, reasoningText])

  const normalizeLatency = (value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.max(0, Math.round(value))
  }
  const normalizeSpeed = (value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return value
  }
  const latencyText = normalizeLatency(metrics?.firstTokenLatencyMs)
  const speedValue = normalizeSpeed(metrics?.tokensPerSecond)
  const speedText =
    speedValue != null ? (speedValue >= 10 ? speedValue.toFixed(0) : speedValue.toFixed(1)) : null

  const shareBadgePosition = isUser ? 'right-3' : 'left-3'
  const canEdit = Boolean(isUser && canEditUserMessage && !shareModeActive && !isStreaming)

  return (
    <div className={`relative ${selectionWrapperClass}`}>
      <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-muted' : 'bg-muted mt-1.5'}`}>
          <AvatarImage src={avatarSrc} alt={isUser ? '用户头像' : 'AI 头像'} />
          <AvatarFallback
            delayMs={avatarHasImage ? 180 : 0}
            className={`${isUser ? 'text-muted-foreground' : 'text-muted-foreground'} ${
              assistantFallbackHidden ? 'opacity-0' : ''
            }`}
            aria-hidden={assistantFallbackHidden ? 'true' : undefined}
          >
            {avatarFallbackText}
          </AvatarFallback>
        </Avatar>

        <div className={`flex-1 min-w-0 max-w-full lg:max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
          {!isUser && shouldShowReasoningSection && (
            <ReasoningSection
              meta={meta}
              reasoningRaw={reasoningRaw}
              reasoningHtml={reasoningHtml || undefined}
              reasoningPlayedLength={reasoningPlayedLength}
              timeline={toolTimeline}
              summary={toolSummary}
              defaultExpanded={defaultShouldShowReasoning}
            />
          )}

          <MessageBodyContent
            isUser={isUser}
            meta={meta}
            bubbleClass={bubbleClass}
            contentHtml={contentHtml}
            content={content}
            shouldShowStreamingPlaceholder={shouldShowStreamingPlaceholder}
            isStreaming={Boolean(isStreaming)}
            isRendering={isRendering}
          />

          <MessageHeader
            isUser={isUser}
            timestamp={formatDate(meta.createdAt)}
            isCopied={isCopied}
            onCopy={handleCopy}
            onEdit={
              canEdit
                ? () => {
                    setEditDraft(content)
                    setEditOpen(true)
                  }
                : undefined
            }
            shareEntryAvailable={shareEntryAvailable}
            onShareStart={shareEntryHandler}
            showVariantControls={showVariantControls}
            showVariantNavigation={showVariantNavigation}
            variantInfo={variantInfo}
            isStreaming={Boolean(isStreaming)}
            metrics={
              !isUser
                ? {
                    latencyText,
                    speedText,
                  }
                : undefined
            }
          />
          {!isUser && meta.pendingSync && (
            <div className="text-xs text-amber-600 mt-1">等待后端同步</div>
          )}
        </div>
      </div>

      <ShareBadge
        positionClass={shareBadgePosition}
        shareModeActive={shareModeActive}
        shareSelectable={shareSelectable}
        shareSelected={shareSelected}
        onToggle={shareToggle}
      />

      {canEdit && (
        <ExpandEditorDialog
          open={editOpen}
          draft={editDraft}
          onDraftChange={setEditDraft}
          onClose={() => {
            if (editApplying) return
            setEditOpen(false)
          }}
          onApply={async () => {
            if (editApplying) return
            setEditApplying(true)
            try {
              const ok = await editLastUserMessage(meta.sessionId, meta.id, editDraft)
              if (ok) {
                setEditOpen(false)
              }
            } finally {
              setEditApplying(false)
            }
          }}
        />
      )}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
