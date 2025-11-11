'use client'

interface ChatErrorBannerProps {
  error: unknown
}

export function ChatErrorBanner({ error }: ChatErrorBannerProps) {
  if (!error) return null
  return (
    <div className="mb-3 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
      {String(error)}
    </div>
  )
}
