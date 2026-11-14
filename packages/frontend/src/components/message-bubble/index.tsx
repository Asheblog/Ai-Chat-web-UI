'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { MessageAvatar } from './message-avatar'
import { useToast } from '@/components/ui/use-toast'
import { copyToClipboard, formatDate } from '@/lib/utils'
import { formatFileSize } from '@/lib/format'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import { useChatStore } from '@/store/chat-store'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry, MessageStreamMetrics } from '@/types'
import { useSettingsStore } from '@/store/settings-store'
import { useAuthStore } from '@/store/auth-store'
import { ExpandEditorDialog } from '@/components/chat/expand-editor-dialog'
import { MessageBodyContent } from './message-body-content'
import { MessageHeader } from './message-header'
import { ShareBadge } from './share-badge'
import { normalizeMetricMs, normalizeMetricNumber } from './message-metrics'
import { useToolTimeline } from '@/features/chat/tool-events/useToolTimeline'
import { CotTimeline } from './cot-timeline'



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
  const assistantAvatarUrl = useSettingsStore(
    (state) => state.assistantAvatarUrl ?? state.systemSettings?.assistantAvatarUrl ?? null,
  )
  const [isCopied, setIsCopied] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [editApplying, setEditApplying] = useState(false)

  const reasoningRaw = body.reasoning || ''
  const artifacts = body.artifacts ?? meta.artifacts ?? []
  const reasoningPlayedLength =
    typeof body.reasoningPlayedLength === 'number'
      ? body.reasoningPlayedLength
      : reasoningRaw.length
  const isUser = meta.role === 'user'
  const content = body.content || ''
  const outsideText = content.replace(/```[\s\S]*?```/g, '').trim()
  const isCodeOnly = !isUser && content.includes('```') && outsideText === ''
  const hasContent = content.length > 0
  const shouldShowStreamingPlaceholder = Boolean(
    isStreaming && !hasContent && meta.role === 'assistant',
  )
  const { timeline: toolTimeline } = useToolTimeline({
    sessionId: meta.sessionId,
    messageId: meta.id,
    bodyEvents: body.toolEvents,
  })

  const cachedSource = renderCache?.sourceContent
  const cacheUsable = Boolean(renderCache && cachedSource !== undefined && renderCache.sourceStableKey === body.stableKey && renderCache.contentVersion <= body.version && content.startsWith(cachedSource) &&
    (renderCache.isStreaming || cachedSource === content))
  const strictCacheMatches = Boolean(cacheUsable && cachedSource === content && renderCache?.contentVersion === body.version && renderCache?.isStreaming === Boolean(isStreaming))
  const markdown = useMarkdownRender({
    identity: String(meta.sessionId) + ':' + String(meta.stableKey || meta.id),
    content, version: body.version, isStreaming: Boolean(isStreaming),
    enabled: !isUser && !strictCacheMatches,
    onRendered: (snapshot, result) => applyRenderedContent(meta.id, {
      ...result, reasoningVersion: body.reasoningVersion, isStreaming: snapshot.isStreaming,
      sourceContent: snapshot.content, sourceStableKey: body.stableKey,
    }),
  })
  const contentHtml = markdown.html ?? (cacheUsable ? renderCache?.contentHtml : null) ?? ''
  const isRendering = markdown.isRendering

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

  const bubbleClass = `max-w-full box-border ${
    isUser
      ? 'ml-auto w-fit rounded-2xl bg-muted/70 px-4 py-2.5 text-left text-foreground'
      : isCodeOnly
        ? 'w-full p-0 bg-transparent border-0 text-foreground'
        : 'w-full px-0 py-0.5 bg-transparent text-foreground'
  }`

  const avatarSrc = isUser ? currentUser?.avatarUrl ?? undefined : assistantAvatarUrl ?? undefined
  const avatarFallbackText = isUser
    ? currentUser?.username?.charAt(0).toUpperCase() || 'U'
    : 'A'
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

  const durationMs = normalizeMetricMs(metrics?.responseTimeMs)
  const speedValue = normalizeMetricNumber(metrics?.tokensPerSecond)
  const speedText =
    speedValue != null ? (speedValue >= 10 ? speedValue.toFixed(0) : speedValue.toFixed(1)) : null

  const shareBadgePosition = isUser ? 'right-3' : 'left-3'
  const canEdit = Boolean(isUser && canEditUserMessage && !shareModeActive && !isStreaming)
  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return '--'
    return formatFileSize(bytes)
  }

  return (
    <div className={`relative ${selectionWrapperClass}`}>
      <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <MessageAvatar
          src={avatarSrc}
          alt={isUser ? '用户头像' : 'AI 头像'}
          fallback={avatarFallbackText}
          className={`hidden h-7 w-7 flex-shrink-0 bg-muted sm:flex ${isUser ? '' : 'mt-1'}`}
        />

        <div
          className={`min-w-0 max-w-full flex-1 text-left ${
            isUser ? 'flex flex-col items-end' : ''
          }`}
        >
          {!isUser && (
            <MessageHeader
              isUser={isUser}
              mode="status"
              timestamp={formatDate(meta.createdAt)}
              isCopied={isCopied}
              onCopy={handleCopy}
              shareEntryAvailable={shareEntryAvailable}
              onShareStart={shareEntryHandler}
              showVariantControls={showVariantControls}
              showVariantNavigation={showVariantNavigation}
              variantInfo={variantInfo}
              isStreaming={Boolean(isStreaming)}
              metrics={{
                durationMs,
                speedText,
              }}
            />
          )}
          <CotTimeline
            meta={meta}
            reasoningRaw={reasoningRaw}
            toolEvents={toolTimeline}
            isStreaming={Boolean(isStreaming)}
            reasoningPlayedLength={reasoningPlayedLength}
          />

          <MessageBodyContent
            isUser={isUser}
            meta={meta}
            bubbleClass={bubbleClass}
            contentHtml={contentHtml}
            renderedSource={markdown.html != null ? markdown.source : cacheUsable ? cachedSource : undefined}
            content={content}
            shouldShowStreamingPlaceholder={shouldShowStreamingPlaceholder}
            isStreaming={Boolean(isStreaming)}
            isRendering={isRendering}
            renderErrored={markdown.errored}
          />

          {!isUser && artifacts.length > 0 && (
            <div className="mt-2 space-y-2">
              {artifacts.map((artifact) => {
                const expiresAt = artifact.expiresAt ? new Date(artifact.expiresAt) : null
                const expired =
                  Boolean(artifact.expired) ||
                  (expiresAt ? expiresAt.getTime() <= Date.now() : false)
                return (
                  <div
                    key={artifact.id}
                    className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{artifact.fileName}</div>
                      <div className="text-muted-foreground">
                        {formatBytes(artifact.sizeBytes)} ·
                        {expiresAt ? ` 过期于 ${formatDate(expiresAt.toISOString())}` : ' 无过期时间'}
                      </div>
                    </div>
                    {expired ? (
                      <span className="text-muted-foreground">已过期</span>
                    ) : (
                      <a
                        className="text-primary hover:underline whitespace-nowrap"
                        href={artifact.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        下载
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!isUser && (
            <MessageHeader
              isUser={isUser}
              mode="actions"
              timestamp={formatDate(meta.createdAt)}
              isCopied={isCopied}
              onCopy={handleCopy}
              shareEntryAvailable={shareEntryAvailable}
              onShareStart={shareEntryHandler}
              showVariantControls={showVariantControls}
              showVariantNavigation={showVariantNavigation}
              variantInfo={variantInfo}
              isStreaming={Boolean(isStreaming)}
            />
          )}

          {isUser && (
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
            />
          )}
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
