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
    <>
      <div className="hidden lg:block absolute top-3 left-4 z-30">
        <ModelSelector selectedModelId={selectedModelId} onModelChange={onModelChange} />
      </div>
      <div className="hidden lg:block absolute top-3 right-4 z-30">
        <UserMenu />
      </div>
    </>
  )
}
