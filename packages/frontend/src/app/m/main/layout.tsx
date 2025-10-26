'use client'

// 移动端主布局：提供顶部导航与内容区容器。
// 采用独立路由 /m/*，以便与桌面端完全解耦且可随时按需调整。

import { useEffect, useState } from 'react'
import { AuthGuard } from '@/components/auth-guard'
import { useSettingsStore } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { Menu, Cog, Monitor } from 'lucide-react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'

export default function MobileMainLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, systemSettings } = useSettingsStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (mounted) setTheme(theme) }, [mounted, theme, setTheme])
  if (!mounted) return null

  return (
    <AuthGuard>
      {/* Sidebar 组件内已自带移动端 Sheet + 固定的菜单按钮 */}
      <Sidebar />
      <div className="flex h-screen min-h-0 bg-background">
        <main className="flex-1 flex flex-col min-h-0">
          {/* 顶部栏（简化） */}
          <div className="px-4 py-3 border-b flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label="菜单"
                onClick={() => { try { window.dispatchEvent(new Event('aichat:sidebar-open')) } catch {} }}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="text-base font-semibold">{systemSettings?.brandText || 'AIChat'}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label="切换到桌面版"
                onClick={() => { try { document.cookie = `viewMode=desktop; Path=/; Max-Age=${60*60*24*30}; SameSite=Lax` } catch {}; window.location.href = '/main' }}
                className="hidden sm:inline-flex"
              >
                <Monitor className="h-4 w-4 mr-1" /> 桌面版
              </Button>
              <Link href="/m/main/settings">
                <Button variant="ghost" size="icon" aria-label="设置"><Cog className="h-4 w-4" /></Button>
              </Link>
            </div>
          </div>
          {/* 内容区 */}
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
