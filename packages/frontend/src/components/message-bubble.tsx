'use client'

import { Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Message } from '@/types'
import { MarkdownRenderer } from './markdown-renderer'
import { formatDate, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { memo, useEffect, useState } from 'react'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

function MessageBubbleComponent({ message, isStreaming }: MessageBubbleProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(() => {
    if (typeof message.reasoningStatus === 'string') {
      return message.reasoningStatus !== 'done'
    }
    return Boolean(message.reasoning && message.reasoning.trim().length > 0)
  })
  const [reasoningManuallyToggled, setReasoningManuallyToggled] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (
      message.role === 'assistant' &&
      (message.reasoningStatus === 'idle' || message.reasoningStatus === 'streaming') &&
      !showReasoning &&
      !reasoningManuallyToggled
    ) {
      setShowReasoning(true)
    }
  }, [message.reasoningStatus, message.role, showReasoning, reasoningManuallyToggled])

  const handleCopy = async () => {
    try {
      await copyToClipboard(message.content)
      setIsCopied(true)
      toast({
        title: "已复制",
        description: "消息内容已复制到剪贴板",
        duration: 2000,
      })

      setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      toast({
        title: "复制失败",
        description: "无法复制消息内容",
        variant: "destructive",
      })
    }
  }

  const isUser = message.role === 'user'
  // 若助手消息仅包含代码块（一个或多个）而无其它文本，则去除外层气泡的底色与边框，避免出现“双层黑底”。
  const content = (message.content || '').trim()
  const reasoningRaw = message.reasoning || ''
  const reasoningText = reasoningRaw.trim()
  const outsideText = content.replace(/```[\s\S]*?```/g, '').trim()
  const isCodeOnly = !isUser && content.includes('```') && outsideText === ''
  const hasContent = content.length > 0
  const shouldShowStreamingPlaceholder = isStreaming && !hasContent
  const hasReasoningState = typeof message.reasoningStatus === 'string'
  const shouldShowReasoningSection =
    !isUser &&
    (reasoningText.length > 0 ||
      (hasReasoningState && message.reasoningStatus !== 'done') ||
      (isStreaming && message.role === 'assistant' && hasReasoningState))

  useEffect(() => {
    if (!hasReasoningState && reasoningText.length === 0) {
      setReasoningManuallyToggled(false)
      setShowReasoning(false)
    }
  }, [hasReasoningState, reasoningText.length])
  const reasoningTitle = (() => {
    if (message.reasoningDurationSeconds && !isStreaming) {
      return `思维过程 · 用时 ${message.reasoningDurationSeconds}s`
    }
    if (message.reasoningStatus === 'idle') {
      return '思维过程 · 正在思考'
    }
    if (message.reasoningStatus === 'streaming') {
      return '思维过程 · 输出中'
    }
    return '思维过程'
  })()

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像 */}
      <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-muted' : 'bg-muted'}`}>
        <AvatarImage src={undefined} />
        <AvatarFallback className={isUser ? 'text-muted-foreground' : 'text-muted-foreground'}>
          {isUser ? 'U' : 'A'}
        </AvatarFallback>
      </Avatar>

      {/* 消息内容 */}
      <div className={`flex-1 min-w-0 max-w-full lg:max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block max-w-full box-border rounded-lg ${isUser ? 'px-4 py-3' : (isCodeOnly ? 'p-0' : 'px-4 py-3')} ${
            isUser
              ? 'bg-muted text-foreground ml-auto'
              : (isCodeOnly ? 'bg-transparent border-0 text-foreground' : 'bg-background border text-foreground')
          }`}
        >
          {isUser ? (
            <div className="text-left">
              {message.images && message.images.length > 0 && (
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {message.images.map((src, i) => (
                    <img key={i} src={src} alt={`img-${i}`} className="max-h-40 rounded border object-contain" />
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap text-left">{message.content}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* 推理折叠块：在助手流式阶段始终展示，便于实时查看思维链 */}
              {shouldShowReasoningSection && (
                <div className="border rounded bg-background/60">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs text-muted-foreground flex items-center justify-between"
                    onClick={() => {
                      setReasoningManuallyToggled(true)
                      setShowReasoning((v) => !v)
                    }}
                    title="思维过程（可折叠）"
                  >
                    <span>{reasoningTitle}</span>
                    <span className="ml-2">{showReasoning ? '▼' : '▶'}</span>
                  </button>
                  {showReasoning && (
                    <div className="px-3 pb-2">
                      {message.reasoningStatus === 'idle' && (
                        <div className="text-xs text-muted-foreground mb-1">
                          模型正在思考…
                          {typeof message.reasoningIdleMs === 'number' && message.reasoningIdleMs > 0
                            ? `（静默 ${Math.round(message.reasoningIdleMs / 1000)}s）`
                            : null}
                        </div>
                      )}
                      {reasoningText ? (
                        <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{reasoningRaw.split('\n').map(l => l.startsWith('>') ? l : `> ${l}`).join('\n')}</pre>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {message.reasoningStatus === 'streaming' ? '推理内容接收中…' : '正在思考中…'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {shouldShowStreamingPlaceholder ? (
                <div className="flex items-center gap-1">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-muted-foreground ml-2">AI正在思考...</span>
                </div>
              ) : (
                <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
              )}
            </div>
          )}
        </div>

        {/* 消息操作按钮 */}
        {!isUser && (
          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title="复制消息"
            >
              {isCopied ? (
                <div className="h-3 w-3 bg-green-500 rounded" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>

            {/* TODO: 实现重新生成功能 */}
            {/* <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="重新生成"
              disabled
            >
              <RotateCcw className="h-3 w-3" />
            </Button> */}

            <span className="ml-2">
              {formatDate(message.createdAt)}
            </span>
          </div>
        )}

        {isUser && (
          <div className="text-xs text-muted-foreground mt-2">
            {formatDate(message.createdAt)}
          </div>
        )}
      </div>
    </div>
  )
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  (prev, next) => {
    const prevMsg = prev.message
    const nextMsg = next.message
    const sameBasic =
      prevMsg.id === nextMsg.id &&
      prevMsg.role === nextMsg.role &&
      prevMsg.content === nextMsg.content &&
      prevMsg.reasoning === nextMsg.reasoning &&
      prevMsg.reasoningDurationSeconds === nextMsg.reasoningDurationSeconds &&
      prevMsg.reasoningStatus === nextMsg.reasoningStatus &&
      prevMsg.reasoningIdleMs === nextMsg.reasoningIdleMs &&
      prevMsg.createdAt === nextMsg.createdAt
    const prevImages = prevMsg.images || []
    const nextImages = nextMsg.images || []
    const sameImages =
      prevImages.length === nextImages.length &&
      prevImages.every((img, idx) => img === nextImages[idx])

    return (
      prev.isStreaming === next.isStreaming &&
      sameBasic &&
      sameImages
    )
  }
)
