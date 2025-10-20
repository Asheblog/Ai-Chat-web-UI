'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const { user, token, getCurrentUser } = useAuthStore()

  useEffect(() => {
    // 如果没有token，重定向到登录页面
    if (!token) {
      router.push('/auth/login')
      return
    }

    // 如果有token但没有用户信息，尝试获取用户信息
    if (token && !user) {
      getCurrentUser()
    }
  }, [token, user, router, getCurrentUser])

  // 如果没有用户信息，显示加载状态
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}