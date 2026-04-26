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
    <div className="v2-toolbar hidden items-center px-5 lg:flex">
      <div className="flex w-full items-center justify-between gap-4">
        <ModelSelector selectedModelId={selectedModelId} onModelChange={onModelChange} />
        <UserMenu />
      </div>
    </div>
  )
}
