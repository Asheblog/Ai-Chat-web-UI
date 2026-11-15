'use client'

import type { ModelItem } from '@/store/models-store'
import { UserMenu } from '@/components/user-menu'

export interface ChatToolbarProps {
  title?: string
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
}

export function ChatToolbar({ title }: ChatToolbarProps) {
  const displayTitle = title?.trim() || '聊天'
  return (
    <header aria-label="当前会话" className="hidden h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6 lg:flex">
      <h1 className="min-w-0 truncate text-sm font-medium" title={displayTitle}>{displayTitle}</h1>
      <div className="shrink-0"><UserMenu /></div>
    </header>
  )
}
