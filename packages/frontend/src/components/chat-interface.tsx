'use client'

import { useEffect } from 'react'
import type { ModelItem } from '@/store/models-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { useChatComposer } from '@/hooks/use-chat-composer'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { persistPreferredModel } from '@/store/model-preference-store'
import { ChatToolbar } from '@/components/chat/chat-toolbar'
import { ChatComposerPanel } from '@/components/chat/chat-composer-panel'
import { useTextareaAutoResize } from '@/hooks/use-textarea-auto-resize'

const MAX_AUTO_HEIGHT = 200

export function ChatInterface() {
  const {
    input,
    setIsComposing,
    textareaRef,
    scrollAreaRef,
    fileInputRef,
    selectedImages,
    thinkingEnabled,
    setThinkingEnabled,
    effort,
    setEffort,
    messageMetas,
    messageBodies,
    messageRenderCache,
    isMessagesLoading,
    isStreaming,
    currentSession,
    error,
    isVisionEnabled,
    MAX_IMAGE_COUNT,
    MAX_IMAGE_MB,
    MAX_IMAGE_EDGE,
    handleSend,
    handleStop,
    handleKeyDown,
    handleTextareaChange,
    pickImages,
    onFilesSelected,
    removeImage,
    webSearchEnabled,
    setWebSearchEnabled,
    canUseWebSearch,
  } = useChatComposer()

  const { showExpand } = useTextareaAutoResize(textareaRef, input, MAX_AUTO_HEIGHT)

  const desktopSendDisabled = (!input.trim() && selectedImages.length === 0) && !isStreaming

  const { actorState, quota } = useAuthStore((state) => ({ actorState: state.actorState, quota: state.quota }))
  const actorType = actorState === 'authenticated' ? 'user' : 'anonymous'
  const isAnonymous = actorState !== 'authenticated'
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota?.remaining ?? (quota ? Math.max(0, quota.dailyLimit - quota.usedCount) : null)
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaLabel = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)
  const basePlaceholder = quota
    ? (quotaExhausted ? '额度已用尽，请登录或等待次日重置' : `本日消息发送额度剩余 ${quotaLabel}`)
    : '输入消息（Shift+Enter 换行）'
  const mobilePlaceholder = currentSession ? '继续输入...' : '输入你要翻译的文字'

  if (!currentSession) {
    return null
  }

  const toggleReasoning = (value: boolean) => {
    setThinkingEnabled(value)
    useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEnabled: value })
  }

  const toggleWebSearch = (value: boolean) => {
    if (!canUseWebSearch) return
    setWebSearchEnabled(value)
  }

  const updateEffort = (value: 'low' | 'medium' | 'high' | 'unset') => {
    setEffort(value)
    useChatStore.getState().updateSessionPrefs(currentSession.id, {
      reasoningEffort: value === 'unset' ? undefined : value,
    })
  }

  const handleModelChange = (model: ModelItem) => {
    const cur = useChatStore.getState().currentSession
    if (cur) {
      void persistPreferredModel(model, { actorType })
      useChatStore.getState().switchSessionModel(cur.id, model)
    }
  }

  const textareaDisabled = isStreaming || (quota ? quotaExhausted : false)
  const imageLimits = {
    maxCount: MAX_IMAGE_COUNT,
    maxMb: MAX_IMAGE_MB,
    maxEdge: MAX_IMAGE_EDGE,
  }
  const toolbarModelId = currentSession.modelLabel || currentSession.modelRawId || null

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <ChatToolbar selectedModelId={toolbarModelId} onModelChange={handleModelChange} />

      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 md:px-6">
        <div className="pt-4 md:pt-6 pb-4 md:pb-6">
          {error && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {String(error)}
            </div>
          )}
          <MessageList
            metas={messageMetas}
            bodies={messageBodies}
            renderCache={messageRenderCache}
            isStreaming={isStreaming}
            isLoading={isMessagesLoading}
            scrollRootRef={scrollAreaRef}
          />
        </div>
      </ScrollArea>

      <ChatComposerPanel
        input={input}
        textareaRef={textareaRef}
        showExpand={showExpand}
        isStreaming={isStreaming}
        selectedImages={selectedImages}
        thinkingEnabled={thinkingEnabled}
        webSearchEnabled={webSearchEnabled}
        canUseWebSearch={canUseWebSearch}
        isVisionEnabled={isVisionEnabled}
        effort={effort}
        basePlaceholder={basePlaceholder}
        mobilePlaceholder={mobilePlaceholder}
        textareaDisabled={textareaDisabled}
        desktopSendDisabled={desktopSendDisabled}
        pickImages={pickImages}
        onRemoveImage={removeImage}
        onInputChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onSend={handleSend}
        onStop={handleStop}
        onToggleThinking={toggleReasoning}
        onToggleWebSearch={toggleWebSearch}
        onEffortChange={updateEffort}
        fileInputRef={fileInputRef}
        onFilesSelected={onFilesSelected}
        imageLimits={imageLimits}
      />
    </div>
  )
}
