'use client'

import { ChatMessageViewport } from '@/components/chat/chat-message-viewport'
import { useChatViewport } from '@/hooks/use-chat-viewport'

/**
 * 独立订阅消息视口的边界：流式 chunk 只重渲染这里，
 * 不会把 composer / 工具栏一起卷进整页 viewmodel 的重算。
 */
export function ConnectedMessageViewport() {
  const viewportState = useChatViewport()
  const currentSession = viewportState.currentSession

  if (!currentSession) return null

  return (
    <ChatMessageViewport
      scrollAreaRef={viewportState.scrollAreaRef}
      error={viewportState.error}
      metas={viewportState.messageMetas}
      isStreaming={viewportState.isStreaming}
      isLoading={viewportState.isMessagesLoading}
      hasOlder={viewportState.hasOlderMessages}
      isLoadingOlder={viewportState.isLoadingOlderMessages}
      variantSelections={viewportState.assistantVariantSelections}
      isAutoScrollEnabled={viewportState.isAutoScrollEnabled}
      setAutoScrollEnabled={viewportState.setAutoScrollEnabled}
      sessionId={currentSession.id}
      sessionTitle={currentSession.title || '分享链接'}
    />
  )
}
