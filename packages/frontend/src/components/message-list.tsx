import { Message } from '@/types'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>开始你的第一次对话吧</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
        />
      ))}

      {isStreaming && (
        <TypingIndicator />
      )}
    </div>
  )
}