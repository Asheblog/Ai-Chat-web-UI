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
import { listSkillCatalog } from '@/features/skills/api'
import {
  useAdvancedRequest,
  useComposerFeatureFlags,
  useImageAttachments,
  useDocumentAttachments,
} from '@/features/chat/composer'
import type { ComposerImage, AttachedDocument } from '@/features/chat/composer'
import { messageKey as toMessageKey } from '@/features/chat/store/utils'

export type { AttachedDocument }


export type ChatComposerImage = ComposerImage

export interface UseChatComposerOptions {
  knowledgeBaseIds?: number[]
}

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96
const AUTO_LOAD_OLDER_TOP_THRESHOLD = 80
const SESSION_SCROLL_STORAGE_KEY = 'aichat:chat-session-scroll'
const BUILTIN_SKILL_SLUGS = new Set([
  'web-search',
  'python-runner',
  'url-reader',
  'document-search',
  'knowledge-base-search',
])

const readSessionScrollState = (): Record<number, number> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(SESSION_SCROLL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const next: Record<number, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const sessionId = Number.parseInt(key, 10)
      const top = Number(value)
      if (!Number.isFinite(sessionId) || !Number.isFinite(top)) continue
      next[sessionId] = Math.max(0, Math.floor(top))
    }
    return next
  } catch {
    return {}
  }
}

