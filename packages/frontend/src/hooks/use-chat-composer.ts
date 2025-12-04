'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
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
} from '@/features/chat/composer'
import type { ComposerImage } from '@/features/chat/composer'


export type ChatComposerImage = ComposerImage

export function useChatComposer() {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [noSaveThisRound, setNoSaveThisRound] = useState<boolean>(false)
  const {
    currentSession,
    messageMetas,
    messageBodies,
    messageRenderCache,
    isMessagesLoading,
    isStreaming,
    activeStreamCount,
    streamMessage,
    stopStreaming,
    clearError,
    error,
    assistantVariantSelections,
    updateSessionPrefs,
  } = useChatStore()

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
      fetchModels().catch(() => {})
    }
  }, [modelsCount, fetchModels])

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

  useEffect(() => {
    if (!scrollAreaRef.current) return
    const scrollElement = scrollAreaRef.current.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null
    if (scrollElement) {
      scrollElement.scrollTop = scrollElement.scrollHeight
    }
  }, [messageMetas.length])

  useEffect(() => {
    if (!textareaRef.current) return
    const active = typeof document !== 'undefined' ? document.activeElement : null
    const advancedEditing = active instanceof HTMLElement && active.dataset?.advancedInput === 'true'
    if (advancedEditing) return
    if (active && active !== document.body && active !== textareaRef.current) return
    textareaRef.current.focus()
  }, [isStreaming])

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

  const {
    fileInputRef,
    selectedImages,
    setSelectedImages,
    pickImages,
    onFilesSelected,
    removeImage,
    validateImage,
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
    : null

  const systemPromptFallback = (systemSettings?.chatSystemPrompt ?? '').trim()
  const sessionPromptSourceLabel =
    currentSession?.systemPrompt && currentSession.systemPrompt.trim()
      ? '当前会话自定义生效'
      : systemPromptFallback
        ? '使用全局提示词'
        : '未设置提示词'
  const sessionPromptPlaceholder = systemPromptFallback
    ? `留空以继承全局提示词：${systemPromptFallback.slice(0, 60)}${systemPromptFallback.length > 60 ? '...' : ''}`
    : '为空则不附加系统提示词'

  const handleSend = useCallback(async () => {
    if (!input.trim() || !currentSession) return
    if (concurrencyLocked) {
      toast({
        title: '生成任务已达上限',
        description: `当前共有 ${totalActiveStreams}/${maxConcurrentStreams} 个请求进行中，请稍候或先停止部分任务。`,
        variant: 'destructive',
      })
      return
    }
    const message = input.trim()
    const prevSelectedImages = selectedImages
    setInput('')
    clearError()
    try {
      const imagesPayload =
        isVisionEnabled && prevSelectedImages.length
          ? prevSelectedImages.map((img) => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
          : undefined
      if (prevSelectedImages.length > 0) {
        setSelectedImages([])
      }
      const requestPayload = buildRequestPayload()
      if (!requestPayload.ok) {
        toast({ title: '发送失败', description: requestPayload.reason, variant: 'destructive' })
        return
      }
      const featureFlags: Record<string, any> = {}
      if (webSearchEnabled && canUseWebSearch) {
        featureFlags.web_search = true
        if (isMetasoEngine) featureFlags.web_search_scope = webSearchScope
        if (systemSettings?.webSearchIncludeSummary) featureFlags.web_search_include_summary = true
        if (systemSettings?.webSearchIncludeRaw) featureFlags.web_search_include_raw = true
      }
      if (pythonToolEnabled && canUsePythonTool) {
        featureFlags.python_tool = true
      }
      const options = {
        reasoningEnabled: thinkingEnabled,
        reasoningEffort: effort !== 'unset' ? (effort as any) : undefined,
        ollamaThink: thinkingEnabled ? ollamaThink : undefined,
        saveReasoning: !noSaveThisRound,
        features: Object.keys(featureFlags).length ? featureFlags : undefined,
        traceEnabled: canUseTrace ? traceEnabled : undefined,
        customBody: requestPayload.customBody,
        customHeaders: requestPayload.customHeaders,
      }
      await streamMessage(currentSession.id, message, imagesPayload, options)
      setNoSaveThisRound(false)
    } catch (error) {
      if (prevSelectedImages.length > 0) {
        setSelectedImages(prevSelectedImages)
      }
      console.error('Failed to send message:', error)
      toast({
        title: '发送失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    }
  }, [
    input,
    currentSession,
    concurrencyLocked,
    totalActiveStreams,
    maxConcurrentStreams,
    clearError,
    isVisionEnabled,
    selectedImages,
    thinkingEnabled,
    effort,
    ollamaThink,
    noSaveThisRound,
    streamMessage,
    toast,
    webSearchEnabled,
    canUseWebSearch,
    webSearchScope,
    isMetasoEngine,
    systemSettings?.webSearchIncludeSummary,
    systemSettings?.webSearchIncludeRaw,
    canUseTrace,
    traceEnabled,
    buildRequestPayload,
    canUsePythonTool,
    pythonToolEnabled,
    setSelectedImages,
  ])

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
    messageMetas,
    messageBodies,
    messageRenderCache,
    sessionPromptDraft,
    sessionPromptSaving,
    sessionPromptSourceLabel,
    sessionPromptPlaceholder,
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
    traceEnabled,
    onToggleTrace: handleTraceToggle,
    canUseTrace,
    onSaveSessionPrompt: handleSessionPromptSave,
    canAddCustomHeader: canAddHeader,
  }
}
