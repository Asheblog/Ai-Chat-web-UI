'use client'

// 全新欢迎页：模仿 ChatGPT 着陆面板（大标题 + 大输入框），并保持响应式
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ImagePlus, X } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'
import { apiClient } from '@/lib/api'
import { useModelsStore } from '@/store/models-store'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { useSettingsStore } from '@/store/settings-store'
// 顶部栏仅放模型选择器，不再显示品牌文案

export function WelcomeScreen() {
  const { createSession, streamMessage } = useChatStore()
  const { systemSettings } = useSettingsStore()
  const { toast } = useToast()

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

  // 图片上传（与聊天页保持一致的限制）
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selectedImages, setSelectedImages] = useState<Array<{ dataUrl: string; mime: string; size: number }>>([])
  const MAX_IMAGE_COUNT = 4
  const MAX_IMAGE_MB = 5
  const MAX_IMAGE_EDGE = 4096
  const MAX_AUTO_HEIGHT = 200
  const [showExpand, setShowExpand] = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')

  // 选择一个默认模型（取聚合列表的第一个）
  const { models, fetchAll } = useModelsStore()
  useEffect(() => { if (!models || models.length===0) fetchAll().catch(()=>{}) }, [models?.length])
  useEffect(() => {
    const first = models?.[0]?.id as string | undefined
    if (first) setSelectedModelId(first)
  }, [models])

  const canCreate = useMemo(() => !!selectedModelId, [selectedModelId])

  // 默认跟随系统设置（除非用户在下拉里改动）
  useEffect(() => {
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const raw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'unset'|'low'|'medium'|'high' = raw && raw !== '' ? raw : 'unset'
    if (!thinkingTouched) setThinkingEnabled(sysEnabled)
    if (!effortTouched) setEffort(sysEffort)
  }, [systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort, thinkingTouched, effortTouched])

  // 当前选择的模型是否支持图片（Vision）
  const isVisionEnabled = useMemo(() => {
    const m = (models || []).find((mm) => mm.id === selectedModelId)
    const cap = m?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [models, selectedModelId])

  // 切换到不支持图片的模型时清空图片
  useEffect(() => {
    if (!isVisionEnabled && selectedImages.length > 0) {
      setSelectedImages([])
      toast({ title: '已清空图片', description: '当前模型不支持图片输入', variant: 'destructive' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisionEnabled])

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
    if (!isVisionEnabled) {
      toast({ title: '当前模型不支持图片', description: '请切换到支持图片的模型', variant: 'destructive' })
      return
    }
    fileInputRef.current?.click()
  }

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
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

    setIsCreating(true)
    const text = query.trim()
    try {
      // 以输入作为标题（截断）以便会话列表更清晰
      const title = text ? text.slice(0, 50) : '新的对话'
      // 携带 connectionId/rawId 以避免后端解析歧义
      const m = (models || []).find(mm => mm.id === selectedModelId)
      await createSession(selectedModelId, title, m?.connectionId, m?.rawId)

      // 仅当用户改动过时，才写入会话偏好
      try {
        const session = useChatStore.getState().currentSession
        if (session && (thinkingTouched || effortTouched)) {
          const prefs: any = {}
          if (thinkingTouched) prefs.reasoningEnabled = !!thinkingEnabled
          if (effortTouched && effort !== 'unset') prefs.reasoningEffort = effort as any
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
      <header className="hidden lg:flex border-b bg-background/80 supports-[backdrop-filter]:backdrop-blur px-4 h-14 items-center">
        <ModelSelector
          selectedModelId={selectedModelId}
          onModelChange={(model) => setSelectedModelId(model.id)}
          disabled={!canCreate || isCreating}
        />
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
                  disabled={!canCreate || isCreating}
                  aria-label="更多操作"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <div className="px-3 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">思考模式</span>
                    <Switch
                      checked={thinkingEnabled}
                      onCheckedChange={(v)=>{ setThinkingEnabled(!!v); setThinkingTouched(true) }}
                      aria-label="思考模式开关"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">思考深度</span>
                    <Select value={effort} onValueChange={(v)=>{ setEffort(v as any); setEffortTouched(true) }}>
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue placeholder="不设置" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">不设置</SelectItem>
                        <SelectItem value="low">low</SelectItem>
                        <SelectItem value="medium">medium</SelectItem>
                        <SelectItem value="high">high</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={query}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder="输入消息（Shift+Enter 换行）"
                disabled={!canCreate || isCreating}
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
                disabled={!isVisionEnabled || isCreating}
                aria-label="添加图片"
                title={isVisionEnabled ? '添加图片' : '当前模型不支持图片'}
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
            </div>
          </div>
          {/* 选中图片预览 */}
          {selectedImages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative border rounded p-1">
                  <img src={img.dataUrl} className="h-20 w-20 object-contain rounded" />
                  <button type="button" className={cn('absolute -top-2 -right-2 bg-background border rounded-full p-1')} onClick={() => removeImage(idx)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 隐藏文件选择 */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} />
        </div>

        {/* 全屏编辑弹框 */}
        <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
          <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 sm:rounded-2xl overflow-hidden flex flex-col">
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
          AIChat 可能生成不准确或不完整的内容，请自行核实关键信息。
        </p>
      </div>
    </div>
  )
}
