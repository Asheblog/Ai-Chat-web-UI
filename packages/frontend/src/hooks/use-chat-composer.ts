'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { shallow } from 'zustand/shallow'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useModelsStore } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'
import {
  useAdvancedRequest,
  useComposerFeatureFlags,
  useImageAttachments,
  useDocumentAttachments,
} from '@/features/chat/composer'
import type { ComposerImage, AttachedDocument } from '@/features/chat/composer'
import { useSkillsSelection } from './use-skills-selection'
import { useSendCommand } from './use-send-command'
import { useScrollPersistence } from './use-scroll-persistence'

export type { AttachedDocument }


export type ChatComposerImage = ComposerImage

export interface UseChatComposerOptions {
  knowledgeBaseIds?: number[]
}

export function useChatComposer(options?: UseChatComposerOptions) {
  const knowledgeBaseIds = options?.knowledgeBaseIds
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [noSaveThisRound, setNoSaveThisRound] = useState<boolean>(false)
  const {
    currentSession,
    messageMetas,
    messageBodies,
    messageRenderCache,
    messagePaginationBySession,
    isMessagesLoading,
    isStreaming,
    activeStreamCount,
    streamMessage,
    stopStreaming,
    loadOlderMessages,
    clearError,
    error,
    assistantVariantSelections,
    updateSessionPrefs,
  } = useChatStore(
    (state) => ({
      currentSession: state.currentSession,
      messageMetas: state.messageMetas,
      messageBodies: state.messageBodies,
      messageRenderCache: state.messageRenderCache,
      messagePaginationBySession: state.messagePaginationBySession,
      isMessagesLoading: state.isMessagesLoading,
      isStreaming: state.isStreaming,
      activeStreamCount: state.activeStreamCount,
      streamMessage: state.streamMessage,
      stopStreaming: state.stopStreaming,
      loadOlderMessages: state.loadOlderMessages,
      clearError: state.clearError,
      error: state.error,
      assistantVariantSelections: state.assistantVariantSelections,
      updateSessionPrefs: state.updateSessionPrefs,
    }),
    shallow,
  )

  const sessionMessageMetas = useMemo(() => {
    if (!currentSession) return []
    return messageMetas.filter((meta) => meta.sessionId === currentSession.id)
  }, [messageMetas, currentSession])

  const currentSessionPagination = useMemo(() => {
    if (!currentSession) return null
    return messagePaginationBySession[currentSession.id] || null
  }, [messagePaginationBySession, currentSession])
  const hasOlderMessages = Boolean(currentSessionPagination?.hasOlder)
  const isLoadingOlderMessages = Boolean(currentSessionPagination?.isLoadingOlder)

  const {
    customBodyInput,
    setCustomBodyInput,
    customBodyError,
    setCustomBodyError,
    customHeaders,
    addCustomHeader: appendCustomHeader,
    updateCustomHeader: patchCustomHeader,
    removeCustomHeader: deleteCustomHeader,
    canAddHeader,
    buildRequestPayload,
  } = useAdvancedRequest({ sessionId: currentSession?.id })

  const [sessionPromptDraft, setSessionPromptDraft] = useState<string>('')
  const [sessionPromptSaving, setSessionPromptSaving] = useState<boolean>(false)

  const { systemSettings } = useSettingsStore()
  const { toast } = useToast()
  const { models: allModels, fetchAll: fetchModels } = useModelsStore()
  const { actorState, user } = useAuthStore((state) => ({ actorState: state.actorState, user: state.user }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const storedWebSearchPreference = useWebSearchPreferenceStore((state) => state.lastSelection)
  const persistWebSearchPreference = useWebSearchPreferenceStore((state) => state.setLastSelection)
  const storedPythonPreference = usePythonToolPreferenceStore((state) => state.lastSelection)
  const persistPythonPreference = usePythonToolPreferenceStore((state) => state.setLastSelection)

  const modelsCount = allModels.length
  useEffect(() => {
    if (modelsCount === 0) {
      fetchModels().catch(() => { })
    }
  }, [modelsCount, fetchModels])

  const { enabledExtraSkills, skillOptions, toggleSkillOption } = useSkillsSelection()

  const activeModel = useMemo(() => {
    if (!currentSession) return null
    const cid = currentSession.connectionId ?? null
    const rid = currentSession.modelRawId ?? currentSession.modelLabel ?? null
    return (
      allModels.find((m) => {
        const cidMatch = cid != null ? m.connectionId === cid : true
        const ridMatch = rid ? m.rawId === rid || m.id === rid : false
        return cidMatch && ridMatch
      }) ?? null
    )
  }, [allModels, currentSession])

  const {
    thinkingEnabled,
    setThinkingEnabled,
    effort,
    setEffort,
    ollamaThink,
    setOllamaThink,
    webSearchEnabled,
    setWebSearchEnabled,
    webSearchScope,
    setWebSearchScope,
    pythonToolEnabled,
    setPythonToolEnabled,
    traceEnabled,
    onToggleTrace,
    canUseTrace,
    canUseWebSearch,
    canUsePythonTool,
    webSearchDisabledNote,
    pythonToolDisabledNote,
    isMetasoEngine,
    showWebSearchScope,
    isVisionEnabled,
  } = useComposerFeatureFlags({
    currentSession,
    systemSettings,
    activeModel,
    storedWebSearchPreference,
    persistWebSearchPreference,
    storedPythonPreference,
    persistPythonPreference,
    isAdmin,
  })

  useEffect(() => {
    if (!currentSession) return

    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const sysEffortRaw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'low' | 'medium' | 'high' | 'unset' =
      sysEffortRaw && sysEffortRaw !== '' ? sysEffortRaw : 'unset'
    const sysOllamaThink = Boolean(systemSettings?.ollamaThink ?? false)

    setThinkingEnabled(
      typeof currentSession.reasoningEnabled === 'boolean'
        ? Boolean(currentSession.reasoningEnabled)
        : sysEnabled,
    )
    setEffort((currentSession.reasoningEffort as any) || sysEffort)
    setOllamaThink(
      typeof currentSession.ollamaThink === 'boolean'
        ? Boolean(currentSession.ollamaThink)
        : sysOllamaThink,
    )
    const nextPrompt = (currentSession.systemPrompt ?? '') || ''
    setSessionPromptDraft(nextPrompt)
  }, [
    currentSession,
    currentSession?.id,
    currentSession?.reasoningEnabled,
    currentSession?.reasoningEffort,
    currentSession?.ollamaThink,
    currentSession?.systemPrompt,
    systemSettings?.reasoningEnabled,
    systemSettings?.openaiReasoningEffort,
    systemSettings?.ollamaThink,
    setThinkingEnabled,
    setEffort,
    setOllamaThink,
    setSessionPromptDraft,
  ])

  const { scrollAreaRef, isAutoScrollEnabled } = useScrollPersistence({
    currentSessionId: currentSession?.id ?? null,
    sessionMessageMetas,
    currentSessionPagination,
    isMessagesLoading,
    isStreaming,
    messageBodies: messageBodies as any,
    loadOlderMessages,
  })

  useEffect(() => {
    if (!textareaRef.current) return
    if (!isAutoScrollEnabled) return
    const active = typeof document !== 'undefined' ? document.activeElement : null
    const advancedEditing = active instanceof HTMLElement && active.dataset?.advancedInput === 'true'
    if (advancedEditing) return
    if (active && active !== document.body && active !== textareaRef.current) return
    textareaRef.current.focus()
  }, [isAutoScrollEnabled, isStreaming])

  const {
    fileInputRef,
    selectedImages,
    setSelectedImages,
    pickImages,
    onFilesSelected,
    removeImage,
    validateImage,
    handlePaste,
    limits: {
      maxCount: MAX_IMAGE_COUNT,
      maxMb: MAX_IMAGE_MB,
      maxEdge: MAX_IMAGE_EDGE,
      maxTotalMb: MAX_TOTAL_IMAGE_MB,
    },
  } = useImageAttachments({
    isVisionEnabled,
    limits: DEFAULT_CHAT_IMAGE_LIMITS,
    toast,
  })

  // 文档附件
  const {
    fileInputRef: documentInputRef,
    documents: attachedDocuments,
    isUploading: isUploadingDocuments,
    isLoading: isLoadingDocuments,
    hasReadyDocuments,
    hasProcessingDocuments,
    pickDocuments,
    onFilesSelected: onDocumentFilesSelected,
    removeDocument,
    cancelDocument,
    clearDocuments,
  } = useDocumentAttachments({
    sessionId: currentSession?.id ?? null,
    limits: {
      maxFileSize: (Number(systemSettings?.ragMaxFileSizeMb) || 50) * 1024 * 1024,
      allowedTypes: ['pdf', 'docx', 'doc', 'csv', 'txt', 'md'],
    },
    toast,
  })

  const handleAddCustomHeader = useCallback(() => {
    const result = appendCustomHeader()
    if (!result.ok && result.reason) {
      toast({ title: '已达到上限', description: result.reason, variant: 'destructive' })
    }
  }, [appendCustomHeader, toast])

  const handleSessionPromptSave = useCallback(async () => {
    if (!currentSession) return
    setSessionPromptSaving(true)
    try {
      const normalized = sessionPromptDraft.trim()
      const ok = await updateSessionPrefs(currentSession.id, {
        systemPrompt: normalized ? normalized : null,
      })
      if (ok) {
        toast({ title: '会话提示词已更新' })
      } else {
        toast({
          title: '保存失败',
          description: '服务端未能保存会话提示词，请稍后重试',
          variant: 'destructive',
        })
      }
    } catch (error: any) {
      toast({
        title: '保存失败',
        description: error?.response?.data?.error || error?.message || '更新会话提示词失败',
        variant: 'destructive',
      })
    } finally {
      setSessionPromptSaving(false)
    }
  }, [currentSession, sessionPromptDraft, toast, updateSessionPrefs])

  const maxConcurrentStreams = Math.max(1, systemSettings?.chatMaxConcurrentStreams ?? 1)
  const totalActiveStreams = activeStreamCount ?? 0
  const concurrencyLocked = totalActiveStreams >= maxConcurrentStreams
  const sendLockedReason = concurrencyLocked
    ? `当前已有 ${totalActiveStreams}/${maxConcurrentStreams} 个请求生成中，请稍后再试或先停止部分任务。`
    : hasProcessingDocuments
      ? '文档正在解析中，请等待解析完成后再发送消息。'
      : null

  const systemPromptFallback = (systemSettings?.chatSystemPrompt ?? '').trim()
  const personalPromptFallback = (user?.personalPrompt ?? '').trim()
  const effectiveFallbackPrompt = personalPromptFallback || systemPromptFallback
  const sessionPromptSourceLabel =
    currentSession?.systemPrompt && currentSession.systemPrompt.trim()
      ? '当前会话自定义生效'
      : personalPromptFallback
        ? '使用个人提示词'
        : systemPromptFallback
          ? '使用全局提示词'
          : '未设置提示词'
  const sessionPromptPlaceholder = effectiveFallbackPrompt
    ? `留空以继承${personalPromptFallback ? '个人提示词' : '全局提示词'}：${effectiveFallbackPrompt.slice(0, 60)}${effectiveFallbackPrompt.length > 60 ? '...' : ''}`
    : '留空将使用默认提示词：今天日期是{day time}（{day time} 会替换为服务器当前时间）'

  const handleSend = useSendCommand({
    input,
    currentSession,
    concurrencyLocked,
    totalActiveStreams,
    maxConcurrentStreams,
    clearError,
    isVisionEnabled,
    selectedImages,
    setSelectedImages,
    buildRequestPayload,
    enabledExtraSkills,
    webSearchEnabled,
    canUseWebSearch,
    webSearchScope,
    isMetasoEngine,
    webSearchIncludeSummary: systemSettings?.webSearchIncludeSummary,
    webSearchIncludeRaw: systemSettings?.webSearchIncludeRaw,
    canUsePythonTool,
    pythonToolEnabled,
    thinkingEnabled,
    effort,
    ollamaThink,
    noSaveThisRound,
    setNoSaveThisRound,
    traceEnabled,
    canUseTrace,
    knowledgeBaseIds,
    streamMessage,
    toast,
    setInput,
  })

  const handleStop = useCallback(() => {
    stopStreaming()
  }, [stopStreaming])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, isComposing],
  )

  const handleTextareaChange = useCallback((value: string) => {
    setInput(value)
  }, [])

  const handleWebSearchScopeChange = setWebSearchScope
  const handleTraceToggle = onToggleTrace
  const setPythonToolEnabledState = setPythonToolEnabled

  return {
    // 状态
    input,
    isComposing,
    textareaRef,
    scrollAreaRef,
    fileInputRef,
    selectedImages,
    thinkingEnabled,
    effort,
    ollamaThink,
    noSaveThisRound,
    customBodyInput,
    customBodyError,
    customHeaders,
    messageMetas: sessionMessageMetas,
    messageBodies,
    messageRenderCache,
    sessionPromptDraft,
    sessionPromptSaving,
    sessionPromptSourceLabel,
    sessionPromptPlaceholder,
    isAutoScrollEnabled,
    hasOlderMessages,
    isLoadingOlderMessages,
    assistantVariantSelections,
    isMessagesLoading,
    isStreaming,
    currentSession,
    error,
    isVisionEnabled,
    MAX_IMAGE_COUNT,
    MAX_IMAGE_MB,
    MAX_IMAGE_EDGE,
    MAX_TOTAL_IMAGE_MB,
    sendLocked: concurrencyLocked,
    sendLockedReason,
    // 控制方法
    setInput,
    setIsComposing,
    setThinkingEnabled,
    setEffort,
    setOllamaThink,
    setNoSaveThisRound,
    setCustomBodyInput,
    setCustomBodyError,
    setSessionPromptDraft,
    addCustomHeader: handleAddCustomHeader,
    updateCustomHeader: patchCustomHeader,
    removeCustomHeader: deleteCustomHeader,
    setSelectedImages,
    handleSend,
    handleStop,
    handleKeyDown,
    handleTextareaChange,
    pickImages,
    onFilesSelected,
    removeImage,
    validateImage,
    handlePaste,
    clearError,
    webSearchEnabled,
    setWebSearchEnabled,
    canUseWebSearch,
    webSearchDisabledNote,
    webSearchScope,
    setWebSearchScope: handleWebSearchScopeChange,
    showWebSearchScope,
    pythonToolEnabled,
    setPythonToolEnabled: setPythonToolEnabledState,
    canUsePythonTool,
    pythonToolDisabledNote,
    skillOptions,
    toggleSkillOption,
    traceEnabled,
    onToggleTrace: handleTraceToggle,
    canUseTrace,
    onSaveSessionPrompt: handleSessionPromptSave,
    canAddCustomHeader: canAddHeader,
    // 文档附件
    documentInputRef,
    attachedDocuments,
    isUploadingDocuments,
    isLoadingDocuments,
    hasReadyDocuments,
    hasProcessingDocuments,
    pickDocuments,
    onDocumentFilesSelected,
    removeDocument,
    cancelDocument,
    clearDocuments,
  }
}
