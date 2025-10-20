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
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
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