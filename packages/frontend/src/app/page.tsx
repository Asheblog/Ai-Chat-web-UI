'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    // 在客户端直接读取 localStorage，避免 Zustand 持久化未水合导致的误判
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (token) {
      router.replace('/main')
    } else {
      router.replace('/auth/login')
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">正在跳转...</p>
      </div>
    </div>
  )
}
