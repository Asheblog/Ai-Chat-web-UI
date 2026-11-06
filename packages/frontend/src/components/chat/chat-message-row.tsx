'use client'

import { memo, useCallback, useMemo } from 'react'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry, MessageStreamMetrics } from '@/types'
import { MessageBubble } from '@/components/message-bubble'
import { CompressedGroupCard } from '@/components/compressed-group-card'
import { useChatStore } from '@/store/chat-store'
import { messageKey } from '@/features/chat/store/utils'

export interface MessageRowShareFlags {
  active: boolean
  selectable: boolean
  selected: boolean
}

const hasBlockedResearchPlan = (body: MessageBody | undefined): boolean =>
  Boolean(
    body?.toolEvents?.some((event) => {
      const toolId = event.identifier || event.apiName || event.tool
      return toolId === 'research_plan' && (event.status === 'rejected' || event.status === 'aborted')
    }),
  )

interface MessageRowProps {
  meta: MessageMeta
  isStreaming: boolean
  canEditUserMessage: boolean
  share: MessageRowShareFlags | null
  variantParentKey: string | null
  variantTotal: number
  variantIndex: number
  onShareToggle?: (messageId: number) => void
  onShareStart?: (messageId: number) => void
  /** 外部只读数据（分享 / Battle）；主聊天走行内 store 订阅 */
  body?: MessageBody
  renderCache?: MessageRenderCacheEntry
  metrics?: MessageStreamMetrics | null
  storeConnected: boolean
}

const useStoreRowData = (storageKey: string) => {
  const body = useChatStore((state) => state.messageBodies[storageKey])
  const renderCache = useChatStore((state) => state.messageRenderCache[storageKey])
  const metrics = useChatStore((state) => state.messageMetrics?.[storageKey])
  return { body, renderCache, metrics }
}

function StoreMessageRow(props: MessageRowProps) {
  const { meta } = props
  const storageKey = messageKey(meta.id)
  const { body, renderCache, metrics } = useStoreRowData(storageKey)
  if (!body) return null
  return (
    <MessageRowContent
      {...props}
      body={body}
      renderCache={renderCache}
      metrics={metrics ?? null}
      storeConnected
    />
  )
}

function StaticMessageRow(props: MessageRowProps) {
  if (!props.body) return null
  return <MessageRowContent {...props} storeConnected={false} />
}

function MessageRowContent({
  meta,
  body,
  renderCache,
  metrics,
  isStreaming,
  canEditUserMessage,
  share,
  variantParentKey,
  variantTotal,
  variantIndex,
  onShareToggle,
  onShareStart,
  storeConnected,
}: MessageRowProps) {
  const messageId = typeof meta.id === 'number' ? meta.id : null
  const sessionId = meta.sessionId
  const shareAllowed =
    Boolean(share?.selectable) && !(meta.role === 'assistant' && hasBlockedResearchPlan(body))

  const cycleAssistantVariant = useChatStore((state) => state.cycleAssistantVariant)
  const regenerateAssistantMessage = useChatStore((state) => state.regenerateAssistantMessage)
  const toggleShareSelection = useChatStore((state) => state.toggleShareSelection)
  const enterShareSelectionMode = useChatStore((state) => state.enterShareSelectionMode)

  const handleToggleShare = useCallback(() => {
    if (messageId == null) return
    if (storeConnected) {
      toggleShareSelection(sessionId, messageId)
      return
    }
    onShareToggle?.(messageId)
  }, [messageId, onShareToggle, sessionId, storeConnected, toggleShareSelection])

  const handleStartShare = useCallback(() => {
    if (messageId == null) return
    if (storeConnected) {
      enterShareSelectionMode(sessionId, messageId)
      return
    }
    onShareStart?.(messageId)
  }, [enterShareSelectionMode, messageId, onShareStart, sessionId, storeConnected])

  const variantInfo = useMemo(() => {
    if (!variantParentKey) return undefined
    return {
      parentKey: variantParentKey,
      total: variantTotal || 1,
      index: variantIndex,
      onPrev: () => cycleAssistantVariant(variantParentKey, 'prev'),
      onNext: () => cycleAssistantVariant(variantParentKey, 'next'),
      onRegenerate: () => regenerateAssistantMessage(meta.id),
    }
  }, [cycleAssistantVariant, meta.id, regenerateAssistantMessage, variantIndex, variantParentKey, variantTotal])

  const shareSelection = useMemo(() => {
    if (!share) return undefined
    if (!share.active) {
      return shareAllowed
        ? {
            active: false,
            selectable: true,
            selected: false,
            onStart: handleStartShare,
          }
        : undefined
    }
    return {
      active: true,
      selectable: shareAllowed,
      selected: share.selected,
      onToggle: shareAllowed ? handleToggleShare : undefined,
    }
  }, [handleStartShare, handleToggleShare, share, shareAllowed])

  if (!body) return null

  if (meta.role === 'compressedGroup') {
    return <CompressedGroupCard meta={meta} body={body} />
  }

  return (
    <MessageBubble
      meta={meta}
      body={body}
      renderCache={renderCache}
      isStreaming={isStreaming}
      metrics={metrics ?? null}
      canEditUserMessage={canEditUserMessage}
      variantInfo={variantInfo}
      shareSelection={shareSelection}
    />
  )
}

const areRowPropsEqual = (prev: MessageRowProps, next: MessageRowProps) => {
  return (
    prev.meta === next.meta &&
    prev.isStreaming === next.isStreaming &&
    prev.canEditUserMessage === next.canEditUserMessage &&
    prev.storeConnected === next.storeConnected &&
    prev.body === next.body &&
    prev.renderCache === next.renderCache &&
    prev.metrics === next.metrics &&
    prev.variantParentKey === next.variantParentKey &&
    prev.variantTotal === next.variantTotal &&
    prev.variantIndex === next.variantIndex &&
    prev.onShareToggle === next.onShareToggle &&
    prev.onShareStart === next.onShareStart &&
    prev.share?.active === next.share?.active &&
    prev.share?.selectable === next.share?.selectable &&
    prev.share?.selected === next.share?.selected
  )
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  return props.storeConnected ? <StoreMessageRow {...props} /> : <StaticMessageRow {...props} />
}, areRowPropsEqual)
