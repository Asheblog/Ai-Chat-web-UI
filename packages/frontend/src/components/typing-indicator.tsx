'use client'

import { memo } from 'react'

function TypingIndicatorComponent() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground px-2" role="status" aria-live="polite" aria-atomic="true">
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-muted-foreground/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-muted-foreground/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-muted-foreground/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span>AI 正在思考…</span>
    </div>
  )
}

export const TypingIndicator = memo(TypingIndicatorComponent)
