'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function HomePage() {
  const router = useRouter()
  const { user, token } = useAuthStore()

  useEffect(() => {
    // 如果已登录，重定向到主页面
    if (user && token) {
      router.push('/main')
    } else {
      // 否则重定向到登录页面
      router.push('/auth/login')
    }
  }, [user, token, router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">正在跳转...</p>
      </div>
    </div>
  )
}
