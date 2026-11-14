'use client'

import type { ModelItem } from '@/store/models-store'
import { UserMenu } from '@/components/user-menu'

export interface ChatToolbarProps {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
}

export function ChatToolbar(_props: ChatToolbarProps) {
  return (
    <>

      <div className="hidden lg:block absolute top-3 right-4 z-30">
        <UserMenu />
      </div>
    </>
  )
}
