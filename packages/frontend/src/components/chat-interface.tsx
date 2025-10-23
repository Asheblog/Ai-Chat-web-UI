'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Square, ImagePlus, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { ModelSelector } from '@/components/model-selector'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api'

export function ChatInterface() {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedImages, setSelectedImages] = useState<Array<{ dataUrl: string; mime: string; size: number }>>([])

  const {
    currentSession,
    messages,
    isStreaming,
    streamMessage,
    stopStreaming,
    clearError,
    error,
    usageCurrent,
  } = useChatStore()

  const { sidebarCollapsed, setSidebarCollapsed, systemSettings } = useSettingsStore()
  const { toast } = useToast()
  const isVisionEnabled = !!currentSession?.modelConfig?.supportsImages
  // 思考模式与本轮不保存
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(false)
  const [effort, setEffort] = useState<'low'|'medium'|'high'|'unset'>('unset')
  const [ollamaThink, setOllamaThink] = useState<boolean>(false)
  const [noSaveThisRound, setNoSaveThisRound] = useState<boolean>(false)

  // 图片限制常量
  const MAX_IMAGE_COUNT = 4
  const MAX_IMAGE_MB = 5
  const MAX_IMAGE_EDGE = 4096 // 像素

  useEffect(() => {
    // 自动滚动到底部
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [messages])

  useEffect(() => {
    // 自动聚焦输入框
    if (textareaRef.current && !isStreaming) {
      textareaRef.current.focus()
    }
  }, [isStreaming])

  // 进入会话时，从会话级默认加载；若会话未设置，则回退到系统设置
  useEffect(() => {
    if (currentSession) {
      const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
      const sysEffortRaw = (systemSettings?.openaiReasoningEffort ?? '') as any
      const sysEffort: 'low'|'medium'|'high'|'unset' = (sysEffortRaw && sysEffortRaw !== '') ? sysEffortRaw : 'unset'
      const sysOllamaThink = Boolean(systemSettings?.ollamaThink ?? false)

      // 会话级优先，其次系统级
      setThinkingEnabled(
        typeof currentSession.reasoningEnabled === 'boolean'
          ? Boolean(currentSession.reasoningEnabled)
          : sysEnabled
      )

      setEffort(
        (currentSession.reasoningEffort as any) || sysEffort
      )

      setOllamaThink(
        typeof currentSession.ollamaThink === 'boolean'
          ? Boolean(currentSession.ollamaThink)
          : sysOllamaThink
      )
    }
  }, [currentSession?.id, systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort, systemSettings?.ollamaThink])

  // 切换到不支持图片的模型时，清空已选图片
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
      toast({
        title: '发送失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive'
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStop = () => {
    stopStreaming()
  }

  const handleExportCSV = async () => {
    try {
      if (!currentSession) return
      const now = new Date()
      const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
      const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`)
      const fmt = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
      const res = await apiClient.getDailyUsage({ from: fmt(from), to: fmt(now), sessionId: currentSession.id })
      const rows = res.data?.rows || []
      const header = ['date','prompt_tokens','completion_tokens','total_tokens']
      const csv = [header.join(',')].concat(rows.map((r: any) => [r.date, r.prompt_tokens, r.completion_tokens, r.total_tokens].join(','))).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `usage_${currentSession.id}_${fmt(from)}_${fmt(now)}.csv`
      document.body.appendChild(a)
      a.click()
      URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      console.error('Export CSV failed:', err)
      toast({ title: '导出失败', description: err instanceof Error ? err.message : '未知错误', variant: 'destructive' })
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)

    // 自动调整高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  const pickImages = () => {
    if (!isVisionEnabled) {
      toast({ title: '当前模型不支持图片', description: '请在模型配置中开启“支持图片输入（Vision）”', variant: 'destructive' })
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

  const removeImage = (idx: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== idx))
  }

  if (!currentSession) {
    return null
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* 顶部工具栏 */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* 左侧：收起/展开侧边栏 + 模型选择器 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 w-9 flex items-center justify-center rounded-md border hover:bg-muted"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            <ModelSelector
              selectedModelId={currentSession.modelLabel || currentSession.modelRawId || null}
              onModelChange={() => { /* TODO: 支持会话内切换模型 */ }}
            />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {usageCurrent && (
              <div className="px-2 py-1 bg-muted rounded">
                上下文: {usageCurrent.prompt_tokens ?? '-'} / {usageCurrent.context_limit ?? '-'}
                {typeof usageCurrent.context_remaining === 'number' && (
                  <span className="ml-1">(剩余 {usageCurrent.context_remaining})</span>
                )}
              </div>
            )}
            <Button size="sm" variant="outline" className="ml-2" onClick={handleExportCSV}>
              导出CSV
            </Button>
          </div>
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4">
        <div className="py-4">
          {error && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {String(error)}
            </div>
          )}
          <MessageList messages={messages} isStreaming={isStreaming} />
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <div className="border-t px-4 py-4">
        <div className="flex flex-col gap-3">
          {/* 思考模式行 */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Switch checked={thinkingEnabled} onCheckedChange={(v)=>{
                setThinkingEnabled(!!v)
                if (currentSession) {
                  // 立即持久化会话偏好
                  useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEnabled: !!v })
                }
              }} />
              <span>思考模式</span>
            </div>
            {thinkingEnabled && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">力度</span>
                  <Select value={effort} onValueChange={(v)=>{
                    setEffort(v as any)
                    if (currentSession) {
                      useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEffort: v === 'unset' ? undefined as any : (v as any) })
                    }
                  }}>
                    <SelectTrigger className="h-8 w-36"><SelectValue placeholder="不设置" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">不设置</SelectItem>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={ollamaThink} onCheckedChange={(v)=>{
                    setOllamaThink(!!v)
                    if (currentSession) {
                      useChatStore.getState().updateSessionPrefs(currentSession.id, { ollamaThink: !!v })
                    }
                  }} />
                  <span>Ollama think</span>
                </div>
              </>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <Switch checked={noSaveThisRound} onCheckedChange={(v)=>setNoSaveThisRound(!!v)} />
              <span className="text-muted-foreground">本轮不保存</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={isStreaming ? "AI正在思考中..." : "输入消息... (Shift+Enter 换行)"}
                disabled={isStreaming}
                className="min-h-[60px] max-h-[200px] resize-none pr-12"
                rows={1}
              />

              {/* 字符计数 */}
              <div className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                {input.length}
              </div>
            </div>

          {/* 模型选择（紧凑按钮，放在输入框右侧） */}
          {/* 原输入区右侧的紧凑型模型选择器已移至顶部栏，故移除 */}

          {/* 选择图片 */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={pickImages}
            disabled={isStreaming || !isVisionEnabled}
            title={
              isVisionEnabled
                ? `添加图片（限制：最多 ${MAX_IMAGE_COUNT} 张，单张 ≤ ${MAX_IMAGE_MB}MB，最大边长 ≤ ${MAX_IMAGE_EDGE}px）`
                : "当前模型不支持图片"
            }
          >
            <ImagePlus className="h-5 w-5" />
          </Button>

          <Button
            onClick={isStreaming ? handleStop : handleSend}
            disabled={(!input.trim() && selectedImages.length === 0) && !isStreaming}
            size="icon"
            className={cn(
              "h-[60px] w-[60px]",
              isStreaming && "bg-destructive hover:bg-destructive/90"
            )}
          >
            {isStreaming ? (
              <Square className="h-5 w-5" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* 图片预览 */}
        {selectedImages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedImages.map((img, idx) => (
              <div key={idx} className="relative border rounded p-1">
                <img src={img.dataUrl} className="h-20 w-20 object-contain rounded" />
                <button type="button" className="absolute -top-2 -right-2 bg-background border rounded-full p-1" onClick={() => removeImage(idx)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 删除输入区下的上下文/图片限制说明，提示改为上传按钮悬浮提示 */}

        {/* 隐藏文件选择 */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} disabled={!isVisionEnabled} />
      </div>
    </div>
  </div>
  )
}
