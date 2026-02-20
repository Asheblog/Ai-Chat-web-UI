'use client'

import { useChatComposer } from '@/hooks/use-chat-composer'
import { useTextareaAutoResize } from '@/hooks/use-textarea-auto-resize'
import { useChatSessionControls } from '@/hooks/use-chat-session-controls'
import { useKnowledgeBase } from '@/hooks/use-knowledge-base'
import type { ChatToolbarProps } from '@/components/chat/chat-toolbar'
import type { ChatComposerPanelProps } from '@/components/chat/chat-composer-panel'
import type { ChatMessageViewportProps } from '@/components/chat/chat-message-viewport'

export interface ChatInterfaceViewModel {
  toolbar: ChatToolbarProps
  viewport: ChatMessageViewportProps
  quotaMessage: string | null
  composer: ChatComposerPanelProps
}

export function useChatInterfaceViewModel(autoHeight = 200): ChatInterfaceViewModel | null {
  // 知识库 - 需要先于 useChatComposer 调用，以便传递 selectedKbIds
  const knowledgeBase = useKnowledgeBase()

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
    isAutoScrollEnabled,
    currentSession,
    error,
    isVisionEnabled,
    MAX_IMAGE_COUNT,
    MAX_IMAGE_MB,
    MAX_IMAGE_EDGE,
    MAX_TOTAL_IMAGE_MB,
    handleSend,
    handleStop,
    handleKeyDown,
    handleTextareaChange,
    pickImages,
    onFilesSelected,
    removeImage,
    handlePaste,
    webSearchEnabled,
    setWebSearchEnabled,
    webSearchScope,
    setWebSearchScope,
    showWebSearchScope,
    canUseWebSearch,
    webSearchDisabledNote,
    pythonToolEnabled,
    setPythonToolEnabled,
    canUsePythonTool,
    pythonToolDisabledNote,
    assistantVariantSelections,
    sendLocked,
    sendLockedReason,
    customBodyInput,
    customBodyError,
    customHeaders,
    setCustomBodyInput,
    setCustomBodyError,
    addCustomHeader,
    updateCustomHeader,
    removeCustomHeader,
    canAddCustomHeader,
    sessionPromptDraft,
    sessionPromptSaving,
    sessionPromptSourceLabel,
    sessionPromptPlaceholder,
    setSessionPromptDraft,
    onSaveSessionPrompt,
    traceEnabled,
    canUseTrace,
    onToggleTrace,
    // 文档附件
    documentInputRef,
    attachedDocuments,
    isUploadingDocuments,
    hasReadyDocuments,
    hasProcessingDocuments,
    pickDocuments,
    onDocumentFilesSelected,
    removeDocument,
    cancelDocument,
  } = useChatComposer({ knowledgeBaseIds: knowledgeBase.selectedKbIds })

  const { showExpand } = useTextareaAutoResize(textareaRef, input, autoHeight)

  const sessionControls = useChatSessionControls({
    currentSession,
    canUseWebSearch,
    setThinkingEnabled,
    setWebSearchEnabled,
    setEffort,
  })

  if (!currentSession) {
    return null
  }

  const desktopSendDisabled = sendLocked || hasProcessingDocuments || ((!input.trim() && selectedImages.length === 0) && !isStreaming)
  const textareaDisabled = isStreaming || sessionControls.quotaExhausted
  const imageLimits = {
    maxCount: MAX_IMAGE_COUNT,
    maxMb: MAX_IMAGE_MB,
    maxEdge: MAX_IMAGE_EDGE,
    maxTotalMb: MAX_TOTAL_IMAGE_MB,
  }

  const toolbar: ChatToolbarProps = {
    selectedModelId: sessionControls.toolbarModelId,
    onModelChange: sessionControls.handleModelChange,
  }

  const viewport: ChatMessageViewportProps = {
    scrollAreaRef,
    error,
    metas: messageMetas,
    bodies: messageBodies,
    renderCache: messageRenderCache,
    isStreaming,
    isLoading: isMessagesLoading,
    variantSelections: assistantVariantSelections,
    isAutoScrollEnabled,
    sessionId: currentSession.id,
    sessionTitle: currentSession.title || '分享链接',
  }

  const composer: ChatComposerPanelProps = {
    input,
    textareaRef,
    showExpand,
    isStreaming,
    selectedImages,
    thinkingEnabled,
    webSearchEnabled,
    webSearchScope,
    showWebSearchScope,
    canUseWebSearch,
    webSearchDisabledNote,
    pythonToolEnabled,
    onTogglePythonTool: setPythonToolEnabled,
    canUsePythonTool,
    pythonToolDisabledNote,
    isVisionEnabled,
    effort,
    basePlaceholder: sessionControls.basePlaceholder,
    mobilePlaceholder: sessionControls.mobilePlaceholder,
    textareaDisabled,
    desktopSendDisabled,
    sendLocked,
    sendLockedReason,
    pickImages,
    onRemoveImage: removeImage,
    onInputChange: handleTextareaChange,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
    onSend: handleSend,
    onStop: handleStop,
    traceEnabled,
    canUseTrace,
    onToggleTrace,
    onToggleThinking: sessionControls.toggleReasoning,
    onToggleWebSearch: sessionControls.toggleWebSearch,
    onWebSearchScopeChange: setWebSearchScope,
    onEffortChange: sessionControls.updateEffort,
    fileInputRef,
    onFilesSelected,
    imageLimits,
    customHeaders,
    onAddCustomHeader: addCustomHeader,
    onCustomHeaderChange: updateCustomHeader,
    onRemoveCustomHeader: removeCustomHeader,
    canAddCustomHeader,
    customBody: customBodyInput,
    onCustomBodyChange: (value) => {
      setCustomBodyError(null)
      setCustomBodyInput(value)
    },
    customBodyError,
    sessionPromptDraft,
    sessionPromptSaving,
    sessionPromptSourceLabel,
    sessionPromptPlaceholder,
    onSessionPromptChange: setSessionPromptDraft,
    onSessionPromptSave: onSaveSessionPrompt,
    // 文档附件
    documentInputRef,
    attachedDocuments,
    isUploadingDocuments,
    hasDocuments: attachedDocuments.length > 0,
    hasProcessingDocuments,
    pickDocuments,
    onDocumentFilesSelected,
    onRemoveDocument: removeDocument,
    onCancelDocument: cancelDocument,
    // 知识库
    knowledgeBaseEnabled: knowledgeBase.isEnabled,
    knowledgeBases: knowledgeBase.availableKbs,
    selectedKnowledgeBaseIds: knowledgeBase.selectedKbIds,
    onToggleKnowledgeBase: knowledgeBase.toggleKb,
    onSelectAllKnowledgeBases: knowledgeBase.selectAll,
    onClearKnowledgeBases: knowledgeBase.clearAll,
    onRefreshKnowledgeBases: knowledgeBase.refresh,
    isLoadingKnowledgeBases: knowledgeBase.isLoading,
  }

  return {
    toolbar,
    viewport,
    quotaMessage: sessionControls.quotaNotice?.message ?? null,
    composer,
  }
}
