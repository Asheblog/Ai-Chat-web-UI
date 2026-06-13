import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { useRouter } from 'next/navigation'
import { shallow } from 'zustand/shallow'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import {
  useModelPreferenceStore,
  persistPreferredModel,
  findPreferredModel,
  modelKeyFor,
} from '@/store/model-preference-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'
import { useAdvancedRequest, useImageAttachments } from '@/features/chat/composer'
import { buildWorkspaceFileManifest } from '@/features/chat/composer/workspace-file-manifest'
import { useKnowledgeBase } from '@/hooks/use-knowledge-base'
import { useSkillsSelection } from '@/hooks/use-skills-selection'
import { useDragDrop } from '@/hooks/use-drag-drop'
import { updateSessionSkillBinding } from '@/features/skills/api'

export const useWelcomeScreenViewModel = () => {
  const router = useRouter()
  const { toast } = useToast()
  const { createSession, streamMessage } = useChatStore(
    (state) => ({
      createSession: state.createSession,
      streamMessage: state.streamMessage,
    }),
    shallow,
  )
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
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [thinkingTouched, setThinkingTouched] = useState(false)
  const [effort, setEffort] = useState<'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'>('unset')
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
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false)
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
    selectedImages,
    setSelectedImages,
    removeImage,
    validateImage,
    handlePaste,
  } = useImageAttachments({
    isVisionEnabled: true,
    limits: DEFAULT_CHAT_IMAGE_LIMITS,
    toast,
  })

  // 统一附件输入（不含 onAttachmentsSelected — 其定义在 isVisionEnabled 之后）
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const pickAttachments = useCallback(() => {
    if (quotaExhausted) {
      toast({
        title: '额度已用尽',
        description: '请登录或等待次日重置额度',
        variant: 'destructive',
      })
      return
    }
    attachmentInputRef.current?.click()
  }, [quotaExhausted, toast])
  const [draftFiles, setDraftFiles] = useState<Array<{ id: string; file: File }>>([])
  const removeWorkspaceFile = useCallback((workspacePath: string) => {
    setDraftFiles((prev) => prev.filter((d) => d.id !== workspacePath))
  }, [])
  const clearWorkspaceFiles = useCallback(() => {
    setDraftFiles([])
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = ''
    }
  }, [])
  const draftWorkspaceFiles = useMemo(
    () =>
      draftFiles.map(({ id, file }) => ({
        localId: id,
        filename: file.name,
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        workspacePath: id,
        status: 'ready' as const,
      })),
    [draftFiles],
  )

  // 知识库 hook
  const {
    availableKbs,
    selectedKbIds,
    isEnabled: knowledgeBaseEnabled,
    hasPermission: knowledgeBaseHasPermission,
    isLoading: knowledgeBaseLoading,
    error: knowledgeBaseError,
    toggleKb,
    setSelectedKbIds,
    selectAll: selectAllKbs,
    clearAll: clearAllKbs,
    refresh: refreshKnowledgeBases,
  } = useKnowledgeBase({ sessionId: null })

  const brandText = (systemSettings?.brandText ?? publicBrandText ?? '').trim() || 'AIChat'
  const quotaMessage = quota
    ? quotaExhausted
      ? '额度已用尽，请登录或等待次日重置'
      : `本日消息发送额度剩余 ${quotaLabel}`
    : null
  const basePlaceholder = quota
    ? quotaExhausted
      ? '额度已用尽，请登录或等待次日重置'
      : `本日消息发送额度剩余 ${quotaLabel}`
    : '输入消息（Shift+Enter 换行）'
  const mobilePlaceholder = '输入消息...'

  const MAX_AUTO_HEIGHT = 200
  const scopePreferenceKey = 'web_search_scope_preference'
  const missingPreferredRef = useRef(false)

  useEffect(() => {
    missingPreferredRef.current = false
  }, [preferred?.modelId])

  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => { })
    }
  }, [modelsCount, fetchAll])

  useEffect(() => {
    if (modelsCount === 0) return
    if (selectedModelKey && models?.some((m) => modelKeyFor(m) === selectedModelKey)) {
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
      setSelectedModelKey(modelKeyFor(resolved))
      void persistPreferredModel(resolved, { actorType })
    }
  }, [actorType, models, modelsCount, preferred, selectedModelKey, toast])

  const selectedModel = useMemo(
    () => (models || []).find((item) => modelKeyFor(item) === selectedModelKey) ?? null,
    [models, selectedModelKey],
  )

  const isVisionEnabled = useMemo(() => {
    const cap = selectedModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const canUseWebSearch = Boolean(
    systemSettings?.webSearchAgentEnable &&
    systemSettings?.webSearchHasApiKey,
  )
  const canUsePythonTool = Boolean(systemSettings?.pythonToolEnable)

  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return '管理员未启用联网搜索'
    if (!systemSettings?.webSearchHasApiKey) return '尚未配置搜索 API Key'
    return undefined
  }, [systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey])

  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return '管理员未开启 Python 工具'
    return undefined
  }, [systemSettings?.pythonToolEnable])

  const isMetasoEngine = Boolean(
    systemSettings?.webSearchEnabledEngines?.includes('metaso') &&
    systemSettings?.webSearchHasApiKeyMetaso,
  )
  const showWebSearchScope = canUseWebSearch && isMetasoEngine

  const {
    skillOptions,
    toggleSkillOption,
    enabledExtraSkills,
  } = useSkillsSelection(null)

  useEffect(() => {
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const raw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh' = raw && raw !== '' ? raw : 'unset'
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

  // 当有草稿文件时自动启用 Python 工具，与聊天内行为一致
  useEffect(() => {
    if (draftFiles.length > 0 && canUsePythonTool && !pythonToolEnabled) {
      setPythonToolEnabled(true)
    }
  }, [draftFiles.length, canUsePythonTool, pythonToolEnabled])

  // onAttachmentsSelected（需在 isVisionEnabled 之后定义）
  const onAttachmentsSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      if (files.length === 0) return

      const { classifyFiles } = await import('@/features/chat/composer/classify-files')
      const { directories, images, others } = classifyFiles(files, { isVisionEnabled })

      if (directories.length > 0) {
        toast({
          title: '不支持文件夹',
          description: '请单独选择文件上传',
          variant: 'destructive',
        })
      }

      // 处理图片（vision 路径）
      for (const file of images) {
        const result = await validateImage(file)
        if (!result.ok) {
          toast({
            title: '图片不符合要求',
            description: result.reason || '图片校验失败',
            variant: 'destructive',
          })
        } else if (result.dataUrl && result.mime && typeof result.size === 'number') {
          setSelectedImages((prev) => [...prev, { dataUrl: result.dataUrl!, mime: result.mime!, size: result.size! }])
        }
      }

      // 处理其他文件（欢迎页暂存，创建会话后上传）
      if (others.length > 0) {
        // vision 关闭时图片会被归入 others，告知用户
        if (!isVisionEnabled && files.some((f) => f.type.startsWith('image/'))) {
          toast({
            title: '图片作为工作区文件',
            description: '当前模型不支持图片输入，已作为工作区文件上传',
          })
        }
        setDraftFiles((prev) => [
          ...prev,
          ...others.map((f) => ({ id: crypto.randomUUID(), file: f })),
        ])
      }

      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = ''
      }
    },
    [isVisionEnabled, validateImage, setSelectedImages, toast],
  )

  // 拖拽图片处理（欢迎页）
  const handleAddImageFiles = useCallback(
    async (imageFiles: File[]) => {
      for (const file of imageFiles) {
        const result = await validateImage(file)
        if (!result.ok) {
          toast({
            title: '图片不符合要求',
            description: result.reason || '图片校验失败',
            variant: 'destructive',
          })
        } else if (result.dataUrl && result.mime && typeof result.size === 'number') {
          setSelectedImages((prev) => [...prev, { dataUrl: result.dataUrl!, mime: result.mime!, size: result.size! }])
        }
      }
    },
    [validateImage, setSelectedImages, toast],
  )

  // 拖拽文件处理：添加到草稿
  const handleUploadWorkspaceFiles = useCallback(
    (files: File[]) => {
      setDraftFiles((prev) => [
        ...prev,
        ...files.map((f) => ({ id: crypto.randomUUID(), file: f })),
      ])
    },
    [],
  )

  // 拖拽上传
  const { isDragOver, dragHandlers } = useDragDrop({
    isVisionEnabled,
    onAddImageFiles: handleAddImageFiles,
    onUploadWorkspaceFiles: handleUploadWorkspaceFiles,
    toast,
  })

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
    (model: ModelItem) => {
      setSelectedModelKey(modelKeyFor(model))
      void persistPreferredModel(model, { actorType })
    },
    [actorType],
  )

  const canCreate = Boolean(selectedModel)
  const creationDisabled = !canCreate || isCreating || quotaExhausted

  const handleCreate = useCallback(async () => {
    if (!canCreate || !selectedModel || isCreating) return
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
      const normalizedPrompt = sessionPromptDraft.trim()
      const created = await createSession(
        selectedModel.id,
        title,
        selectedModel.connectionId,
        selectedModel.rawId,
        normalizedPrompt || undefined,
      )
      // 上传成功的文件元数据，用于构造 manifest
      const uploadedFilesMeta: Array<{ originalName: string; workspacePath: string }> = []
      if (created?.id) {
        let uploadFailures = 0
        if (draftFiles.length) {
          for (const { file } of draftFiles) {
            try {
              const formData = new FormData()
              formData.append('file', file)
              const response = await fetch(`/api/chat/sessions/${created.id}/files`, {
                method: 'POST',
                body: formData,
                credentials: 'include',
              })
              if (!response.ok) {
                uploadFailures++
                const body = await response.json().catch(() => ({}))
                toast({
                  title: '文件上传失败',
                  description: `${file.name}: ${(body as any)?.error || `HTTP ${response.status}`}`,
                  variant: 'destructive',
                })
                continue
              }
              const result = await response.json()
              if (!result.success) {
                uploadFailures++
                toast({
                  title: '文件上传失败',
                  description: `${file.name}: ${result.error || '未知错误'}`,
                  variant: 'destructive',
                })
              } else {
                uploadedFilesMeta.push({
                  originalName: result.data.originalName,
                  workspacePath: result.data.workspacePath,
                })
              }
            } catch (error) {
              uploadFailures++
              console.warn('Workspace file upload failed', error)
              toast({
                title: '文件上传失败',
                description: `${file.name} 未能上传到工作区，可稍后在会话内重试`,
                variant: 'destructive',
              })
            }
          }
          const allFilesFailed = uploadFailures > 0 && uploadFailures === draftFiles.length
          if (allFilesFailed) {
            toast({
              title: '全部文件上传失败',
              description: '工作区文件未能上传，可稍后在会话内重试',
              variant: 'destructive',
            })
          }
        }
      }
      const uploadSuccesses = uploadedFilesMeta.length

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

      if (text || uploadSuccesses > 0) {
        if (uploadSuccesses > 0 && !canUsePythonTool) {
          toast({
            title: '无法分析文件',
            description: '管理员未启用 Python 工具，无法读取工作区文件',
            variant: 'destructive',
          })
          if (created?.id) {
            clearWorkspaceFiles()
            router.push(`/main/${created.id}`)
          }
          return
        }
        const session = useChatStore.getState().currentSession
        if (session) {
          // Bind enabled extra skills to the new session before sending first message
          let skillBindingFailed = false
          if (enabledExtraSkills.length > 0) {
            for (const ref of enabledExtraSkills) {
              try {
                const bindResp = await updateSessionSkillBinding(session.id, {
                  skillId: ref.skillId,
                  versionId: ref.versionId,
                  enabled: true,
                })
                if (!bindResp?.success) {
                  throw new Error(bindResp?.error || '绑定 Skill 失败')
                }
              } catch (e) {
                skillBindingFailed = true
                toast({
                  title: 'Skill 启用失败',
                  description: `未能为当前会话启用第三方 Skill，请稍后重试`,
                  variant: 'destructive',
                })
                break
              }
            }
          }
          if (skillBindingFailed) {
            clearWorkspaceFiles()
            router.push(`/main/${session.id}`)
            return
          }

          // 构造文件 manifest
          const fileManifest = buildWorkspaceFileManifest(uploadedFilesMeta)
          const message = (text || (uploadedFilesMeta.length > 0 ? '请分析工作区中的文件' : '')) + fileManifest
          const imagesPayload =
            selectedImages.length > 0
              ? selectedImages.map((img) => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
              : undefined
          const builtinSkills: string[] = []
          const skillOverrides: Record<string, Record<string, unknown>> = {}
          if (webSearchEnabled && canUseWebSearch) {
            builtinSkills.push('web-search', 'url-reader')
            const webSearchOverride: Record<string, unknown> = {}
            if (isMetasoEngine) webSearchOverride.scope = webSearchScope
            if (systemSettings?.webSearchIncludeSummary) webSearchOverride.includeSummary = true
            if (systemSettings?.webSearchIncludeRaw) webSearchOverride.includeRawContent = true
            if (Object.keys(webSearchOverride).length > 0) {
              skillOverrides['web-search'] = webSearchOverride
            }
          }
          if ((pythonToolEnabled || uploadedFilesMeta.length > 0) && canUsePythonTool) {
            builtinSkills.push('python-runner')
          }
          const options: Record<string, any> = {}
          if (thinkingTouched) options.reasoningEnabled = thinkingEnabled
          if (effortTouched && effort !== 'unset') options.reasoningEffort = effort
          if (builtinSkills.length > 0 || enabledExtraSkills.length > 0) {
            options.skills = {
              ...(builtinSkills.length > 0 ? { builtin: Array.from(new Set(builtinSkills)) } : {}),
              ...(enabledExtraSkills.length > 0 ? { enabled: enabledExtraSkills } : {}),
              ...(Object.keys(skillOverrides).length > 0 ? { overrides: skillOverrides } : {}),
            }
          }
          if (requestPayload.customBody) options.customBody = requestPayload.customBody
          if (requestPayload.customHeaders && requestPayload.customHeaders.length) {
            options.customHeaders = requestPayload.customHeaders
          }
          await streamMessage(
            session.id,
            message,
            imagesPayload,
            Object.keys(options).length ? options : undefined,
          )
          setSelectedImages([])
        }
      }

      if (created?.id) {
        clearWorkspaceFiles()
        router.push(`/main/${created!.id}`)
      }
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
      setQuery('')
    }
  }, [
    canCreate,
    selectedModel,
    isCreating,
    quotaExhausted,
    query,
    toast,
    buildRequestPayload,
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
    draftFiles,
    clearWorkspaceFiles,
    enabledExtraSkills,
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
      selectedModelId: selectedModelKey,
      onModelChange: handleModelChange,
      disabled: creationDisabled,
      isCreating,
    },
    hero: {
      quotaExhausted,
      brandText,
    },
    form: {
      query,
      isComposing,
      setIsComposing,
      textareaRef,
      basePlaceholder,
      mobilePlaceholder,
      mobileQuotaNotice: quotaMessage,
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
      isDragOver,
      dragHandlers,
      attachments: {
        selectedImages,
        onRemoveImage: removeImage,
        onPaste: handlePaste,
        workspaceFiles: draftWorkspaceFiles,
        onRemoveWorkspaceFile: removeWorkspaceFile,
        attachmentInputRef,
        pickAttachments,
        onAttachmentsSelected,
      },
      knowledgeBase: {
        enabled: knowledgeBaseEnabled && knowledgeBaseHasPermission,
        availableKbs,
        selectedKbIds,
        isLoading: knowledgeBaseLoading,
        error: knowledgeBaseError,
        onToggle: toggleKb,
        onSelectAll: selectAllKbs,
        onClearAll: clearAllKbs,
        onRefresh: refreshKnowledgeBases,
        selectorOpen: kbSelectorOpen,
        onOpenSelector: () => setKbSelectorOpen(true),
        onSelectorOpenChange: setKbSelectorOpen,
      },
      advancedOptions: {
        disabled: creationDisabled,
        thinkingEnabled,
        onToggleThinking: (value: boolean) => {
          setThinkingTouched(true)
          setThinkingEnabled(value)
        },
        effort,
        onEffortChange: (value: 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh') => {
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
        skillOptions,
        onToggleSkillOption: toggleSkillOption,
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
          ? `留空以继承全局提示词：${systemSettings.chatSystemPrompt.slice(0, 80)}${systemSettings.chatSystemPrompt.length > 80 ? '...' : ''
          }`
          : '留空将使用默认提示词：今天日期是{day time}（{day time} 会替换为服务器当前时间）',
      },
    },
    footerNote,
  }
}
