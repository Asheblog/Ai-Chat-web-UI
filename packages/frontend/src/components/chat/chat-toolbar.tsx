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
    <div className="hidden h-14 items-center bg-[hsl(var(--background-alt))/0.86] px-4 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--background-alt))/0.72] lg:flex">
      <div className="flex w-full items-center justify-between gap-4">
        <ModelSelector selectedModelId={selectedModelId} onModelChange={onModelChange} />
        <UserMenu />
      </div>
    </div>
  )
}
