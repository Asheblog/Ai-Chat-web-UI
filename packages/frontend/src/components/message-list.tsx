import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBody, MessageMeta, MessageRenderCacheEntry, MessageStreamMetrics } from '@/types'
import { MessageBubble } from './message-bubble'
import { CompressedGroupCard } from './compressed-group-card'
import { TypingIndicator } from './typing-indicator'
import { useChatMessages } from '@/store/chat-store'

const messageKey = (id: number | string) => (typeof id === 'string' ? id : String(id))

const parseTimestamp = (value: string | number | Date | undefined) => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const compareVariants = (a: MessageMeta, b: MessageMeta) => {
  const aIndex = typeof a.variantIndex === 'number' ? a.variantIndex : null
  const bIndex = typeof b.variantIndex === 'number' ? b.variantIndex : null
  if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
    return aIndex - bIndex
  }
  const aTime = parseTimestamp(a.createdAt)
  const bTime = parseTimestamp(b.createdAt)
  if (aTime !== bTime) return aTime - bTime
  return messageKey(a.id).localeCompare(messageKey(b.id))
}

interface MessageListProps {
  metas: MessageMeta[]
  bodies: Record<string, MessageBody>
  renderCache: Record<string, MessageRenderCacheEntry>
  isStreaming: boolean
  isLoading?: boolean
  autoScrollEnabled?: boolean
  scrollRootRef?: RefObject<HTMLElement | null>
  variantSelections?: Record<string, number | string>
  metrics?: Record<string, MessageStreamMetrics>
  shareSelection?: {
    enabled: boolean
    sessionId: number | null
    selectedMessageIds: number[]
  }
  onShareToggle?: (messageId: number) => void
  onShareStart?: (messageId: number) => void
}

interface VirtualizerResizeItem {
  index: number
  start: number
}

interface VirtualizerResizeInstance {
  getScrollOffset: () => number
}

