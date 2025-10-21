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
    // 先用 localStorage 的 token 做同步判断，避免持久化未水合导致的误跳转
    const lsToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!lsToken) {
      router.replace('/auth/login')
      return
    }

    // 若存在 token 但缺少用户信息，补拉取当前用户
    if (!user) {
      getCurrentUser()
    }
  }, [user, router, getCurrentUser])

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
