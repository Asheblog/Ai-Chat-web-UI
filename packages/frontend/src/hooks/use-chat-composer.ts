'use client'

import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useModelsStore } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'

const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
])

export interface ChatComposerImage {
  dataUrl: string
  mime: string
  size: number
}

export function useChatComposer() {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedImages, setSelectedImages] = useState<ChatComposerImage[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(false)
  const [effort, setEffort] = useState<'low' | 'medium' | 'high' | 'unset'>('unset')
  const [ollamaThink, setOllamaThink] = useState<boolean>(false)
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
  const [customBodyInput, setCustomBodyInput] = useState<string>('')
  const [customBodyError, setCustomBodyError] = useState<string | null>(null)
  const [customHeaders, setCustomHeaders] = useState<Array<{ name: string; value: string }>>([])
  const [sessionPromptDraft, setSessionPromptDraft] = useState<string>('')
  const [sessionPromptSaving, setSessionPromptSaving] = useState<boolean>(false)
  const cacheKey = useMemo(() => {
    if (!currentSession?.id) return null
    return `aichat:custom-request:${currentSession.id}`
  }, [currentSession?.id])

  const { systemSettings } = useSettingsStore()
  const { toast } = useToast()
  const { models: allModels, fetchAll: fetchModels } = useModelsStore()
  const { actorState, user } = useAuthStore((state) => ({ actorState: state.actorState, user: state.user }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const {
    maxCount: MAX_IMAGE_COUNT,
    maxMb: MAX_IMAGE_MB,
    maxEdge: MAX_IMAGE_EDGE,
    maxTotalMb: MAX_TOTAL_IMAGE_MB,
  } = DEFAULT_CHAT_IMAGE_LIMITS
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false)
  const [webSearchScope, setWebSearchScope] = useState('webpage')
  const [pythonToolEnabled, setPythonToolEnabled] = useState(false)
  const [pythonToolTouched, setPythonToolTouched] = useState(false)
  const [traceEnabled, setTraceEnabled] = useState(false)
  const tracePreferenceRef = useRef<Record<number, boolean>>({})
  const storedWebSearchPreference = useWebSearchPreferenceStore((state) => state.lastSelection)
  const persistWebSearchPreference = useWebSearchPreferenceStore((state) => state.setLastSelection)
  const storedPythonPreference = usePythonToolPreferenceStore((state) => state.lastSelection)
  const persistPythonPreference = usePythonToolPreferenceStore((state) => state.setLastSelection)
  const scopePreferenceKey = 'web_search_scope_preference'
  const setWebSearchEnabled = useCallback(
    (value: boolean) => {
      setWebSearchEnabledState(value)
      persistWebSearchPreference(value)
    },
    [persistWebSearchPreference],
  )
  const setPythonToolEnabledState = useCallback(
    (value: boolean) => {
      setPythonToolEnabled(value)
      persistPythonPreference(value)
    },
    [persistPythonPreference],
  )

  useEffect(() => {
    if (!cacheKey) {
      setCustomBodyInput('')
      setCustomHeaders([])
      return
    }
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) {
        setCustomBodyInput('')
        setCustomHeaders([])
        return
      }
      const parsed = JSON.parse(raw) as { body?: string; headers?: Array<{ name: string; value: string }> }
      setCustomBodyInput(typeof parsed?.body === 'string' ? parsed.body : '')
      if (Array.isArray(parsed?.headers)) {
        setCustomHeaders(
          parsed.headers
            .filter((item) => item && typeof item.name === 'string' && typeof item.value === 'string')
            .map((item) => ({ name: item.name, value: item.value })),
        )
      } else {
        setCustomHeaders([])
      }
    } catch {
      setCustomBodyInput('')
      setCustomHeaders([])
    }
  }, [cacheKey])

  useEffect(() => {
    if (!cacheKey) return
    try {
      const payload = JSON.stringify({ body: customBodyInput, headers: customHeaders })
      localStorage.setItem(cacheKey, payload)
    } catch {
      // ignore storage errors
    }
  }, [cacheKey, customBodyInput, customHeaders])

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

  const providerSupportsTools = useMemo(() => {
    const provider = activeModel?.provider?.toLowerCase()
    if (!provider) return true
    return provider === 'openai' || provider === 'azure_openai'
  }, [activeModel])

  const isVisionEnabled = useMemo(() => {
    const cap = activeModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const isWebSearchCapable = useMemo(() => {
    const cap = activeModel?.capabilities?.web_search
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const pythonToolCapable = useMemo(() => {
    const cap = activeModel?.capabilities?.code_interpreter
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const canUseWebSearch =
    Boolean(systemSettings?.webSearchAgentEnable && systemSettings?.webSearchHasApiKey) &&
    isWebSearchCapable &&
    providerSupportsTools
  const canUsePythonTool =
    Boolean(systemSettings?.pythonToolEnable) && pythonToolCapable && providerSupportsTools
  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return '管理员未启用联网搜索'
    if (!systemSettings?.webSearchHasApiKey) return '尚未配置搜索 API Key'
    if (!providerSupportsTools) return '当前连接不支持工具调用'
    if (!isWebSearchCapable) return '当前模型未开放联网搜索'
    return undefined
  }, [providerSupportsTools, systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey, isWebSearchCapable])
  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return '管理员未开启 Python 工具'
    if (!providerSupportsTools) return '当前连接不支持工具调用'
    if (!pythonToolCapable) return '当前模型未启用 Python 工具'
    return undefined
  }, [providerSupportsTools, pythonToolCapable, systemSettings?.pythonToolEnable])
  const isMetasoEngine = (systemSettings?.webSearchDefaultEngine || '').toLowerCase() === 'metaso'
  const canUseTrace = Boolean(isAdmin && systemSettings?.taskTraceEnabled)
  const addCustomHeader = useCallback(() => {
    if (customHeaders.length >= 10) {
      toast({
        title: '已达到上限',
        description: '最多添加 10 个自定义请求头',
        variant: 'destructive',
      })
      return
    }
    setCustomHeaders((prev) => [...prev, { name: '', value: '' }])
  }, [customHeaders.length, toast])
  const updateCustomHeader = useCallback(
    (index: number, field: 'name' | 'value', value: string) => {
      setCustomHeaders((prev) =>
        prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
      )
    },
    [],
  )
  const removeCustomHeader = useCallback((index: number) => {
    setCustomHeaders((prev) => prev.filter((_, i) => i !== index))
  }, [])

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

  useEffect(() => {
    if (!canUseWebSearch) {
      if (webSearchEnabled) {
        setWebSearchEnabledState(false)
      }
      return
    }
    const desired =
      typeof storedWebSearchPreference === 'boolean' ? storedWebSearchPreference : true
    if (webSearchEnabled !== desired) {
      setWebSearchEnabledState(desired)
    }
  }, [canUseWebSearch, storedWebSearchPreference, webSearchEnabled])

  useEffect(() => {
    if (!canUsePythonTool) {
      if (pythonToolEnabled) {
        setPythonToolEnabledState(false)
      }
      return
    }
    const desired =
      typeof storedPythonPreference === 'boolean' ? storedPythonPreference : false
    if (pythonToolEnabled !== desired) {
      setPythonToolEnabledState(desired)
    }
  }, [canUsePythonTool, pythonToolEnabled, setPythonToolEnabledState, storedPythonPreference])

  useEffect(() => {
    if (!canUseWebSearch || !isMetasoEngine) {
      setWebSearchScope('webpage')
      return
    }
    const stored = (() => {
      try {
        return localStorage.getItem(scopePreferenceKey) || ''
      } catch {
        return ''
      }
    })()
    const fromSetting = systemSettings?.webSearchScope || 'webpage'
    const next = stored || fromSetting || 'webpage'
    if (next && webSearchScope !== next) {
      setWebSearchScope(next)
    }
    if (!stored && next) {
      try {
        localStorage.setItem(scopePreferenceKey, next)
      } catch {
        // ignore storage error
      }
    }
  }, [canUseWebSearch, isMetasoEngine, systemSettings?.webSearchScope, webSearchScope, scopePreferenceKey])

  useEffect(() => {
    if (!canUseTrace) {
      setTraceEnabled(false)
      return
    }
    if (!currentSession) return
    const stored = tracePreferenceRef.current[currentSession.id]
    if (typeof stored === 'boolean') {
      setTraceEnabled(stored)
    } else {
      setTraceEnabled(Boolean(systemSettings?.taskTraceDefaultOn))
    }
  }, [canUseTrace, currentSession, currentSession?.id, systemSettings?.taskTraceDefaultOn])

  useEffect(() => {
    if (!isVisionEnabled && selectedImages.length > 0) {
      setSelectedImages([])
      toast({
        title: '已清空图片',
        description: '当前模型不支持图片输入',
        variant: 'destructive',
      })
    }
  }, [isVisionEnabled, selectedImages.length, toast])

  const validateImage = useCallback(
    (file: File): Promise<{ ok: boolean; reason?: string; dataUrl?: string; mime?: string; size?: number }> => {
      return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) {
          resolve({ ok: false, reason: '不支持的文件类型' })
          return
        }
        const sizeMB = file.size / (1024 * 1024)
        if (sizeMB > MAX_IMAGE_MB) {
          resolve({ ok: false, reason: `图片大小超过限制（>${MAX_IMAGE_MB}MB）` })
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const img = new Image()
          img.onload = () => {
            const w = img.naturalWidth
            const h = img.naturalHeight
            if (w > MAX_IMAGE_EDGE || h > MAX_IMAGE_EDGE) {
              resolve({ ok: false, reason: `分辨率过大（>${MAX_IMAGE_EDGE}像素）` })
            } else {
              resolve({ ok: true, dataUrl, mime: file.type, size: file.size })
            }
          }
          img.onerror = () => resolve({ ok: false, reason: '图片读取失败' })
          img.src = dataUrl
        }
        reader.onerror = () => resolve({ ok: false, reason: '文件读取失败' })
        reader.readAsDataURL(file)
      })
    },
    [],
  )

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
      let parsedCustomBody: Record<string, any> | undefined
      if (customBodyInput.trim()) {
        try {
          const parsed = JSON.parse(customBodyInput)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('自定义请求体必须是 JSON 对象')
          }
          parsedCustomBody = parsed
          setCustomBodyError(null)
        } catch (err: any) {
          const message = err instanceof Error ? err.message : '自定义请求体解析失败'
          setCustomBodyError(message)
          toast({ title: '发送失败', description: message, variant: 'destructive' })
          return
        }
      } else {
        setCustomBodyError(null)
      }
      const sanitizedHeaders: Array<{ name: string; value: string }> = []
      if (customHeaders.length > 0) {
        for (const item of customHeaders) {
          const name = (item?.name || '').trim()
          const value = (item?.value || '').trim()
          if (!name && !value) continue
          if (!name) {
            toast({ title: '请求头无效', description: '请输入请求头名称', variant: 'destructive' })
            return
          }
          if (name.length > 64) {
            toast({ title: '请求头过长', description: '名称需 ≤ 64 字符', variant: 'destructive' })
            return
          }
          if (value.length > 2048) {
            toast({ title: '请求头值过长', description: '值需 ≤ 2048 字符', variant: 'destructive' })
            return
          }
          const lower = name.toLowerCase()
          if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
            toast({
              title: '请求头被拒绝',
              description: '敏感或被保护的请求头无法覆盖，请更换名称',
              variant: 'destructive',
            })
            return
          }
          const existingIdx = sanitizedHeaders.findIndex((h) => h.name.toLowerCase() === lower)
          if (existingIdx >= 0) {
            sanitizedHeaders.splice(existingIdx, 1)
          }
          if (!value) continue
          sanitizedHeaders.push({ name, value })
        }
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
        customBody: parsedCustomBody,
        customHeaders: sanitizedHeaders.length ? sanitizedHeaders : undefined,
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
    customBodyInput,
    customHeaders,
  ])

  const handleStop = useCallback(() => {
    stopStreaming()
  }, [stopStreaming])

  const handleTraceToggle = useCallback((value: boolean) => {
    if (!currentSession) return
    tracePreferenceRef.current[currentSession.id] = value
    setTraceEnabled(value)
  }, [currentSession])

  const handleWebSearchScopeChange = useCallback((next: string) => {
    setWebSearchScope(next)
    try {
      localStorage.setItem(scopePreferenceKey, next)
    } catch {
      // ignore storage error
    }
  }, [scopePreferenceKey])

  const pickImages = useCallback(() => {
    if (!isVisionEnabled) {
      toast({
        title: '当前模型不支持图片',
        description: '请在模型能力中开启 Vision（连接/模型管理可配置）',
        variant: 'destructive',
      })
      return
    }
    fileInputRef.current?.click()
  }, [isVisionEnabled, toast])

  const onFilesSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0) return
      const existingBytes = selectedImages.reduce((sum, img) => sum + img.size, 0)
      const incomingBytes = files.reduce((sum, f) => sum + f.size, 0)
      const totalMb = (existingBytes + incomingBytes) / (1024 * 1024)
      if (totalMb > MAX_TOTAL_IMAGE_MB) {
        toast({
          title: '超过总大小限制',
          description: `所有图片合计需 ≤ ${MAX_TOTAL_IMAGE_MB}MB，请压缩后再试`,
          variant: 'destructive',
        })
        return
      }
      if (selectedImages.length + files.length > MAX_IMAGE_COUNT) {
        toast({
          title: '超过数量限制',
          description: `每次最多上传 ${MAX_IMAGE_COUNT} 张图片`,
          variant: 'destructive',
        })
        return
      }
      for (const f of files) {
        const r = await validateImage(f)
        if (!r.ok) {
          toast({ title: '图片不符合要求', description: r.reason, variant: 'destructive' })
        } else {
          setSelectedImages((prev) => [...prev, { dataUrl: r.dataUrl!, mime: r.mime!, size: r.size! }])
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [MAX_IMAGE_COUNT, MAX_TOTAL_IMAGE_MB, selectedImages, toast, validateImage],
  )

  const removeImage = useCallback((idx: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

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
    addCustomHeader,
    updateCustomHeader,
    removeCustomHeader,
    setCustomHeaders,
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
    showWebSearchScope: canUseWebSearch && isMetasoEngine,
    pythonToolEnabled,
    setPythonToolEnabled: setPythonToolEnabledState,
    canUsePythonTool,
    pythonToolDisabledNote,
    traceEnabled,
    onToggleTrace: handleTraceToggle,
    canUseTrace,
    onSaveSessionPrompt: handleSessionPromptSave,
  }
}