function MessageListComponent({
  metas,
  bodies,
  renderCache,
  isStreaming,
  isLoading,
  autoScrollEnabled = true,
  scrollRootRef,
  variantSelections,
  metrics,
  shareSelection,
  onShareToggle,
  onShareStart,
}: MessageListProps) {
  const { regenerateAssistantMessage, cycleAssistantVariant } = useChatMessages((state) => ({
    regenerateAssistantMessage: state.regenerateAssistantMessage,
    cycleAssistantVariant: state.cycleAssistantVariant,
  }))
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const root = scrollRootRef?.current
    if (root) {
      const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
      if (viewport && viewport !== scrollElement) {
        setScrollElement(viewport)
      }
    } else if (containerRef.current) {
      const viewport = containerRef.current.closest(
        '[data-radix-scroll-area-viewport]'
      ) as HTMLElement | null
      if (viewport && viewport !== scrollElement) {
        setScrollElement(viewport)
      }
    }
  }, [scrollRootRef, metas.length, scrollElement])

  const variantGroups = useMemo(() => {
    const groups = new Map<string, MessageMeta[]>()
    metas.forEach((meta) => {
      if (meta.role === 'assistant' && meta.parentMessageId != null) {
        const parentKey = messageKey(meta.parentMessageId)
        const list = groups.get(parentKey) ?? []
        list.push(meta)
        groups.set(parentKey, list)
      }
    })
    groups.forEach((list, key) => {
      list.sort(compareVariants)
      groups.set(key, list)
    })
    return groups
  }, [metas])

  const displayMetas = useMemo(
    () =>
      metas.filter((meta) => {
        if (!variantSelections || meta.role !== 'assistant' || meta.parentMessageId == null) {
          return true
        }
        const parentKey = messageKey(meta.parentMessageId)
        const selected = variantSelections[parentKey]
        if (selected == null) return false
        return messageKey(selected) === messageKey(meta.id)
      }),
    [metas, variantSelections],
  )

  const shareSelectionState = shareSelection ?? { enabled: false, sessionId: null, selectedMessageIds: [] }
  const shareSelectedKeys = useMemo(() => {
    if (!shareSelectionState.selectedMessageIds?.length) {
      return new Set<string>()
    }
    return new Set(shareSelectionState.selectedMessageIds.map((id) => messageKey(id)))
  }, [shareSelectionState.selectedMessageIds])
  const lastDisplayIndex = displayMetas.length - 1
  const shouldAdjustScrollPositionOnItemSizeChange = useCallback(
    (item: VirtualizerResizeItem, delta: number, instance: VirtualizerResizeInstance) => {
      if (Math.abs(delta) > 240) return false
      if (typeof document !== 'undefined') {
        const active = document.activeElement
        if (active instanceof Element && active.closest('[data-message-panel="interactive"]')) {
          return false
        }
      }
      if (!autoScrollEnabled) return false
      if (!isStreaming) return false
      if (item.index !== lastDisplayIndex) return false
      return item.start < instance.getScrollOffset()
    },
    [autoScrollEnabled, isStreaming, lastDisplayIndex],
  )
  const estimateRowHeight = useCallback(
    (index: number) => {
      const meta = displayMetas[index]
      if (!meta) return 180
      const body = bodies[messageKey(meta.id)]
      if (!body) return 150

      const contentLen = body.content?.length ?? 0
      if (meta.role === 'compressedGroup') {
        return Math.max(140, Math.min(360, 140 + Math.ceil(contentLen / 120) * 20))
      }
      const reasoningLen = body.reasoning?.length ?? 0
      const imageCount = meta.images?.length ?? 0
      const artifactCount = (body.artifacts ?? meta.artifacts ?? []).length
      let estimated = 110
      estimated += Math.min(600, Math.ceil(contentLen / 90) * 22)
      estimated += Math.min(240, Math.ceil(reasoningLen / 180) * 18)
      estimated += imageCount * 70
      estimated += artifactCount * 44
      if (meta.role === 'user') estimated -= 14
      return Math.max(100, estimated)
    },
    [bodies, displayMetas],
  )

  const virtualizer = useVirtualizer({
    count: displayMetas.length,
    getScrollElement: () => scrollElement,
    estimateSize: estimateRowHeight,
    overscan: 8,
    paddingStart: 0,
    paddingEnd: 16,
    // 当前 react-virtual 类型定义缺少该字段，运行时由 virtual-core 实际支持。
    ...({ shouldAdjustScrollPositionOnItemSizeChange } as Record<string, unknown>),
  })
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = shouldAdjustScrollPositionOnItemSizeChange as any

  const lastMeta = displayMetas[displayMetas.length - 1]
  const lastUserMeta = useMemo(() => {
    for (let i = displayMetas.length - 1; i >= 0; i -= 1) {
      const candidate = displayMetas[i]
      if (candidate?.role === 'user') return candidate
    }
    return null
  }, [displayMetas])

  if (isLoading && displayMetas.length === 0) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
              <div className="mt-3 h-20 bg-muted/70 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (displayMetas.length === 0 && !isStreaming) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>开始你的第一次对话吧</p>
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()
  const virtualSize = virtualizer.getTotalSize()
  const indicatorVisible = isStreaming && (!lastMeta || lastMeta.role !== 'assistant')
  const indicatorHeight = indicatorVisible ? 64 : 0
  const totalSize = virtualSize + indicatorHeight

  return (
    <div ref={containerRef} style={{ height: totalSize, position: 'relative' }}>
      {virtualItems.map((virtualRow) => {
        const meta = displayMetas[virtualRow.index]
        const storageKey = messageKey(meta.id)
        const reactKey = meta.stableKey || storageKey
        const body = bodies[storageKey]
        if (!body) return null
        const cache = renderCache[storageKey]
        const metricEntry = metrics?.[storageKey]
        const parentKey = meta.parentMessageId != null ? messageKey(meta.parentMessageId) : null
        const siblings = parentKey ? variantGroups.get(parentKey) || [] : []
        const siblingIndex = parentKey
          ? siblings.findIndex((entry) => messageKey(entry.id) === storageKey)
          : -1
        const variantInfo =
          parentKey != null
            ? {
                parentKey,
                total: siblings.length || 1,
                index: siblingIndex >= 0 ? siblingIndex : 0,
                onPrev: () => cycleAssistantVariant(parentKey, 'prev'),
                onNext: () => cycleAssistantVariant(parentKey, 'next'),
                onRegenerate: () => regenerateAssistantMessage(meta.id),
              }
            : undefined
        const streamingForMessage =
          isStreaming &&
          meta.role === 'assistant' &&
          lastMeta &&
          messageKey(lastMeta.id) === storageKey
        const shareModeActive =
          shareSelectionState.enabled && shareSelectionState.sessionId === meta.sessionId
        const shareSelectable =
          meta.role !== 'compressedGroup' &&
          typeof meta.id === 'number' &&
          !meta.pendingSync
        const shareSelected =
          shareModeActive && shareSelectable && shareSelectedKeys.has(messageKey(meta.id))
        const canEditUserMessage =
          meta.role === 'user' &&
          shareSelectable &&
          !shareModeActive &&
          !isStreaming &&
          lastUserMeta != null &&
          messageKey(lastUserMeta.id) === storageKey
        return (
          <div
            key={reactKey}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
              paddingBottom: 16,
            }}
          >
            {meta.role === 'compressedGroup' ? (
              <CompressedGroupCard meta={meta} body={body} />
            ) : (
              <MessageBubble
                meta={meta}
                body={body}
                renderCache={cache}
                isStreaming={streamingForMessage}
                metrics={metricEntry}
                canEditUserMessage={canEditUserMessage}
                variantInfo={variantInfo}
                shareSelection={
                  shareSelectable || shareModeActive
                    ? {
                        active: shareModeActive,
                        selectable: shareSelectable,
                        selected: shareSelected,
                        onToggle:
                          shareModeActive && shareSelectable && onShareToggle
                            ? () => onShareToggle(Number(meta.id))
                            : undefined,
                        onStart: shareSelectable && onShareStart ? () => onShareStart(Number(meta.id)) : undefined,
                      }
                    : shareSelectable && onShareStart
                    ? {
                        active: false,
                        selectable: shareSelectable,
                        selected: false,
                        onStart: () => onShareStart(Number(meta.id)),
                      }
                    : undefined
                }
              />
            )}
          </div>
        )
      })}

      {indicatorVisible && (
        <div
          style={{
            position: 'absolute',
            top: virtualSize,
            left: 0,
            width: '100%',
            paddingTop: 16,
          }}
        >
          <TypingIndicator />
        </div>
      )}
    </div>
  )
}

export const MessageList = memo(
  MessageListComponent,
  (prev, next) =>
    prev.isLoading === next.isLoading &&
    prev.isStreaming === next.isStreaming &&
    prev.metas === next.metas &&
    prev.bodies === next.bodies &&
    prev.renderCache === next.renderCache &&
    prev.autoScrollEnabled === next.autoScrollEnabled &&
    prev.scrollRootRef === next.scrollRootRef &&
    prev.variantSelections === next.variantSelections &&
    prev.shareSelection === next.shareSelection &&
    prev.onShareToggle === next.onShareToggle &&
    prev.onShareStart === next.onShareStart
)
