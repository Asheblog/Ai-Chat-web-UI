import { memo, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBody, MessageMeta, MessageRenderCacheEntry } from '@/types'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'

const messageKey = (id: number | string) => (typeof id === 'string' ? id : String(id))

interface MessageListProps {
  metas: MessageMeta[]
  bodies: Record<string, MessageBody>
  renderCache: Record<string, MessageRenderCacheEntry>
  isStreaming: boolean
  isLoading?: boolean
  scrollRootRef?: RefObject<HTMLElement | null>
}

function MessageListComponent({
  metas,
  bodies,
  renderCache,
  isStreaming,
  isLoading,
  scrollRootRef,
}: MessageListProps) {
  if (isLoading && metas.length === 0) {
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

  if (metas.length === 0 && !isStreaming) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>开始你的第一次对话吧</p>
      </div>
    )
  }

  const lastMeta = metas[metas.length - 1]

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
      const viewport = containerRef.current.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
      if (viewport && viewport !== scrollElement) {
        setScrollElement(viewport)
      }
    }
  }, [scrollRootRef, metas.length, scrollElement])

  const virtualizer = useVirtualizer({
    count: metas.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 180,
    overscan: 8,
    paddingStart: 0,
    paddingEnd: 16,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const virtualSize = virtualizer.getTotalSize()
  const indicatorVisible = isStreaming && (!lastMeta || lastMeta.role !== 'assistant')
  const indicatorHeight = indicatorVisible ? 64 : 0
  const totalSize = virtualSize + indicatorHeight

  return (
    <div ref={containerRef} style={{ height: totalSize, position: 'relative' }}>
      {virtualItems.map((virtualRow) => {
        const meta = metas[virtualRow.index]
        const key = messageKey(meta.id)
        const body = bodies[key]
        if (!body) return null
        const cache = renderCache[key]
        const streamingForMessage =
          isStreaming &&
          meta.role === 'assistant' &&
          lastMeta &&
          messageKey(lastMeta.id) === key
        return (
          <div
            key={key}
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
            <MessageBubble
              meta={meta}
              body={body}
              renderCache={cache}
              isStreaming={streamingForMessage}
            />
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
    prev.scrollRootRef === next.scrollRootRef
)
