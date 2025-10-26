'use client'

// 独立的移动端聊天组件，复用桌面端 ChatInterface 的核心逻辑，
// 但在布局与交互元素上采用更贴合移动端的样式（参考 previews/mobile-variant-a-shadcn.html）。
// 注意：仅在必要范围内复制逻辑，避免影响桌面端行为。

import { useEffect, useRef, useState } from 'react'
import { Send, Square, ImagePlus, Settings as SettingsIcon, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useToast } from '@/components/ui/use-toast'
import { useModelsStore } from '@/store/models-store'

export function MobileChatInterface() {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedImages, setSelectedImages] = useState<Array<{ dataUrl: string; mime: string; size: number }>>([])

  const {
    currentSession,
    messages,
    isLoading,
    isStreaming,
    streamMessage,
    stopStreaming,
    clearError,
  } = useChatStore()

  const { systemSettings } = useSettingsStore()
  const { toast } = useToast()
  const { models: allModels, fetchAll: fetchModels } = useModelsStore()
  useEffect(() => { if (!allModels || allModels.length === 0) fetchModels().catch(()=>{}) }, [allModels?.length])
  const isVisionEnabled = (() => {
    if (!currentSession) return true
    const cid = currentSession.connectionId ?? null
    const rid = currentSession.modelRawId ?? currentSession.modelLabel ?? null
    const match = allModels.find((m) => (
      (cid != null ? m.connectionId === cid : true) &&
      (rid ? (m.rawId === rid || m.id === rid) : false)
    ))
    const cap = match?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  })()

  // 思考模式（沿用桌面端语义）
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(false)
  const [effort, setEffort] = useState<'low'|'medium'|'high'|'unset'>('unset')
  const [ollamaThink, setOllamaThink] = useState<boolean>(false)
  const [noSaveThisRound, setNoSaveThisRound] = useState<boolean>(false)

  // 图片限制
  const MAX_IMAGE_COUNT = 4
  const MAX_IMAGE_MB = 5
  const MAX_IMAGE_EDGE = 4096
  const MAX_AUTO_HEIGHT = 200

  useEffect(() => {
    // 自动滚动到底部
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
      if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    // 进入会话时回填系统默认
    if (currentSession) {
      const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
      const sysEffortRaw = (systemSettings?.openaiReasoningEffort ?? '') as any
      const sysEffort: 'low'|'medium'|'high'|'unset' = (sysEffortRaw && sysEffortRaw !== '') ? sysEffortRaw : 'unset'
      const sysOllamaThink = Boolean(systemSettings?.ollamaThink ?? false)

      setThinkingEnabled(typeof currentSession.reasoningEnabled === 'boolean' ? Boolean(currentSession.reasoningEnabled) : sysEnabled)
      setEffort((currentSession.reasoningEffort as any) || sysEffort)
      setOllamaThink(typeof currentSession.ollamaThink === 'boolean' ? Boolean(currentSession.ollamaThink) : sysOllamaThink)
    }
  }, [currentSession?.id, systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort, systemSettings?.ollamaThink])

  useEffect(() => {
    if (!isVisionEnabled && selectedImages.length > 0) {
      setSelectedImages([])
      toast({ title: '已清空图片', description: '当前模型不支持图片输入', variant: 'destructive' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisionEnabled])

  const handleSend = async () => {
    if (!input.trim() || isStreaming || !currentSession) return
    const message = input.trim()
    setInput('')
    clearError()
    try {
      const imagesPayload = isVisionEnabled && selectedImages.length
        ? selectedImages.map(img => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
        : undefined
      const options = {
        reasoningEnabled: thinkingEnabled,
        reasoningEffort: effort !== 'unset' ? (effort as any) : undefined,
        ollamaThink: thinkingEnabled ? ollamaThink : undefined,
        saveReasoning: !noSaveThisRound,
      }
      await streamMessage(currentSession.id, message, imagesPayload, options)
      setSelectedImages([])
      setNoSaveThisRound(false)
    } catch (error) {
      console.error('Failed to send message:', error)
      toast({ title: '发送失败', description: error instanceof Error ? error.message : '未知错误', variant: 'destructive' })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStop = () => { stopStreaming() }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const h = Math.min(textareaRef.current.scrollHeight, MAX_AUTO_HEIGHT)
      textareaRef.current.style.height = `${h}px`
    }
  }

  const pickImages = () => {
    if (!isVisionEnabled) {
      toast({ title: '当前模型不支持图片', description: '请切换到支持图片的模型', variant: 'destructive' })
      return
    }
    fileInputRef.current?.click()
  }

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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 顶部模型选择器已移至全局移动端顶栏，避免重复显示 */}
      {/* 消息区：卡片式消息流 */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="px-4 py-4">
            <MessageList messages={messages} isStreaming={isStreaming} isLoading={isLoading} />
          </div>
        </ScrollArea>
      </div>

      {/* 输入区：遵循移动端预览稿的结构 */}
      <div className="border-t bg-background">
        <div className="px-4 pb-5 pt-3">
          {/* 顶部：思考模式与深度 */}
          <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full" onClick={()=>{}} aria-label="更多选项">
                <Plus className="h-4 w-4" />
              </Button>
              <span>思考模式</span>
              <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
            </div>
            <Select value={effort} onValueChange={(v)=> setEffort(v as any)}>
              <SelectTrigger className="h-8 w-[120px] rounded-full">
                <SelectValue placeholder="深度：未设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">深度：未设置</SelectItem>
                <SelectItem value="low">深度：较低</SelectItem>
                <SelectItem value="medium">深度：适中</SelectItem>
                <SelectItem value="high">深度：较高</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 文本输入 */}
          <div className="mt-2 rounded-2xl border bg-card shadow-sm px-3 py-2">
            <Textarea
              ref={textareaRef}
              placeholder={currentSession ? '继续输入...' : '输入你要翻译的文字'}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              className="resize-none rounded-xl min-h-[110px]"
              rows={3}
            />
            {/* 操作区 */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={handleStop} disabled={!isStreaming} aria-label="停止">
                  <Square className="h-4 w-4" />
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={pickImages} aria-label="上传图片">
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={()=> setNoSaveThisRound(v=>!v)} aria-label="更多设置">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </div>
              <Button type="button" className="h-11 px-6 rounded-full" onClick={handleSend} disabled={!input.trim() || isStreaming || !currentSession}>
                <Send className="mr-1 h-4 w-4" /> 发送
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
