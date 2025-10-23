'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const { user, isLoading, getCurrentUser } = useAuthStore()
  const requested = useRef(false)

  useEffect(() => {
    // 基于 Cookie：进入受保护区时拉取当前用户
    if (!requested.current) {
      requested.current = true
      getCurrentUser()
    }
  }, [getCurrentUser])

  // 未获取到用户前显示加载；获取失败时 getCurrentUser 会触发 401 处理并重定向
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
