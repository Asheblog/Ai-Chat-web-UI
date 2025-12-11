import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useModelsStore } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import {
  useModelPreferenceStore,
  persistPreferredModel,
  findPreferredModel,
} from '@/store/model-preference-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'
import { useAdvancedRequest, useDocumentAttachments, useImageAttachments } from '@/features/chat/composer'


export const useWelcomeScreenViewModel = () => {
  const router = useRouter()
  const { toast } = useToast()
  const { createSession, streamMessage } = useChatStore()
  const { systemSettings, publicBrandText } = useSettingsStore()
  const { models, fetchAll } = useModelsStore()
  const { actorState, quota, actor } = useAuthStore((state) => ({
    actorState: state.actorState,
    quota: state.quota,
    actor: state.actor,
  }))

  const isAnonymous = actorState !== 'authenticated'
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota
      ? typeof quota.remaining === 'number'
        ? quota.remaining
        : Math.max(0, quota.dailyLimit - quota.usedCount)
      : null
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaLabel = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)

  const [query, setQuery] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [thinkingTouched, setThinkingTouched] = useState(false)
  const [effort, setEffort] = useState<'unset' | 'low' | 'medium' | 'high'>('unset')
  const [effortTouched, setEffortTouched] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [webSearchTouched, setWebSearchTouched] = useState(false)
  const [pythonToolEnabled, setPythonToolEnabled] = useState(false)
  const [pythonToolTouched, setPythonToolTouched] = useState(false)
  const [webSearchScope, setWebSearchScope] = useState('webpage')
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false)
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [sessionPromptTouched, setSessionPromptTouched] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [showExpand, setShowExpand] = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const actorType = actor?.type ?? 'anonymous'
  const preferred = useModelPreferenceStore((state) => state.preferred)
  const modelsCount = models?.length ?? 0
  const storedWebSearchPreference = useWebSearchPreferenceStore((state) => state.lastSelection)
  const persistWebSearchPreference = useWebSearchPreferenceStore((state) => state.setLastSelection)
  const storedPythonPreference = usePythonToolPreferenceStore((state) => state.lastSelection)
  const persistPythonPreference = usePythonToolPreferenceStore((state) => state.setLastSelection)

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
  } = useAdvancedRequest({ sessionId: null })

  const {
    fileInputRef,
    selectedImages,
    setSelectedImages,
    pickImages,
    onFilesSelected,
    removeImage,
  } = useImageAttachments({
    isVisionEnabled: true,
    limits: DEFAULT_CHAT_IMAGE_LIMITS,
    toast,
  })

  const {
    fileInputRef: documentInputRef,
    documents: attachedDocuments,
    pickDocuments,
    onFilesSelected: onDocumentFilesSelected,
    removeDocument,
    clearDocuments,
  } = useDocumentAttachments({
    sessionId: null,
    limits: {
      maxFileSize: 50 * 1024 * 1024,
      allowedTypes: ['pdf', 'docx', 'doc', 'csv', 'txt', 'md'],
    },
    toast,
  })

  const brandText = (systemSettings?.brandText ?? publicBrandText ?? '').trim() || 'AIChat'
  const basePlaceholder = quota
    ? quotaExhausted
      ? '额度已用尽，请登录或等待次日重置'
      : `本日消息发送额度剩余 ${quotaLabel}`
    : '输入消息（Shift+Enter 换行）'

  const MAX_AUTO_HEIGHT = 200
  const scopePreferenceKey = 'web_search_scope_preference'
  const missingPreferredRef = useRef(false)

  useEffect(() => {
    missingPreferredRef.current = false
  }, [preferred?.modelId])

  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => {})
    }
  }, [modelsCount, fetchAll])

  useEffect(() => {
    if (modelsCount === 0) return
    if (selectedModelId && models?.some((m) => m.id === selectedModelId)) {
      return
    }
    let resolved = findPreferredModel(models || [], preferred) || undefined
    if (!resolved && preferred && !missingPreferredRef.current) {
      missingPreferredRef.current = true
      toast({
        title: '模型已更新',
        description: '上一次选择的模型暂不可用，已为你切换到推荐模型。',
      })
    }
    if (!resolved) {
      resolved = models?.[0]
    }
    if (resolved) {
      setSelectedModelId(resolved.id)
      void persistPreferredModel(resolved, { actorType })
    }
  }, [actorType, models, modelsCount, preferred, selectedModelId, toast])

  const selectedModel = useMemo(
    () => (models || []).find((item) => item.id === selectedModelId) ?? null,
    [models, selectedModelId],
  )

  const isVisionEnabled = useMemo(() => {
    const cap = selectedModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const isWebSearchCapable = useMemo(() => {
    const cap = selectedModel?.capabilities?.web_search
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const pythonToolCapable = useMemo(() => {
    const cap = selectedModel?.capabilities?.code_interpreter
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const providerSupportsTools = useMemo(() => {
    const provider = selectedModel?.provider?.toLowerCase()
    if (!provider) return true
    return provider === 'openai' || provider === 'azure_openai'
  }, [selectedModel])

  const canUseWebSearch = Boolean(
    systemSettings?.webSearchAgentEnable &&
      systemSettings?.webSearchHasApiKey &&
      isWebSearchCapable &&
      providerSupportsTools,
  )
  const canUsePythonTool = Boolean(systemSettings?.pythonToolEnable) && pythonToolCapable && providerSupportsTools

  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return '管理员未启用联网搜索'
    if (!systemSettings?.webSearchHasApiKey) return '尚未配置搜索 API Key'
    if (!providerSupportsTools) return '当前连接不支持工具调用'
    if (!isWebSearchCapable) return '该模型未启用联网搜索'
    return undefined
  }, [isWebSearchCapable, providerSupportsTools, systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey])

  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return '管理员未开启 Python 工具'
    if (!providerSupportsTools) return '当前连接不支持工具调用'
    if (!pythonToolCapable) return '该模型未启用 Python 工具'
    return undefined
  }, [providerSupportsTools, pythonToolCapable, systemSettings?.pythonToolEnable])

  const isMetasoEngine = (systemSettings?.webSearchDefaultEngine || '').toLowerCase() === 'metaso'
  const showWebSearchScope = canUseWebSearch && isMetasoEngine

  useEffect(() => {
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const raw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'unset' | 'low' | 'medium' | 'high' = raw && raw !== '' ? raw : 'unset'
    if (!thinkingTouched) setThinkingEnabled(sysEnabled)
    if (!effortTouched) setEffort(sysEffort)
    if (!sessionPromptTouched) {
      setSessionPromptDraft(systemSettings?.chatSystemPrompt || '')
    }
  }, [
    systemSettings?.reasoningEnabled,
    systemSettings?.openaiReasoningEffort,
    systemSettings?.chatSystemPrompt,
    thinkingTouched,
    effortTouched,
    sessionPromptTouched,
  ])

  useEffect(() => {
    if (!isVisionEnabled && selectedImages.length > 0) {
      setSelectedImages([])
      toast({
        title: '已清空图片',
        description: '当前模型不支持图片输入',
        variant: 'destructive',
      })
    }
  }, [isVisionEnabled, selectedImages.length, setSelectedImages, toast])

  useEffect(() => {
    if (!canUseWebSearch) {
      if (webSearchEnabled) {
        setWebSearchEnabled(false)
      }
      return
    }
    if (typeof storedWebSearchPreference === 'boolean') {
      setWebSearchEnabled(storedWebSearchPreference)
      if (!webSearchTouched) setWebSearchTouched(true)
      return
    }
    if (!webSearchTouched && !webSearchEnabled) {
      setWebSearchEnabled(true)
    }
  }, [canUseWebSearch, storedWebSearchPreference, webSearchEnabled, webSearchTouched])

  useEffect(() => {
    if (!canUsePythonTool) {
      if (pythonToolEnabled) {
        setPythonToolEnabled(false)
      }
      return
    }
    if (typeof storedPythonPreference === 'boolean') {
      setPythonToolEnabled(storedPythonPreference)
      if (!pythonToolTouched) setPythonToolTouched(true)
      return
    }
    if (!pythonToolTouched) {
      setPythonToolEnabled(false)
    }
  }, [canUsePythonTool, pythonToolEnabled, pythonToolTouched, storedPythonPreference])

  useEffect(() => {
    if (!showWebSearchScope) {
      if (webSearchScope !== 'webpage') {
        setWebSearchScope('webpage')
      }
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
  }, [showWebSearchScope, systemSettings?.webSearchScope, webSearchScope])

  const handleTextareaChange = useCallback((value: string) => {
    setQuery(value)
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    const nextHeight = Math.min(textareaRef.current.scrollHeight, MAX_AUTO_HEIGHT)
    textareaRef.current.style.height = `${nextHeight}px`
    setShowExpand(textareaRef.current.scrollHeight > MAX_AUTO_HEIGHT)
  }, [])

  const handleAddCustomHeader = useCallback(() => {
    const result = appendCustomHeader()
    if (!result.ok && result.reason) {
      toast({ title: '已达到上限', description: result.reason, variant: 'destructive' })
    }
  }, [appendCustomHeader, toast])

  const handleHeaderChange = useCallback(
    (index: number, field: 'name' | 'value', value: string) => {
      patchCustomHeader(index, field, value)
    },
    [patchCustomHeader],
  )

  const handleRemoveHeader = useCallback(
    (index: number) => {
      deleteCustomHeader(index)
    },
    [deleteCustomHeader],
  )

  const handleModelChange = useCallback(
    (model: { id: string }) => {
      setSelectedModelId(model.id)
      const matched = (models || []).find((m) => m.id === model.id)
      if (matched) {
        void persistPreferredModel(matched, { actorType })
      }
    },
    [actorType, models],
  )

  const handlePickImages = useCallback(() => {
    if (quotaExhausted) {
      toast({
        title: '额度已用尽',
        description: '请登录或等待次日重置额度',
        variant: 'destructive',
      })
      return
    }
    if (!isVisionEnabled) {
      toast({
        title: '当前模型不支持图片',
        description: '请切换到支持图片的模型',
        variant: 'destructive',
      })
      return
    }
    pickImages()
  }, [isVisionEnabled, pickImages, quotaExhausted, toast])

  const canCreate = Boolean(selectedModelId)
  const creationDisabled = !canCreate || isCreating || quotaExhausted

  const handleCreate = useCallback(async () => {
    if (!canCreate || !selectedModelId || isCreating) return
    if (quotaExhausted) {
      toast({
        title: '匿名额度已用尽',
        description: '请登录账户或等待次日额度重置',
        variant: 'destructive',
      })
      return
    }

    setIsCreating(true)
    const text = query.trim()

    try {
      const requestPayload = buildRequestPayload()
      if (!requestPayload.ok) {
        toast({ title: '创建失败', description: requestPayload.reason, variant: 'destructive' })
        return
      }

      const title = text ? text.slice(0, 50) : '新的对话'
      const matchedModel = (models || []).find((m) => m.id === selectedModelId)
      const normalizedPrompt = sessionPromptDraft.trim()
      const created = await createSession(
        selectedModelId,
        title,
        matchedModel?.connectionId,
        matchedModel?.rawId,
        normalizedPrompt || undefined,
      )
      if (created?.id) {
        if (attachedDocuments.length) {
          for (const doc of attachedDocuments) {
            try {
              await fetch(`/api/documents/${doc.id}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ sessionId: created.id }),
              })
            } catch (error) {
              console.warn('Attach document failed', error)
              toast({
                title: '文档附加失败',
                description: `${doc.originalName} 未能附加到会话，可稍后在会话内重试`,
                variant: 'destructive',
              })
            }
          }
        }
        router.push(`/main/${created.id}`)
      }

      try {
        const session = useChatStore.getState().currentSession
        if (session && (thinkingTouched || effortTouched || sessionPromptTouched)) {
          const prefs: Record<string, any> = {}
          if (thinkingTouched) prefs.reasoningEnabled = !!thinkingEnabled
          if (effortTouched && effort !== 'unset') prefs.reasoningEffort = effort
          if (sessionPromptTouched) prefs.systemPrompt = sessionPromptDraft.trim() || null
          if (Object.keys(prefs).length > 0) {
            await useChatStore.getState().updateSessionPrefs(session.id, prefs)
          }
        }
      } catch {
        // ignore preference sync errors
      }

      if (text) {
        const session = useChatStore.getState().currentSession
        if (session) {
          const imagesPayload =
            selectedImages.length > 0
              ? selectedImages.map((img) => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
              : undefined
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
          const options: Record<string, any> = {}
          if (thinkingTouched) options.reasoningEnabled = thinkingEnabled
          if (effortTouched && effort !== 'unset') options.reasoningEffort = effort
          if (Object.keys(featureFlags).length > 0) options.features = featureFlags
          if (requestPayload.customBody) options.customBody = requestPayload.customBody
          if (requestPayload.customHeaders && requestPayload.customHeaders.length) {
            options.customHeaders = requestPayload.customHeaders
          }
          await streamMessage(
            session.id,
            text,
            imagesPayload,
            Object.keys(options).length ? options : undefined,
          )
          setSelectedImages([])
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
          clearDocuments()
          if (documentInputRef.current) {
            documentInputRef.current.value = ''
          }
        }
      }
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
      setQuery('')
    }
  }, [
    canCreate,
    selectedModelId,
    isCreating,
    quotaExhausted,
    query,
    toast,
    buildRequestPayload,
    models,
    sessionPromptDraft,
    createSession,
    router,
    thinkingTouched,
    thinkingEnabled,
    effortTouched,
    effort,
    sessionPromptTouched,
    setSelectedImages,
    streamMessage,
    selectedImages,
    canUseWebSearch,
    webSearchEnabled,
    isMetasoEngine,
    webSearchScope,
    systemSettings?.webSearchIncludeSummary,
    systemSettings?.webSearchIncludeRaw,
    canUsePythonTool,
    pythonToolEnabled,
    fileInputRef,
    attachedDocuments,
    clearDocuments,
    documentInputRef,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault()
        if (!isCreating) {
          handleCreate()
        }
      }
    },
    [handleCreate, isComposing, isCreating],
  )

  const handleExpandApply = useCallback(() => {
    setQuery(expandDraft)
    setExpandOpen(false)
    handleTextareaChange(expandDraft)
  }, [expandDraft, handleTextareaChange])

  const footerNote = `${brandText} 可能生成不准确或不完整的内容，请自行核实关键信息。`

  return {
    header: {
      selectedModelId,
      onModelChange: handleModelChange,
      disabled: creationDisabled,
      isCreating,
    },
    hero: {
      quotaExhausted,
    },
    form: {
      query,
      isComposing,
      setIsComposing,
      textareaRef,
      basePlaceholder,
      creationDisabled,
      isCreating,
      showExpand,
      onTextareaChange: handleTextareaChange,
      onKeyDown: handleKeyDown,
      onSubmit: handleCreate,
      onOpenExpand: () => {
        setExpandDraft(query)
        setExpandOpen(true)
      },
      expand: {
        open: expandOpen,
        draft: expandDraft,
        onChange: setExpandDraft,
        onClose: () => setExpandOpen(false),
        onApply: handleExpandApply,
      },
      attachments: {
        selectedImages,
        fileInputRef,
        onRemoveImage: removeImage,
        onFilesSelected,
        onPickImages: handlePickImages,
        documents: attachedDocuments,
        onRemoveDocument: removeDocument,
        onPickDocuments: pickDocuments,
        onDocumentFilesSelected,
        documentInputRef,
      },
      advancedOptions: {
        disabled: creationDisabled,
        thinkingEnabled,
        onToggleThinking: (value: boolean) => {
          setThinkingTouched(true)
          setThinkingEnabled(value)
        },
        effort,
        onEffortChange: (value: 'unset' | 'low' | 'medium' | 'high') => {
          setEffortTouched(true)
          setEffort(value)
        },
        webSearchEnabled,
        onToggleWebSearch: (value: boolean) => {
          const nextValue = canUseWebSearch && !!value
          setWebSearchTouched(true)
          setWebSearchEnabled(nextValue)
          persistWebSearchPreference(nextValue)
        },
        canUseWebSearch,
        showWebSearchScope,
        webSearchScope,
        onWebSearchScopeChange: (value: string) => {
          setWebSearchScope(value)
          try {
            localStorage.setItem(scopePreferenceKey, value)
          } catch {
            // ignore storage error
          }
        },
        webSearchDisabledNote,
        pythonToolEnabled,
        onTogglePythonTool: (value: boolean) => {
          const nextValue = canUsePythonTool && !!value
          setPythonToolTouched(true)
          setPythonToolEnabled(nextValue)
          persistPythonPreference(nextValue)
        },
        canUsePythonTool,
        pythonToolDisabledNote,
        onOpenAdvanced: () => setAdvancedOpen(true),
        onOpenSessionPrompt: () => setSessionPromptOpen(true),
      },
      advancedDialog: {
        open: advancedOpen,
        onClose: () => setAdvancedOpen(false),
        customHeaders,
        onAddHeader: handleAddCustomHeader,
        onHeaderChange: handleHeaderChange,
        onRemoveHeader: handleRemoveHeader,
        canAddHeader,
        customBodyInput,
        onCustomBodyChange: setCustomBodyInput,
        customBodyError,
      },
      sessionPromptDialog: {
        open: sessionPromptOpen,
        value: sessionPromptDraft,
        onChange: (value: string) => {
          setSessionPromptTouched(true)
          setSessionPromptDraft(value)
        },
        onClose: () => setSessionPromptOpen(false),
        onConfirm: () => {
          setSessionPromptTouched(true)
          setSessionPromptOpen(false)
        },
        onClear: () => {
          setSessionPromptTouched(true)
          setSessionPromptDraft('')
        },
        placeholder: systemSettings?.chatSystemPrompt
          ? `留空以继承全局提示词：${systemSettings.chatSystemPrompt.slice(0, 80)}${
              systemSettings.chatSystemPrompt.length > 80 ? '...' : ''
            }`
          : '留空将使用默认提示词：今天日期是{day time}（{day time} 会替换为服务器当前时间）',
      },
    },
    footerNote,
  }
}
