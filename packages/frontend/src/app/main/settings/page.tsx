'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function SettingsIndexPage() {
  const router = useRouter()
  const { user, actorState } = useAuthStore((state) => ({
    user: state.user,
    actorState: state.actorState,
  }))

  useEffect(() => {
    if (actorState === 'loading') return
    const target = user?.role === 'ADMIN' ? '/main/settings/system' : '/main/settings/personal'
    router.replace(target)
  }, [actorState, router, user?.role])

  return (
    <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在跳转到设置…
    </div>
  )
}
