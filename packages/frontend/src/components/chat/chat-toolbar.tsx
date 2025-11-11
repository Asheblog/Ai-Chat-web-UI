'use client'

import type { ModelItem } from '@/store/models-store'
import { ModelSelector } from '@/components/model-selector'
import { UserMenu } from '@/components/user-menu'

export interface ChatToolbarProps {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
}

export function ChatToolbar({ selectedModelId, onModelChange }: ChatToolbarProps) {
  return (
    <div className="hidden lg:flex bg-background/80 supports-[backdrop-filter]:backdrop-blur px-4 h-14 items-center">
      <div className="flex w-full items-center justify-between gap-4">
        <ModelSelector selectedModelId={selectedModelId} onModelChange={onModelChange} />
        <UserMenu />
      </div>
    </div>
  )
}
