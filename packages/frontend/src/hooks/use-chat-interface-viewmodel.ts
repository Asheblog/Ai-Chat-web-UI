'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useChatComposer } from '@/hooks/use-chat-composer'
import { useTextareaAutoResize } from '@/hooks/use-textarea-auto-resize'
import { useChatSessionControls } from '@/hooks/use-chat-session-controls'
import { useKnowledgeBase } from '@/hooks/use-knowledge-base'
import { useSessionKnowledgeBaseSync } from '@/hooks/use-session-knowledge-base-sync'
import { useDesktopComposer } from '@/hooks/use-desktop-composer'
import type { ChatToolbarProps } from '@/components/chat/chat-toolbar'
import type { ChatComposerPanelProps } from '@/components/chat/chat-composer-panel'
import { useChatStore } from '@/store/chat-store'

export interface ChatInterfaceViewModel {
  toolbar: ChatToolbarProps
  composer: ChatComposerPanelProps
}

export function useChatInterfaceViewModel(autoHeight = 200): ChatInterfaceViewModel | null {
  const activeSessionId = useChatStore((state) => state.currentSession?.id ?? null)
  const isDesktopComposer = useDesktopComposer()
  // 知识库 - 需要先于 useChatComposer 调用，以便传递 selectedKbIds
  const knowledgeBase = useKnowledgeBase({ sessionId: activeSessionId })

  const {
    input,
    setIsComposing,
    textareaRef,
    selectedImages,
    thinkingEnabled,
    setThinkingEnabled,
    effort,
    setEffort,
    isStreaming,
    currentSession,
    error,
    handleSend,
    handleStop,
    handleKeyDown,
    handleTextareaChange,
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
    deepResearchEnabled,
    setDeepResearchEnabled,
    skillOptions,
    toggleSkillOption,
    ensureSkillsLoaded,
    mcpGlobalEnabled,
    mcpConnectionOptions,
    mcpSessionTools,
    mcpLoading,
    mcpError,
    ensureMcpLoaded,
    onToggleMcpBinding,
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
    // 统一附件上传
    attachmentInputRef,
    pickAttachments,
    onAttachmentsSelected,
    workspaceFiles,
    isUploadingWorkspaceFiles,
    hasWorkspaceFiles,
    removeWorkspaceFile,
    retryWorkspaceFile,
    clearWorkspaceFiles,
    isDragOver,
    dragHandlers,
  } = useChatComposer({ knowledgeBaseIds: knowledgeBase.selectedKbIds })

  const { showExpand } = useTextareaAutoResize(textareaRef, input, autoHeight, isDesktopComposer)

  const sessionControls = useChatSessionControls({
    currentSession,
    canUseWebSearch,
    setThinkingEnabled,
    setWebSearchEnabled,
    setEffort,
  })
  // 会话知识库选择：用户改选先本地生效，再写回会话记录；水合不得覆盖用户刚做出的选择。
  const { markUserEdit: markKbUserEdit } = useSessionKnowledgeBaseSync({
    sessionId: currentSession?.id ?? null,
    sessionKbIds: Array.isArray(currentSession?.knowledgeBaseIds) ? currentSession.knowledgeBaseIds : [],
    selectedKbIds: knowledgeBase.selectedKbIds,
    setSelectedKbIds: knowledgeBase.setSelectedKbIds,
    persist: (ids) =>
      currentSession
        ? useChatStore.getState().updateSessionPrefs(currentSession.id, { knowledgeBaseIds: ids })
        : undefined,
  })
  const toggleKnowledgeBase = useCallback(
    (id: number) => {
      markKbUserEdit()
      knowledgeBase.toggleKb(id)
    },
    [knowledgeBase, markKbUserEdit],
  )
  const selectAllKnowledgeBases = useCallback(() => {
    markKbUserEdit()
    knowledgeBase.selectAll()
  }, [knowledgeBase, markKbUserEdit])
  const clearKnowledgeBases = useCallback(() => {
    markKbUserEdit()
    knowledgeBase.clearAll()
  }, [knowledgeBase, markKbUserEdit])

  const onActivateSkillPanel = useCallback(() => {
    void ensureSkillsLoaded()
    void ensureMcpLoaded()
  }, [ensureMcpLoaded, ensureSkillsLoaded])

  if (!currentSession) {
    return null
  }

  const readyFiles = workspaceFiles.filter((f) => f.status === 'ready')
  const desktopSendDisabled = sendLocked || isUploadingWorkspaceFiles || ((!input.trim() && selectedImages.length === 0 && readyFiles.length === 0) && !isStreaming)
  const textareaDisabled = isStreaming || sessionControls.quotaExhausted

  const toolbar: ChatToolbarProps = {
    selectedModelId: sessionControls.toolbarModelId,
    onModelChange: sessionControls.handleModelChange,
  }

  const composer: ChatComposerPanelProps = {
    input,
    textareaRef,
    isDesktopComposer,
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
    deepResearchEnabled,
    onToggleDeepResearch: setDeepResearchEnabled,
    skillOptions,
    onToggleSkillOption: toggleSkillOption,
    onActivateSkillPanel,
    mcpGlobalEnabled,
    mcpConnectionOptions,
    mcpSessionTools,
    mcpLoading,
    mcpError,
    onToggleMcpBinding,
    effort,
    basePlaceholder: sessionControls.basePlaceholder,
    mobilePlaceholder: sessionControls.mobilePlaceholder,
    textareaDisabled,
    desktopSendDisabled,
    sendLocked,
    sendLockedReason,
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
    // 统一附件上传
    attachmentInputRef,
    pickAttachments,
    onAttachmentsSelected,
    workspaceFiles,
    isUploadingWorkspaceFiles,
    hasWorkspaceFiles,
    onRemoveWorkspaceFile: removeWorkspaceFile,
    onRetryWorkspaceFile: retryWorkspaceFile,
    quotaMessage: sessionControls.quotaNotice?.message ?? null,
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
    // 拖拽上传
    isDragOver,
    dragHandlers,
    // 知识库
    knowledgeBaseEnabled: knowledgeBase.isEnabled,
    knowledgeBases: knowledgeBase.availableKbs,
    selectedKnowledgeBaseIds: knowledgeBase.selectedKbIds,
    onToggleKnowledgeBase: toggleKnowledgeBase,
    onSelectAllKnowledgeBases: selectAllKnowledgeBases,
    onClearKnowledgeBases: clearKnowledgeBases,
    onRefreshKnowledgeBases: knowledgeBase.refresh,
    isLoadingKnowledgeBases: knowledgeBase.isLoading,
  }

  return { toolbar, composer }
}