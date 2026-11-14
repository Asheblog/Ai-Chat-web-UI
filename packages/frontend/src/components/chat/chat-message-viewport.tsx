'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { shallow } from 'zustand/shallow'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList, type MessageListHandle } from '@/components/message-list'
import type { MessageMeta } from '@/types'
import { ChatErrorBanner } from '@/components/chat/chat-error-banner'
import { useChatStore } from '@/store/chat-store'
import { messageKey } from '@/features/chat/store/utils'
import { ShareDialog } from '@/components/chat/share-dialog'
import { ShareSelectionPanel } from '@/components/chat/share-selection-panel'
import { ChatTurnToc } from '@/components/chat/chat-turn-toc'
import { useReadingNav } from '@/hooks/use-reading-nav'
import type { TurnBodyLike } from '@/features/chat/reading-nav'
import { cn } from '@/lib/utils'

export interface ChatMessageViewportProps {
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>
  error: unknown
  metas: MessageMeta[]
  isStreaming: boolean
  isLoading: boolean
  hasOlder?: boolean
  isLoadingOlder?: boolean
  isAutoScrollEnabled: boolean
  setAutoScrollEnabled?: (enabled: boolean) => void
  variantSelections: Record<string, number | string>
  sessionId: number
  sessionTitle: string
}

function ChatMessageViewportComponent({
  scrollAreaRef,
  error,
  metas,
  isStreaming,
  isLoading,
  hasOlder = false,
  isLoadingOlder = false,
  isAutoScrollEnabled,
  setAutoScrollEnabled,
  variantSelections,
  sessionId,
  sessionTitle,
}: ChatMessageViewportProps) {
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const messageListApiRef = useRef<MessageListHandle | null>(null)
  // 只摘取轮次标题所需的正文文本；流式 chunk 改的是助手正文，不会改变这份摘要。
  const userTurnContents = useChatStore((state) => {
    const next: Record<string, string> = {}
    for (const meta of metas) {
      if (meta.role !== 'user' && meta.role !== 'compressedGroup') continue
      const body = state.messageBodies[messageKey(meta.id)]
      if (body) next[messageKey(meta.id)] = body.content ?? ''
    }
    return next
  }, shallow)
  const userTurnBodies = useMemo(() => {
    const next: Record<string, TurnBodyLike> = {}
    for (const [key, content] of Object.entries(userTurnContents)) next[key] = { content }
    return next
  }, [userTurnContents])
  const {
    shareSelection,
    enterShareSelectionMode,
    toggleShareSelection,
    exitShareSelectionMode,
  } = useChatStore(
    (state) => ({
      shareSelection: state.shareSelection,
      enterShareSelectionMode: state.enterShareSelectionMode,
      toggleShareSelection: state.toggleShareSelection,
      exitShareSelectionMode: state.exitShareSelectionMode,
    }),
    shallow,
  )
  const shareModeActive = shareSelection.enabled && shareSelection.sessionId === sessionId
  const selectedCount = shareModeActive ? shareSelection.selectedMessageIds.length : 0

  const { entries, activeKey, visible, jumpToKey } = useReadingNav({
    sessionId,
    metas,
    bodies: userTurnBodies,
    scrollAreaRef,
    messageListApiRef,
    isMessagesLoading: isLoading,
  })

  useEffect(() => {
    if (!shareModeActive && isShareDialogOpen) {
      setIsShareDialogOpen(false)
    }
  }, [shareModeActive, isShareDialogOpen])

  const selectedMessageIds = useMemo(
    () => (shareModeActive ? shareSelection.selectedMessageIds : []),
    [shareModeActive, shareSelection.selectedMessageIds],
  )
  const handleShareNext = () => {
    if (!shareModeActive || selectedCount === 0) return
    setIsShareDialogOpen(true)
  }

  const handleExitShareMode = () => {
    setIsShareDialogOpen(false)
    exitShareSelectionMode()
  }

  const handleJump = (key: string) => {
    setAutoScrollEnabled?.(false)
    jumpToKey(key)
  }

  const handleToggleShare = useCallback(
    (messageId: number) => toggleShareSelection(sessionId, messageId),
    [sessionId, toggleShareSelection],
  )
  const handleStartShare = useCallback(
    (messageId: number) => enterShareSelectionMode(sessionId, messageId),
    [enterShareSelectionMode, sessionId],
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea ref={scrollAreaRef} className="chat-message-viewport flex-1 px-3 sm:px-4 md:px-6">
        <div
          className={cn(
            'mx-auto w-full max-w-[760px] px-4 pb-2 pt-4 md:px-0 md:pt-6 lg:pt-10',
            shareModeActive ? 'pb-32 md:pb-10' : 'pb-6',
          )}
        >
          {hasOlder && (
            <div className="mb-2 text-center text-xs text-muted-foreground">
              {isLoadingOlder ? '正在加载更早消息…' : '上滑可加载更早消息'}
            </div>
          )}
          {shareModeActive && (
            <ShareSelectionPanel
              sessionId={sessionId}
              metas={metas}
              selectedMessageIds={selectedMessageIds}
              onExit={handleExitShareMode}
              onNext={handleShareNext}
            />
          )}
          <ChatErrorBanner error={error} />
          <MessageList
            ref={messageListApiRef}
            storeConnected
            metas={metas}
            isStreaming={isStreaming}
            isLoading={isLoading}
            autoScrollEnabled={isAutoScrollEnabled}
            scrollRootRef={scrollAreaRef}
            variantSelections={variantSelections}
            shareSelection={shareSelection}
            onShareToggle={handleToggleShare}
            onShareStart={handleStartShare}
          />
        </div>
        <ShareDialog
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          selectedMessageIds={selectedMessageIds}
          open={isShareDialogOpen}
          onOpenChange={setIsShareDialogOpen}
          onShareCompleted={handleExitShareMode}
        />
      </ScrollArea>
      {visible && !shareModeActive ? (
        <ChatTurnToc entries={entries} activeKey={activeKey} onJump={handleJump} />
      ) : null}
    </div>
  )
}

export const ChatMessageViewport = memo(ChatMessageViewportComponent)
