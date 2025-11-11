'use client'

interface ChatQuotaNoticeProps {
  message: string | null
}

export function ChatQuotaNotice({ message }: ChatQuotaNoticeProps) {
  if (!message) return null
  return (
    <div className="px-4 md:px-6 pb-3 md:pb-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center rounded-full border border-dashed border-muted-foreground/40 px-3 py-1">
        {message}
      </span>
    </div>
  )
}
