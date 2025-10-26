'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'
import { MainContent } from '@/components/main-content'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { theme, setTheme } = useSettingsStore()
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    // 应用主题设置
    if (mounted) {
      setTheme(theme)
    }
  }, [theme, setTheme, mounted])

  // 防止服务端渲染hydration问题
  if (!mounted) {
    return null
  }

  return (
    <AuthGuard>
      <div className="flex h-screen min-h-0 w-full min-w-0 bg-background overflow-x-hidden">
        {!sidebarCollapsed && <Sidebar />}
        <MainContent>
          {children}
        </MainContent>
        {/* 当折叠侧边栏时，提供一个在桌面端显示的打开按钮（固定在左上） */}
        {sidebarCollapsed && (
          <div className="hidden lg:block fixed top-4 left-4 z-40">
            <Button variant="outline" size="icon" onClick={() => setSidebarCollapsed(false)} aria-label="展开侧边栏">
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
