'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { cn } from '@/lib/utils'

export function ChatInterface() {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const {
    currentSession,
    messages,
    isStreaming,
    streamMessage,
    stopStreaming,
    clearError
  } = useChatStore()

  const { maxTokens } = useSettingsStore()

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
      await streamMessage(currentSession.id, message)
    } catch (error) {
      console.error('Failed to send message:', error)
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

  if (!currentSession) {
    return null
  }

  return (
    <div className="flex-1 flex flex-col h-full">
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

          <Button
            onClick={isStreaming ? handleStop : handleSend}
            disabled={(!input.trim() && !isStreaming)}
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

        {/* 提示信息 */}
        <div className="mt-2 text-xs text-muted-foreground">
          上下文限制: {maxTokens} tokens
        </div>
      </div>
    </div>
  )
}