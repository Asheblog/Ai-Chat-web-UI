'use client'

import { ChatToolbar } from '@/components/chat/chat-toolbar'
import { ChatComposerPanel } from '@/components/chat/chat-composer-panel'
import { ChatQuotaNotice } from '@/components/chat/chat-quota-notice'
import { ChatMessageViewport } from '@/components/chat/chat-message-viewport'
import { useChatInterfaceViewModel } from '@/hooks/use-chat-interface-viewmodel'

const MAX_AUTO_HEIGHT = 200

export function ChatInterface() {
  const viewModel = useChatInterfaceViewModel(MAX_AUTO_HEIGHT)

  if (!viewModel) {
    return null
  }

  const { toolbar, viewport, quotaMessage, composer } = viewModel

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <ChatToolbar {...toolbar} />

      <ChatMessageViewport {...viewport} />

      <ChatQuotaNotice message={quotaMessage} />

      <ChatComposerPanel {...composer} />
    </div>
  )
}
