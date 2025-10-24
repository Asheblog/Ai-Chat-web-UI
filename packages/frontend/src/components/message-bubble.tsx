'use client'

import { Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Message } from '@/types'
import { MarkdownRenderer } from './markdown-renderer'
import { formatDate, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { useState } from 'react'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
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
  // 若助手消息仅包含代码块（一个或多个）而无其它文本，则去除外层气泡的底色与边框，避免出现“双层黑底”。
  const content = (message.content || '').trim()
  const outsideText = content.replace(/```[\s\S]*?```/g, '').trim()
  const isCodeOnly = !isUser && content.includes('```') && outsideText === ''

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
      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block rounded-lg ${isUser ? 'px-4 py-3' : (isCodeOnly ? 'p-0' : 'px-4 py-3')} ${
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
              <div className="space-y-2">
                {/* 思维过程折叠块（存在推理内容或处于流式中，且为助手消息时显示） */}
                {(message.reasoning || (isStreaming && message.role === 'assistant')) && (
                  <div className="border rounded bg-background/60">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs text-muted-foreground flex items-center justify-between"
                      onClick={() => setShowReasoning((v) => !v)}
                      title="思维过程（可折叠）"
                    >
                      <span>
                        {message.reasoningDurationSeconds && !isStreaming
                          ? `思维过程 · 用时 ${message.reasoningDurationSeconds}s`
                          : '思维过程'}
                      </span>
                      <span className="ml-2">{showReasoning ? '▼' : '▶'}</span>
                    </button>
                    {showReasoning && (
                      <div className="px-3 pb-2">
                        {message.reasoning ? (
                          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{message.reasoning.split('\n').map(l => l.startsWith('>') ? l : `> ${l}`).join('\n')}</pre>
                        ) : (
                          <div className="text-xs text-muted-foreground">正在思考中…</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
              </div>
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
