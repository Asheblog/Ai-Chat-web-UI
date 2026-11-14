'use client'

import { memo } from 'react'
import { Loader2 } from 'lucide-react'

function TypingIndicatorComponent({ announce = true }: { announce?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground" role={announce ? 'status' : undefined} aria-live={announce ? 'polite' : undefined} aria-atomic={announce || undefined}>
      <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>AI 正在思考…</span>
    </div>
  )
}

export const TypingIndicator = memo(TypingIndicatorComponent)
