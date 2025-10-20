import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8 flex-shrink-0 bg-muted">
        <AvatarFallback className="text-muted-foreground">A</AvatarFallback>
      </Avatar>

      <div className="flex-1 max-w-3xl">
        <div className="inline-block rounded-lg px-4 py-3 bg-muted">
          <div className="flex items-center gap-1">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <span className="text-sm text-muted-foreground ml-2">AI正在思考...</span>
          </div>
        </div>
      </div>
    </div>
  )
}