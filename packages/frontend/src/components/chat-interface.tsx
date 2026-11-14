'use client'

import { ProcessWorkspaceHost } from '@/features/chat/process-workspace'
import { useChatStore } from '@/store/chat-store'
import { ChatToolbar } from '@/components/chat/chat-toolbar'
import { ChatComposerPanel } from '@/components/chat/chat-composer-panel'
import { ChatQuotaNotice } from '@/components/chat/chat-quota-notice'
import { ConnectedMessageViewport } from '@/components/chat/connected-message-viewport'
import { useChatInterfaceViewModel } from '@/hooks/use-chat-interface-viewmodel'

const MAX_AUTO_HEIGHT = 200

export function ChatInterface() {
  const viewModel = useChatInterfaceViewModel(MAX_AUTO_HEIGHT)
  const sessionKey = useChatStore(state => state.currentSession?.id ?? 'none')

  if (!viewModel) {
    return null
  }

  const { toolbar, quotaMessage, composer } = viewModel

  return (
    <ProcessWorkspaceHost key={sessionKey} className="flex-1 min-h-0 h-full">
    <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 relative">
      <ChatToolbar {...toolbar} />

      <ConnectedMessageViewport />

      <ChatQuotaNotice message={quotaMessage} />

      <ChatComposerPanel
        {...composer}
        selectedModelId={toolbar.selectedModelId}
        onModelChange={toolbar.onModelChange}
      />
    </div>
    </ProcessWorkspaceHost>
  )
}
