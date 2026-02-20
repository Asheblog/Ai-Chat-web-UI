'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry } from '@/types'
import { ChatErrorBanner } from '@/components/chat/chat-error-banner'
import { Button } from '@/components/ui/button'
import { Share2 } from 'lucide-react'
import { useChatMessages, useChatStore } from '@/store/chat-store'
import { ShareDialog } from '@/components/chat/share-dialog'
import { messageKey } from '@/features/chat/store/utils'
import { ShareSelectionToolSummary } from '@/components/chat/share-selection-tool-summary'
import { cn } from '@/lib/utils'

export interface ChatMessageViewportProps {
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>
  error: unknown
  metas: MessageMeta[]
  bodies: Record<string, MessageBody>
  renderCache: Record<string, MessageRenderCacheEntry>
  isStreaming: boolean
  isLoading: boolean
  variantSelections: Record<string, number | string>
  sessionId: number
  sessionTitle: string
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
  sessionId,
  sessionTitle,
}: ChatMessageViewportProps) {
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const {
    shareSelection,
    enterShareSelectionMode,
    toggleShareSelection,
    setShareSelection,
    clearShareSelection,
    exitShareSelectionMode,
  } = useChatStore((state) => ({
    shareSelection: state.shareSelection,
    enterShareSelectionMode: state.enterShareSelectionMode,
    toggleShareSelection: state.toggleShareSelection,
    setShareSelection: state.setShareSelection,
    clearShareSelection: state.clearShareSelection,
    exitShareSelectionMode: state.exitShareSelectionMode,
  }))
  const messageMetrics = useChatStore((state) => state.messageMetrics || {})
  const messageBodiesMap = useChatMessages((state) => state.messageBodies)
  const shareModeActive = shareSelection.enabled && shareSelection.sessionId === sessionId
  const selectedCount = shareModeActive ? shareSelection.selectedMessageIds.length : 0
  const highlightedShareMessageId = shareModeActive ? shareSelection.selectedMessageIds[0] ?? null : null
  const highlightedBodyEvents = useMemo(() => {
    if (highlightedShareMessageId == null) return null
    const key = messageKey(highlightedShareMessageId)
    return messageBodiesMap[key]?.toolEvents ?? null
  }, [highlightedShareMessageId, messageBodiesMap])
  const showShareEntry = metas.length > 0 && !shareModeActive

  useEffect(() => {
    if (!shareModeActive && isShareDialogOpen) {
      setIsShareDialogOpen(false)
    }
  }, [shareModeActive, isShareDialogOpen])

  const selectedMessageIds = shareModeActive ? shareSelection.selectedMessageIds : []
  const shareSelectableMessageIds = useMemo(() => {
    const ids: number[] = []
    const seen = new Set<number>()
    metas.forEach((meta) => {
      if (meta.sessionId !== sessionId || typeof meta.id !== 'number') return
      if (!Number.isFinite(meta.id) || meta.pendingSync) return
      if (seen.has(meta.id)) return
      ids.push(meta.id)
      seen.add(meta.id)
    })
    return ids
  }, [metas, sessionId])
  const selectedIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds])
  const selectableCount = shareSelectableMessageIds.length
  const isAllSelectableChosen =
    shareModeActive && selectableCount > 0 && shareSelectableMessageIds.every((id) => selectedIdSet.has(id))

  const handleShareNext = () => {
    if (!shareModeActive || selectedCount === 0) return
    setIsShareDialogOpen(true)
  }

  const handleExitShareMode = () => {
    setIsShareDialogOpen(false)
    exitShareSelectionMode()
  }

  const handleToggleSelectAll = () => {
    if (!shareModeActive || selectableCount === 0) return
    if (isAllSelectableChosen) {
      clearShareSelection()
      return
    }
    setShareSelection(sessionId, shareSelectableMessageIds)
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 md:px-6">
      <div className={cn('pt-4 md:pt-6', shareModeActive ? 'pb-32 md:pb-10' : 'pb-6')}>
        {shareModeActive ? (
          <div className="mb-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-primary">分享选择模式已开启</p>
                <p className="text-xs text-primary/80 mt-1">
                  已选 {selectedCount} 条消息 · 仅当前会话可分享，切换会话将自动清空选择
                </p>
                <ShareSelectionToolSummary
                  sessionId={sessionId}
                  messageId={highlightedShareMessageId}
                  bodyEvents={highlightedBodyEvents ?? undefined}
                  title="首条选中消息的工具调用"
                  className="mt-2 max-w-md"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleSelectAll}
                  disabled={selectableCount === 0}
                >
                  {isAllSelectableChosen ? '反选' : '全选'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => clearShareSelection()}
                  disabled={selectedCount === 0}
                >
                  清空选中
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleExitShareMode}>
                  返回聊天
                </Button>
                <Button type="button" size="sm" onClick={handleShareNext} disabled={selectedCount === 0}>
                  下一步
                </Button>
              </div>
            </div>
          </div>
        ) : (
          showShareEntry && (
            <div className="mb-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.45] hover:bg-[hsl(var(--surface-hover))]"
                onClick={() => enterShareSelectionMode(sessionId)}
              >
                <Share2 className="mr-2 h-4 w-4" />
                分享多条消息
              </Button>
            </div>
          )
        )}
        <ChatErrorBanner error={error} />
        <MessageList
          metas={metas}
          bodies={bodies}
          renderCache={renderCache}
          isStreaming={isStreaming}
          isLoading={isLoading}
          scrollRootRef={scrollAreaRef}
          variantSelections={variantSelections}
          metrics={messageMetrics}
          shareSelection={shareSelection}
          onShareToggle={(messageId) => toggleShareSelection(sessionId, messageId)}
          onShareStart={(messageId) => enterShareSelectionMode(sessionId, messageId)}
        />
      </div>
      {shareModeActive && (
        <div className="lg:hidden fixed bottom-24 left-0 right-0 z-30 px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-full border border-primary/30 bg-[hsl(var(--surface))/0.95] px-4 py-3 shadow-lg backdrop-blur">
            <span className="text-sm text-foreground">
              已选 <span className="font-semibold text-primary">{selectedCount}</span> 条消息
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleToggleSelectAll}
                disabled={selectableCount === 0}
              >
                {isAllSelectableChosen ? '反选' : '全选'}
              </Button>
              <Button type="button" size="sm" onClick={handleShareNext} disabled={selectedCount === 0}>
                下一步
              </Button>
            </div>
          </div>
        </div>
      )}
      <ShareDialog
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        selectedMessageIds={selectedMessageIds}
        open={isShareDialogOpen}
        onOpenChange={setIsShareDialogOpen}
        onShareCompleted={handleExitShareMode}
      />
    </ScrollArea>
  )
}
