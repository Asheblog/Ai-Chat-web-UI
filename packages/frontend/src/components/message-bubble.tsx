'use client'

import { useState } from 'react'
import { Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Message } from '@/types'
import { MarkdownRenderer } from './markdown-renderer'
import { formatDate, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const [isCopied, setIsCopied] = useState(false)
  const { toast } = useToast()

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

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像 */}
      <Avatar className={`h-8 w-8 flex-shrink-0 ${isUser ? 'bg-primary' : 'bg-muted'}`}>
        <AvatarImage src={undefined} />
        <AvatarFallback className={isUser ? 'text-primary-foreground' : 'text-muted-foreground'}>
          {isUser ? 'U' : 'A'}
        </AvatarFallback>
      </Avatar>

      {/* 消息内容 */}
      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block rounded-lg px-4 py-3 ${
            isUser
              ? 'bg-primary text-primary-foreground ml-auto'
              : 'bg-muted text-foreground'
          } ${isStreaming && !isUser ? 'typing-cursor' : ''}`}
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
              <p className="whitespace-pre-wrap text-right">{message.content}</p>
            </div>
          ) : (
            // 助手消息：当处于流式且内容为空时，直接在该气泡内显示“思考中”占位，避免再额外渲染一条提示气泡
            (isStreaming && (!message.content || message.content.trim() === '')) ? (
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
            )
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