const writeSessionScrollState = (state: Record<number, number>) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_SCROLL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function useChatComposer(options?: UseChatComposerOptions) {
  const knowledgeBaseIds = options?.knowledgeBaseIds
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)
  const autoScrollEnabledRef = useRef(true)
  const scrollStateRef = useRef<Record<number, number>>({})
  const scrollPersistTimerRef = useRef<number | null>(null)
  const pendingRestoreSessionRef = useRef<number | null>(null)
  const prependAnchorRef = useRef<{ sessionId: number; scrollTop: number; scrollHeight: number } | null>(null)
  const loadingOlderRef = useRef(false)
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
  const [extraSkillsCatalog, setExtraSkillsCatalog] = useState<
    Array<{ slug: string; displayName: string; description?: string | null }>
  >([])
  const [enabledExtraSkills, setEnabledExtraSkills] = useState<string[]>([])

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

  useEffect(() => {
    let cancelled = false
    listSkillCatalog()
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.data) ? response.data : []
        const filtered = list
          .map((item) => ({
            slug: String(item.slug || '').trim(),
            displayName: String(item.displayName || item.slug || '').trim(),
            description: item.description || null,
          }))
          .filter((item) => item.slug.length > 0 && !BUILTIN_SKILL_SLUGS.has(item.slug))
        setExtraSkillsCatalog(filtered)
        setEnabledExtraSkills((prev) =>
          prev.filter((slug) => filtered.some((item) => item.slug === slug)),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setExtraSkillsCatalog([])
          setEnabledExtraSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const skillOptions = useMemo(() => {
    return extraSkillsCatalog.map((item) => ({
      slug: item.slug,
      label: item.displayName || item.slug,
      description: item.description || undefined,
      enabled: enabledExtraSkills.includes(item.slug),
    }))
  }, [enabledExtraSkills, extraSkillsCatalog])

  const toggleSkillOption = useCallback((slug: string, enabled: boolean) => {
    const normalized = slug.trim()
    if (!normalized) return
    setEnabledExtraSkills((prev) => {
      if (enabled) {
        if (prev.includes(normalized)) return prev
        return [...prev, normalized]
      }
      return prev.filter((item) => item !== normalized)
    })
  }, [])

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

  const setAutoScrollState = useCallback((enabled: boolean) => {
    autoScrollEnabledRef.current = enabled
    setIsAutoScrollEnabled((prev) => (prev === enabled ? prev : enabled))
  }, [])

  const getScrollViewport = useCallback((): HTMLElement | null => {
    if (!scrollAreaRef.current) return null
    return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
  }, [])

  const isNearBottom = useCallback((element: HTMLElement) => {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    return distance <= AUTO_SCROLL_BOTTOM_THRESHOLD
  }, [])

  const scrollToBottom = useCallback(
    (force = false) => {
      const scrollElement = getScrollViewport()
      if (!scrollElement) return
      if (!force && !autoScrollEnabledRef.current) return
      scrollElement.scrollTop = scrollElement.scrollHeight
      if (!autoScrollEnabledRef.current) {
        setAutoScrollState(true)
      }
    },
    [getScrollViewport, setAutoScrollState],
  )

  const persistScrollState = useCallback(() => {
    writeSessionScrollState(scrollStateRef.current)
  }, [])

  const schedulePersistScrollState = useCallback(() => {
    if (typeof window === 'undefined') return
    if (scrollPersistTimerRef.current !== null) return
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null
      persistScrollState()
    }, 120)
  }, [persistScrollState])

  const saveSessionScrollTop = useCallback(
    (sessionId: number | null, top: number) => {
      if (sessionId == null) return
      if (!Number.isFinite(top)) return
      const normalized = Math.max(0, Math.floor(top))
      if (scrollStateRef.current[sessionId] === normalized) return
      scrollStateRef.current = {
        ...scrollStateRef.current,
        [sessionId]: normalized,
      }
      schedulePersistScrollState()
    },
    [schedulePersistScrollState],
  )

  useEffect(() => {
    scrollStateRef.current = readSessionScrollState()
  }, [])

  useEffect(() => {
    return () => {
      if (scrollPersistTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(scrollPersistTimerRef.current)
        scrollPersistTimerRef.current = null
      }
      persistScrollState()
    }
  }, [persistScrollState])

  useEffect(() => {
    const sessionId = currentSession?.id ?? null
    pendingRestoreSessionRef.current = sessionId
    loadingOlderRef.current = false
    prependAnchorRef.current = null
    if (sessionId == null) return
    const savedTop = scrollStateRef.current[sessionId]
    if (Number.isFinite(savedTop)) {
      setAutoScrollState(false)
    } else {
      setAutoScrollState(true)
    }
  }, [currentSession?.id, setAutoScrollState])

  useEffect(() => {
    const sessionId = currentSession?.id ?? null
    if (sessionId == null) return
    if (pendingRestoreSessionRef.current !== sessionId) return

    const scrollElement = getScrollViewport()
    if (!scrollElement) return
    if (isMessagesLoading && sessionMessageMetas.length === 0) return

    pendingRestoreSessionRef.current = null
    const savedTop = scrollStateRef.current[sessionId]
    const hasSavedTop = Number.isFinite(savedTop)
    if (typeof window === 'undefined') return

    const frame = window.requestAnimationFrame(() => {
      const maxTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      const targetTop = hasSavedTop
        ? Math.max(0, Math.min(Number(savedTop), maxTop))
        : maxTop
      scrollElement.scrollTop = targetTop
      saveSessionScrollTop(sessionId, scrollElement.scrollTop)
      setAutoScrollState(isNearBottom(scrollElement))
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [
    currentSession?.id,
    getScrollViewport,
    isMessagesLoading,
    isNearBottom,
    saveSessionScrollTop,
    sessionMessageMetas.length,
    setAutoScrollState,
  ])

  useEffect(() => {
    const anchor = prependAnchorRef.current
    if (!anchor) return
    if (currentSession?.id !== anchor.sessionId) {
      prependAnchorRef.current = null
      return
    }
    if (currentSessionPagination?.isLoadingOlder) return
    const scrollElement = getScrollViewport()
    if (!scrollElement) return
    if (typeof window === 'undefined') return

    const frame = window.requestAnimationFrame(() => {
      const delta = scrollElement.scrollHeight - anchor.scrollHeight
      if (delta > 0) {
        scrollElement.scrollTop = Math.max(0, anchor.scrollTop + delta)
        saveSessionScrollTop(anchor.sessionId, scrollElement.scrollTop)
      }
      prependAnchorRef.current = null
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [
    currentSession?.id,
    currentSessionPagination?.isLoadingOlder,
    getScrollViewport,
    saveSessionScrollTop,
    sessionMessageMetas.length,
  ])

  useEffect(() => {
    return () => {
      const sessionId = currentSession?.id ?? null
      const scrollElement = getScrollViewport()
      if (!scrollElement || sessionId == null) return
      saveSessionScrollTop(sessionId, scrollElement.scrollTop)
    }
  }, [currentSession?.id, getScrollViewport, saveSessionScrollTop])

  useEffect(() => {
    const scrollElement = getScrollViewport()
    if (!scrollElement) return

    const updateAutoScrollState = () => {
      setAutoScrollState(isNearBottom(scrollElement))
      saveSessionScrollTop(currentSession?.id ?? null, scrollElement.scrollTop)
      if (!currentSession) return
      if (isMessagesLoading) return
      if (scrollElement.scrollTop > AUTO_LOAD_OLDER_TOP_THRESHOLD) return
      if (!currentSessionPagination?.hasOlder || currentSessionPagination.isLoadingOlder) return
      if (loadingOlderRef.current) return
      if (prependAnchorRef.current) return

      loadingOlderRef.current = true
      prependAnchorRef.current = {
        sessionId: currentSession.id,
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
      }
      void loadOlderMessages(currentSession.id).finally(() => {
        loadingOlderRef.current = false
      })
    }

    updateAutoScrollState()
    scrollElement.addEventListener('scroll', updateAutoScrollState, { passive: true })

    return () => {
      scrollElement.removeEventListener('scroll', updateAutoScrollState)
    }
  }, [
    currentSession,
    currentSessionPagination?.hasOlder,
    currentSessionPagination?.isLoadingOlder,
    getScrollViewport,
    isMessagesLoading,
    isNearBottom,
    loadOlderMessages,
    saveSessionScrollTop,
    setAutoScrollState,
  ])

  useEffect(() => {
    scrollToBottom()
  }, [sessionMessageMetas.length, scrollToBottom])

  const streamScrollAnchor = useMemo(() => {
    if (!isStreaming || sessionMessageMetas.length === 0) return 'idle'
    const lastMeta = sessionMessageMetas[sessionMessageMetas.length - 1]
    if (!lastMeta || lastMeta.role !== 'assistant') {
      return `stream:${sessionMessageMetas.length}`
    }
    const key = toMessageKey(lastMeta.id)
    const body = messageBodies[key]
    return `stream:${key}:${body?.version ?? 0}:${body?.reasoningVersion ?? 0}`
  }, [isStreaming, messageBodies, sessionMessageMetas])

  useEffect(() => {
    if (!isStreaming) return
    scrollToBottom()
  }, [isStreaming, scrollToBottom, streamScrollAnchor])

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
      const enabledSkills: string[] = [...enabledExtraSkills]
      const skillOverrides: Record<string, Record<string, unknown>> = {}
      if (webSearchEnabled && canUseWebSearch) {
        enabledSkills.push('web-search', 'url-reader')
        const webSearchOverride: Record<string, unknown> = {}
        if (isMetasoEngine) webSearchOverride.scope = webSearchScope
        if (systemSettings?.webSearchIncludeSummary) webSearchOverride.includeSummary = true
        if (systemSettings?.webSearchIncludeRaw) webSearchOverride.includeRawContent = true
        if (Object.keys(webSearchOverride).length > 0) {
          skillOverrides['web-search'] = webSearchOverride
        }
      }
      if (pythonToolEnabled && canUsePythonTool) {
        enabledSkills.push('python-runner')
      }
      const skillsPayload =
        enabledSkills.length > 0
          ? {
              enabled: Array.from(new Set(enabledSkills)),
              ...(Object.keys(skillOverrides).length > 0 ? { overrides: skillOverrides } : {}),
            }
          : undefined
      const options = {
        reasoningEnabled: thinkingEnabled,
        reasoningEffort: effort !== 'unset' ? (effort as any) : undefined,
        ollamaThink: thinkingEnabled ? ollamaThink : undefined,
        saveReasoning: !noSaveThisRound,
        skills: skillsPayload,
        traceEnabled: canUseTrace ? traceEnabled : undefined,
        customBody: requestPayload.customBody,
        customHeaders: requestPayload.customHeaders,
        knowledgeBaseIds: knowledgeBaseIds?.length ? knowledgeBaseIds : undefined,
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
    enabledExtraSkills,
    canUsePythonTool,
    pythonToolEnabled,
    setSelectedImages,
    knowledgeBaseIds,
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
