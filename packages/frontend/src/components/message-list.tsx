import { memo } from 'react'
import { Message } from '@/types'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  isLoading?: boolean
}

function MessageListComponent({ messages, isStreaming, isLoading }: MessageListProps) {
  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
              <div className="mt-3 h-20 bg-muted/70 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>开始你的第一次对话吧</p>
      </div>
    )
  }

  const last = messages[messages.length - 1]

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
        />
      ))}

      {/* 当末尾还没有 assistant 占位消息时，才额外显示思考中指示器，避免出现两条气泡 */}
      {isStreaming && (!last || last.role !== 'assistant') && (
        <TypingIndicator />
      )}
    </div>
  )
}

export const MessageList = memo(
  MessageListComponent,
  (prev, next) =>
    prev.isLoading === next.isLoading &&
    prev.isStreaming === next.isStreaming &&
    prev.messages === next.messages
)
