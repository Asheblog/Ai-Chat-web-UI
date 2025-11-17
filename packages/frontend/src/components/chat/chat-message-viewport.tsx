'use client'

import type { MutableRefObject } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry } from '@/types'
import { ChatErrorBanner } from '@/components/chat/chat-error-banner'

export interface ChatMessageViewportProps {
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>
  error: unknown
  metas: MessageMeta[]
  bodies: Record<string, MessageBody>
  renderCache: Record<string, MessageRenderCacheEntry>
  isStreaming: boolean
  isLoading: boolean
  variantSelections: Record<string, number | string>
}

export function ChatMessageViewport({
  scrollAreaRef,
  error,
  metas,
  bodies,
  renderCache,
  isStreaming,
  isLoading,
  variantSelections,
}: ChatMessageViewportProps) {
  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 md:px-6">
      <div className="pt-4 md:pt-6 pb-4 md:pb-6">
        <ChatErrorBanner error={error} />
        <MessageList
          metas={metas}
          bodies={bodies}
          renderCache={renderCache}
          isStreaming={isStreaming}
          isLoading={isLoading}
          scrollRootRef={scrollAreaRef}
          variantSelections={variantSelections}
        />
      </div>
    </ScrollArea>
  )
}
