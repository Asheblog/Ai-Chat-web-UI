'use client'

import { ModelSelector } from '@/components/model-selector'
import { UserMenu } from '@/components/user-menu'
import { useWelcomeScreenViewModel } from '@/features/chat/welcome/useWelcomeScreenViewModel'
import { WelcomeHero } from '@/features/chat/welcome/WelcomeHero'
import { WelcomeForm } from '@/features/chat/welcome/WelcomeForm'

export function WelcomeScreen() {
  const { header, hero, form, footerNote } = useWelcomeScreenViewModel()
  return (
    <div className="relative flex-1 flex flex-col">
      <header className="v2-toolbar hidden items-center px-5 lg:flex">
        <div className="flex w-full items-center justify-between gap-4">
          <ModelSelector
            selectedModelId={header.selectedModelId}
            onModelChange={header.onModelChange}
            disabled={header.disabled}
          />
          <UserMenu />
        </div>
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 pb-6 sm:px-6 lg:px-8">
        <WelcomeHero {...hero} />
        <WelcomeForm form={form} />
        <p className="mt-8 text-xs sm:text-[13px] text-muted-foreground text-center px-4">{footerNote}</p>
      </div>
    </div>
  )
}
