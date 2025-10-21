'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Square, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

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
  } = useChatStore()

  const { maxTokens } = useSettingsStore()
  const { toast } = useToast()

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

  const handleSend = async () => {
    if (!input.trim() || isStreaming || !currentSession) return

    const message = input.trim()
    setInput('')
    clearError()

    try {
      const imagesPayload = selectedImages.length
        ? selectedImages.map(img => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
        : undefined
      await streamMessage(currentSession.id, message, imagesPayload)
      setSelectedImages([])
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

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)

    // 自动调整高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  const pickImages = () => fileInputRef.current?.click()

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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold truncate">
            {currentSession.title}
          </h2>
          <ModelSelector
            selectedModelId={currentSession.modelConfigId}
            onModelChange={() => {}} // 这里可以实现模型切换逻辑
            disabled={isStreaming}
            className="ml-4"
          />
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

          {/* 选择图片 */}
          <Button type="button" variant="outline" size="icon" onClick={pickImages} disabled={isStreaming} title="添加图片">
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

        {/* 提示信息 */}
        <div className="mt-2 text-xs text-muted-foreground">
          上下文限制: {maxTokens} tokens
          <br />
          图片限制: 最多 {MAX_IMAGE_COUNT} 张，单张 ≤ {MAX_IMAGE_MB}MB，最大边长 ≤ {MAX_IMAGE_EDGE}px
        </div>

        {/* 隐藏文件选择 */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} />
      </div>
    </div>
  )
}
