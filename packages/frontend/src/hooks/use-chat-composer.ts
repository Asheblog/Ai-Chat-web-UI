'use client'

import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useModelsStore } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'

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
    streamMessage,
    stopStreaming,
    clearError,
    error,
  } = useChatStore()

  const { systemSettings } = useSettingsStore()
  const { toast } = useToast()
  const { models: allModels, fetchAll: fetchModels } = useModelsStore()
  const { actorState, user } = useAuthStore((state) => ({ actorState: state.actorState, user: state.user }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const MAX_IMAGE_COUNT = 4
  const MAX_IMAGE_MB = 5
  const MAX_IMAGE_EDGE = 4096
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [traceEnabled, setTraceEnabled] = useState(false)
  const tracePreferenceRef = useRef<Record<number, boolean>>({})

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
  }, [
    currentSession,
    currentSession?.id,
    currentSession?.reasoningEnabled,
    currentSession?.reasoningEffort,
    currentSession?.ollamaThink,
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
    if (!textareaRef.current || isStreaming) return
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

  const isVisionEnabled = useMemo(() => {
    if (!currentSession) return true
    const cap = activeModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel, currentSession])

  const isWebSearchCapable = useMemo(() => {
    if (!currentSession) return false
    const cap = activeModel?.capabilities?.web_search
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel, currentSession])

  const canUseWebSearch = Boolean(systemSettings?.webSearchAgentEnable) && isWebSearchCapable
  const canUseTrace = Boolean(isAdmin && systemSettings?.taskTraceEnabled)

  useEffect(() => {
    if (!canUseWebSearch && webSearchEnabled) {
      setWebSearchEnabled(false)
    }
  }, [canUseWebSearch, webSearchEnabled])

  useEffect(() => {
    if (canUseWebSearch) {
      setWebSearchEnabled(true)
    }
  }, [canUseWebSearch, currentSession?.id])

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
    if (!input.trim() || isStreaming || !currentSession) return
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
      const options = {
        reasoningEnabled: thinkingEnabled,
        reasoningEffort: effort !== 'unset' ? (effort as any) : undefined,
        ollamaThink: thinkingEnabled ? ollamaThink : undefined,
        saveReasoning: !noSaveThisRound,
        features:
          webSearchEnabled && canUseWebSearch
            ? {
                web_search: true,
              }
            : undefined,
        traceEnabled: canUseTrace ? traceEnabled : undefined,
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
    isStreaming,
    currentSession,
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
    canUseTrace,
    traceEnabled,
  ])

  const handleStop = useCallback(() => {
    stopStreaming()
  }, [stopStreaming])

  const handleTraceToggle = useCallback((value: boolean) => {
    if (!currentSession) return
    tracePreferenceRef.current[currentSession.id] = value
    setTraceEnabled(value)
  }, [currentSession])

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
    [MAX_IMAGE_COUNT, selectedImages.length, toast, validateImage],
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
    // 控制方法
    setInput,
    setIsComposing,
    setThinkingEnabled,
    setEffort,
    setOllamaThink,
    setNoSaveThisRound,
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
    traceEnabled,
    onToggleTrace: handleTraceToggle,
    canUseTrace,
  }
}
