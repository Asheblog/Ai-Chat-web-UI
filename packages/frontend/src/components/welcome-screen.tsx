'use client'

// 全新欢迎页：模仿 ChatGPT 着陆面板（大标题 + 大输入框），并保持响应式
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { useRouter } from 'next/navigation'
import { Plus, ImagePlus, X, Globe } from 'lucide-react'
import NextImage from 'next/image'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'
import { apiClient } from '@/lib/api'
import { useModelsStore } from '@/store/models-store'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { useSettingsStore } from '@/store/settings-store'
import { UserMenu } from '@/components/user-menu'
import { useAuthStore } from '@/store/auth-store'
import { useModelPreferenceStore, persistPreferredModel, findPreferredModel } from '@/store/model-preference-store'
import { useWebSearchPreferenceStore } from '@/store/web-search-preference-store'
import { usePythonToolPreferenceStore } from '@/store/python-tool-preference-store'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'

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

export function WelcomeScreen() {
  const { createSession, streamMessage } = useChatStore()
  const { systemSettings, publicBrandText } = useSettingsStore()
  const { toast } = useToast()
  const router = useRouter()
  const { actorState, quota } = useAuthStore((state) => ({
    actorState: state.actorState,
    quota: state.quota,
  }))
  const isAnonymous = actorState !== 'authenticated'
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota
      ? (typeof quota.remaining === 'number'
        ? quota.remaining
        : Math.max(0, quota.dailyLimit - quota.usedCount))
      : null
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaLabel = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)

  const [query, setQuery] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  // 首页：思考模式 & 深度（放在“+”的下拉中）
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(false)
  const [effort, setEffort] = useState<'unset'|'low'|'medium'|'high'>('unset')
  // 跟踪是否被用户修改过（未修改则沿用系统设置）
  const [thinkingTouched, setThinkingTouched] = useState(false)
  const [effortTouched, setEffortTouched] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [webSearchTouched, setWebSearchTouched] = useState(false)
  const [pythonToolEnabled, setPythonToolEnabled] = useState(false)
  const [pythonToolTouched, setPythonToolTouched] = useState(false)
  const [webSearchScope, setWebSearchScope] = useState('webpage')
  const storedWebSearchPreference = useWebSearchPreferenceStore((state) => state.lastSelection)
  const persistWebSearchPreference = useWebSearchPreferenceStore((state) => state.setLastSelection)
  const storedPythonPreference = usePythonToolPreferenceStore((state) => state.lastSelection)
  const persistPythonPreference = usePythonToolPreferenceStore((state) => state.setLastSelection)
  const scopePreferenceKey = 'web_search_scope_preference'

  // 图片上传（与聊天页保持一致的限制）
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selectedImages, setSelectedImages] = useState<Array<{ dataUrl: string; mime: string; size: number }>>([])
  const {
    maxCount: MAX_IMAGE_COUNT,
    maxMb: MAX_IMAGE_MB,
    maxEdge: MAX_IMAGE_EDGE,
    maxTotalMb: MAX_TOTAL_IMAGE_MB,
  } = DEFAULT_CHAT_IMAGE_LIMITS
  const MAX_AUTO_HEIGHT = 200
  const [showExpand, setShowExpand] = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [customBodyInput, setCustomBodyInput] = useState<string>('')
  const [customBodyError, setCustomBodyError] = useState<string | null>(null)
  const [customHeaders, setCustomHeaders] = useState<Array<{ name: string; value: string }>>([])
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false)
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [sessionPromptTouched, setSessionPromptTouched] = useState(false)

  // 选择一个默认模型（优先使用持久化偏好）
  const { models, fetchAll } = useModelsStore()
  const modelsCount = models?.length ?? 0
  const preferred = useModelPreferenceStore((state) => state.preferred)
  const actorType = useAuthStore((state) => state.actor?.type ?? 'anonymous')
  const missingPreferredNotifiedRef = useRef(false)
  useEffect(() => {
    missingPreferredNotifiedRef.current = false
  }, [preferred?.modelId])
  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => {})
    }
  }, [modelsCount, fetchAll])
  useEffect(() => {
    if (modelsCount === 0) return
    const currentMatch = selectedModelId ? (models || []).find((m) => m.id === selectedModelId) : null
    if (currentMatch) return

    let resolved = findPreferredModel(models || [], preferred) || undefined
    if (!resolved && preferred && !missingPreferredNotifiedRef.current) {
        missingPreferredNotifiedRef.current = true
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
  }, [models, modelsCount, preferred, selectedModelId, toast, actorType])

  const canCreate = useMemo(() => !!selectedModelId, [selectedModelId])
  const creationDisabled = !canCreate || isCreating || quotaExhausted
  const brandText = (systemSettings?.brandText ?? publicBrandText ?? '').trim() || 'AIChat'
  const basePlaceholder = quota
    ? (quotaExhausted ? '额度已用尽，请登录或等待次日重置' : `本日消息发送额度剩余 ${quotaLabel}`)
    : '输入消息（Shift+Enter 换行）'

  // 默认跟随系统设置（除非用户在下拉里改动）
  useEffect(() => {
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const raw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'unset'|'low'|'medium'|'high' = raw && raw !== '' ? raw : 'unset'
    if (!thinkingTouched) setThinkingEnabled(sysEnabled)
    if (!effortTouched) setEffort(sysEffort)
    if (!sessionPromptTouched) {
      setSessionPromptDraft(systemSettings?.chatSystemPrompt || '')
    }
  }, [systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort, systemSettings?.chatSystemPrompt, thinkingTouched, effortTouched, sessionPromptTouched])

  const selectedModel = useMemo(() => {
    return (models || []).find((mm) => mm.id === selectedModelId) ?? null
  }, [models, selectedModelId])

  // 当前选择的模型是否支持图片（Vision）
  const isVisionEnabled = useMemo(() => {
    const m = selectedModel
    const cap = m?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const isWebSearchCapable = useMemo(() => {
    const cap = selectedModel?.capabilities?.web_search
    return typeof cap === 'boolean' ? cap : true
  }, [selectedModel])

  const providerSupportsTools = useMemo(() => {
    const provider = selectedModel?.provider?.toLowerCase()
    if (!provider) return true
    return provider === "openai" || provider === "azure_openai"
  }, [selectedModel])

  const pythonToolCapable = useMemo(() => {
    const cap = selectedModel?.capabilities?.code_interpreter
    return typeof cap === "boolean" ? cap : true
  }, [selectedModel])

  const canUseWebSearch = Boolean(
    systemSettings?.webSearchAgentEnable &&
      systemSettings?.webSearchHasApiKey &&
      isWebSearchCapable &&
      providerSupportsTools,
  )
  const canUsePythonTool = Boolean(systemSettings?.pythonToolEnable) && pythonToolCapable && providerSupportsTools
  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return "管理员未启用联网搜索"
    if (!systemSettings?.webSearchHasApiKey) return "尚未配置搜索 API Key"
    if (!providerSupportsTools) return "当前连接不支持工具调用"
    if (!isWebSearchCapable) return "该模型未启用联网搜索"
    return undefined
  }, [isWebSearchCapable, providerSupportsTools, systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey])
  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return "管理员未开启 Python 工具"
    if (!providerSupportsTools) return "当前连接不支持工具调用"
    if (!pythonToolCapable) return "该模型未启用 Python 工具"
    return undefined
  }, [providerSupportsTools, pythonToolCapable, systemSettings?.pythonToolEnable])
  const isMetasoEngine = (systemSettings?.webSearchDefaultEngine || '').toLowerCase() === 'metaso'
  const showWebSearchScope = canUseWebSearch && isMetasoEngine

  // 切换到不支持图片的模型时清空图片
  useEffect(() => {
    if (!isVisionEnabled && selectedImages.length > 0) {
      setSelectedImages([])
      toast({ title: '已清空图片', description: '当前模型不支持图片输入', variant: 'destructive' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisionEnabled])

  useEffect(() => {
    if (!canUseWebSearch) {
      if (webSearchEnabled) {
        setWebSearchEnabled(false)
      }
      return
    }
    if (typeof storedWebSearchPreference === 'boolean') {
      if (webSearchEnabled !== storedWebSearchPreference) {
        setWebSearchEnabled(storedWebSearchPreference)
      }
      if (!webSearchTouched) {
        setWebSearchTouched(true)
      }
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
      if (pythonToolEnabled !== storedPythonPreference) {
        setPythonToolEnabled(storedPythonPreference)
      }
      if (!pythonToolTouched) {
        setPythonToolTouched(true)
      }
      return
    }
    if (!pythonToolTouched) {
      setPythonToolEnabled(false)
    }
  }, [canUsePythonTool, pythonToolEnabled, pythonToolTouched, storedPythonPreference])

  useEffect(() => {
    if (!showWebSearchScope) {
      if (webSearchScope !== 'webpage') setWebSearchScope('webpage')
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
  }, [showWebSearchScope, systemSettings?.webSearchScope, scopePreferenceKey, webSearchScope])

  const validateImage = (file: File): Promise<{ ok: boolean; reason?: string; dataUrl?: string; mime?: string; size?: number }> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve({ ok: false, reason: '不支持的文件类型' })
      const sizeMB = file.size / (1024 * 1024)
      if (sizeMB > MAX_IMAGE_MB) return resolve({ ok: false, reason: `图片大小超过限制（>${MAX_IMAGE_MB}MB）` })
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const img = new Image()
        img.onload = () => {
          const w = img.naturalWidth, h = img.naturalHeight
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
  }

  const pickImages = () => {
    if (quotaExhausted) {
      toast({ title: '额度已用尽', description: '请登录或等待次日重置额度', variant: 'destructive' })
      return
    }
    if (!isVisionEnabled) {
      toast({ title: '当前模型不支持图片', description: '请切换到支持图片的模型', variant: 'destructive' })
      return
    }
    fileInputRef.current?.click()
  }

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const existingBytes = selectedImages.reduce((sum, img) => sum + img.size, 0)
    const incomingBytes = files.reduce((sum, f) => sum + f.size, 0)
    const totalMb = (existingBytes + incomingBytes) / (1024 * 1024)
    if (totalMb > MAX_TOTAL_IMAGE_MB) {
      toast({ title: '超过总大小限制', description: `所有图片合计需 ≤ ${MAX_TOTAL_IMAGE_MB}MB，请压缩后再试`, variant: 'destructive' })
      return
    }
    if (selectedImages.length + files.length > MAX_IMAGE_COUNT) {
      toast({ title: '超过数量限制', description: `每次最多上传 ${MAX_IMAGE_COUNT} 张图片`, variant: 'destructive' })
      return
    }
    for (const f of files) {
      const r = await validateImage(f)
      if (!r.ok) {
        toast({ title: '图片不符合要求', description: r.reason, variant: 'destructive' })
      } else {
        setSelectedImages(prev => [...prev, { dataUrl: r.dataUrl!, mime: r.mime!, size: r.size! }])
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (idx: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== idx))
  }

  const handleCreate = async () => {
    if (!canCreate || !selectedModelId) return
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
      // 自定义请求体校验
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
          toast({ title: '创建失败', description: message, variant: 'destructive' })
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
          if (existingIdx >= 0) sanitizedHeaders.splice(existingIdx, 1)
          if (!value) continue
          sanitizedHeaders.push({ name, value })
        }
      }

      // 以输入作为标题（截断）以便会话列表更清晰
      const title = text ? text.slice(0, 50) : '新的对话'
      // 携带 connectionId/rawId 以避免后端解析歧义
      const m = (models || []).find(mm => mm.id === selectedModelId)
      const normalizedPrompt = sessionPromptDraft.trim()
      const created = await createSession(selectedModelId, title, m?.connectionId, m?.rawId, normalizedPrompt || undefined)
      if (created?.id) {
        router.push(`/main/${created.id}`)
      }

      // 仅当用户改动过时，才写入会话偏好
      try {
        const session = useChatStore.getState().currentSession
        if (session && (thinkingTouched || effortTouched || sessionPromptTouched)) {
          const prefs: any = {}
          if (thinkingTouched) prefs.reasoningEnabled = !!thinkingEnabled
          if (effortTouched && effort !== 'unset') prefs.reasoningEffort = effort as any
          if (sessionPromptTouched) prefs.systemPrompt = (sessionPromptDraft.trim() || null) as any
          if (Object.keys(prefs).length > 0) {
            await useChatStore.getState().updateSessionPrefs(session.id, prefs)
          }
        }
      } catch {}

      // 如果输入不为空，创建会话后直接发送首条消息
      if (text) {
        const session = useChatStore.getState().currentSession
        if (session) {
          const imgs = selectedImages.length
            ? selectedImages.map(img => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
            : undefined
          const opts: any = {}
          if (thinkingTouched) opts.reasoningEnabled = thinkingEnabled
          if (effortTouched && effort !== 'unset') opts.reasoningEffort = effort as any
          const featureFlags: Record<string, any> = {}
          if ((webSearchTouched || canUseWebSearch) && webSearchEnabled && canUseWebSearch) {
            featureFlags.web_search = true
            if (isMetasoEngine) featureFlags.web_search_scope = webSearchScope
            if (systemSettings?.webSearchIncludeSummary) featureFlags.web_search_include_summary = true
            if (systemSettings?.webSearchIncludeRaw) featureFlags.web_search_include_raw = true
          }
          if ((pythonToolTouched || canUsePythonTool) && pythonToolEnabled && canUsePythonTool) {
            featureFlags.python_tool = true
          }
          if (Object.keys(featureFlags).length > 0) {
            opts.features = featureFlags
          }
          if (parsedCustomBody) opts.customBody = parsedCustomBody
          if (sanitizedHeaders.length) opts.customHeaders = sanitizedHeaders
          await streamMessage(session.id, text, imgs, Object.keys(opts).length ? opts : undefined)
          setSelectedImages([])
          if (fileInputRef.current) fileInputRef.current.value = ''
        }
      }
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
      setQuery('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (creationDisabled) return
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleCreate()
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const h = Math.min(textareaRef.current.scrollHeight, MAX_AUTO_HEIGHT)
      textareaRef.current.style.height = `${h}px`
      setShowExpand(textareaRef.current.scrollHeight > MAX_AUTO_HEIGHT)
    }
  }

  return (
    <div className="relative flex-1 flex flex-col">
      {/* 顶部栏：仅在大屏展示，移动端使用 MainLayout 顶栏 */}
      <header className="hidden lg:flex bg-background/80 supports-[backdrop-filter]:backdrop-blur px-4 h-14 items-center">
        <div className="flex w-full items-center justify-between gap-4">
          <ModelSelector
            selectedModelId={selectedModelId}
            onModelChange={(model) => {
              setSelectedModelId(model.id)
              void persistPreferredModel(model, { actorType })
            }}
            disabled={!canCreate || isCreating}
          />
          <UserMenu />
        </div>
      </header>

      {/* 中心内容区 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        {/* 中心标题 */}
        <h1 className="text-center text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight mb-8">
          有什么可以帮忙的?
        </h1>

        {/* 大输入框区域（移除内联模型选择器） */}
        <div className="w-full max-w-3xl">
            <div className="flex items-center rounded-full border bg-background shadow-sm px-3 sm:px-4 py-1.5 sm:py-2 gap-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition min-h-14">
              {/* '+' 下拉：思考模式开关 + 深度选择 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full text-muted-foreground"
                  disabled={creationDisabled}
                  aria-label="更多操作"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <PlusMenuContent
                thinkingEnabled={thinkingEnabled}
                onToggleThinking={(v) => {
                  setThinkingEnabled(!!v)
                  setThinkingTouched(true)
                }}
                effort={effort}
                onEffortChange={(v) => {
                  setEffort(v as any)
                  setEffortTouched(true)
                }}
                webSearchEnabled={webSearchEnabled}
                onToggleWebSearch={(v) => {
                  const nextValue = canUseWebSearch && !!v
                  setWebSearchTouched(true)
                  setWebSearchEnabled(nextValue)
                  persistWebSearchPreference(nextValue)
                }}
                canUseWebSearch={canUseWebSearch}
                showWebSearchScope={showWebSearchScope}
                webSearchScope={webSearchScope}
                onWebSearchScopeChange={(value) => {
                  setWebSearchScope(value)
                  try {
                    localStorage.setItem(scopePreferenceKey, value)
                  } catch {
                    // ignore storage error
                  }
                }}
                webSearchDisabledNote={webSearchDisabledNote}
                pythonToolEnabled={pythonToolEnabled}
                onTogglePythonTool={(v) => {
                  const nextValue = canUsePythonTool && !!v
                  setPythonToolTouched(true)
                  setPythonToolEnabled(nextValue)
                  persistPythonPreference(nextValue)
                }}
                canUsePythonTool={canUsePythonTool}
                pythonToolDisabledNote={pythonToolDisabledNote}
                onOpenAdvanced={() => setAdvancedOpen(true)}
                onOpenSessionPrompt={() => setSessionPromptOpen(true)}
                contentClassName="rounded-2xl"
                bodyClassName="text-sm"
              />
            </DropdownMenu>
            {advancedOpen ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
                role="dialog"
                aria-modal="true"
                aria-label="高级请求定制"
                onClick={() => setAdvancedOpen(false)}
              >
                <div
                  className="w-full max-w-3xl rounded-2xl bg-background shadow-2xl border border-border/70 max-h-full overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                    <div>
                      <p className="text-lg font-semibold leading-none">高级请求定制</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        为本次消息添加自定义请求体和请求头。核心字段（model/messages/stream）已锁定，敏感头会被忽略。
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setAdvancedOpen(false)} aria-label="关闭">
                      ✕
                    </Button>
                  </div>
                  <div className="px-5 py-4">
                    <CustomRequestEditor
                      customHeaders={customHeaders}
                      onAddHeader={() => setCustomHeaders((prev) => [...prev, { name: '', value: '' }])}
                      onHeaderChange={(index, field, value) => {
                        setCustomHeaders((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
                      }}
                      onRemoveHeader={(index) => setCustomHeaders((prev) => prev.filter((_, i) => i !== index))}
                      customBody={customBodyInput}
                      onCustomBodyChange={(value) => setCustomBodyInput(value)}
                      customBodyError={customBodyError}
                    />
                  </div>
                  <div className="flex justify-end border-t border-border/60 px-5 py-3">
                    <Button variant="secondary" onClick={() => setAdvancedOpen(false)}>
                      完成
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={query}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={basePlaceholder}
                disabled={creationDisabled}
                className="h-auto min-h-[40px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-3 sm:px-4 py-2 leading-[1.4] text-left placeholder:text-muted-foreground"
                rows={1}
              />
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              {showExpand && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={() => { setExpandDraft(query); setExpandOpen(true) }}
                disabled={creationDisabled}
                aria-label="全屏编辑"
                title="全屏编辑"
              >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={pickImages}
                disabled={!isVisionEnabled || creationDisabled}
                aria-label="添加图片"
                title={isVisionEnabled ? '添加图片' : '当前模型不支持图片'}
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
          </div>
        </div>
        {sessionPromptOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
            role="dialog"
            aria-modal="true"
            aria-label="编辑会话系统提示词"
            onClick={() => setSessionPromptOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl bg-background shadow-2xl border border-border/70 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div>
                  <p className="text-lg font-semibold leading-none">会话系统提示词</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {sessionPromptDraft.trim() ? '当前会话将使用该提示词' : (systemSettings?.chatSystemPrompt ? '留空将继承全局提示词' : '留空不附加系统提示词')}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSessionPromptOpen(false)} aria-label="关闭">
                  ✕
                </Button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <textarea
                  value={sessionPromptDraft}
                  onChange={(e) => {
                    setSessionPromptDraft(e.target.value)
                    setSessionPromptTouched(true)
                  }}
                  rows={6}
                  placeholder={
                    systemSettings?.chatSystemPrompt
                      ? `留空以继承全局提示词：${systemSettings.chatSystemPrompt.slice(0, 80)}${systemSettings.chatSystemPrompt.length > 80 ? '...' : ''}`
                      : '为空则不附加系统提示词'
                  }
                  className="w-full rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <p className="text-xs text-muted-foreground">生效顺序：会话 &gt; 全局。</p>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <Button variant="ghost" onClick={() => { setSessionPromptDraft(''); setSessionPromptTouched(true) }}>
                  清空
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setSessionPromptOpen(false)}>
                    取消
                  </Button>
                  <Button
                    onClick={() => {
                      setSessionPromptTouched(true)
                      setSessionPromptOpen(false)
                    }}
                  >
                    确认
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
          {/* 选中图片预览 */}
          {selectedImages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative border rounded p-1">
                  <NextImage
                    src={img.dataUrl}
                    alt={`预览图片 ${idx + 1}`}
                    width={80}
                    height={80}
                    unoptimized
                    className="h-20 w-20 object-contain rounded"
                  />
                  <button type="button" className={cn('absolute -top-2 -right-2 bg-background border rounded-full p-1')} onClick={() => removeImage(idx)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 隐藏文件选择 */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} disabled={creationDisabled} />
        </div>

        {/* 全屏编辑弹框 */}
        <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
          <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 sm:rounded-2xl overflow-hidden flex flex-col">
            <DialogHeader className="sr-only">
              <DialogTitle>编辑消息</DialogTitle>
              <DialogDescription>在全屏编辑器中修改当前草稿内容</DialogDescription>
            </DialogHeader>
            <div className="p-4 border-b text-sm text-muted-foreground">编辑消息</div>
            <div className="flex-1 min-h-0 p-4">
              <Textarea
                value={expandDraft}
                onChange={(e)=>setExpandDraft(e.target.value)}
                className="h-full w-full resize-none border rounded-md p-3"
              />
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button variant="outline" onClick={()=>setExpandOpen(false)}>取消</Button>
              <Button onClick={()=>{ setQuery(expandDraft); setExpandOpen(false); if (textareaRef.current) { textareaRef.current.value = expandDraft as any; textareaRef.current.style.height = 'auto'; const h = Math.min(textareaRef.current.scrollHeight, MAX_AUTO_HEIGHT); textareaRef.current.style.height = `${h}px`; setShowExpand(textareaRef.current.scrollHeight > MAX_AUTO_HEIGHT); } }}>应用</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 页脚提示信息 */}
        <p className="mt-8 text-xs sm:text-[13px] text-muted-foreground text-center px-4">
          {brandText} 可能生成不准确或不完整的内容，请自行核实关键信息。
        </p>
      </div>
    </div>
  )
}
