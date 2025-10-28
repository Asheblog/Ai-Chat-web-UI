'use client'

import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/store/settings-store'
import { useChatStore } from '@/store/chat-store'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'
import { MainContent } from '@/components/main-content'
import { ModelSelector } from '@/components/model-selector'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { theme, setTheme, sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()
  const { currentSession } = useChatStore()
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
        <Sidebar />
        <MainContent className="relative">
          <div className="flex flex-col h-full min-h-0">
            <div className="lg:hidden sticky top-0 z-40 px-4 py-3 border-b grid grid-cols-3 items-center bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="justify-self-start">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="菜单"
                  onClick={() => {
                    try {
                      window.dispatchEvent(new Event('aichat:sidebar-open'))
                    } catch {}
                  }}
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </div>
              <div className="justify-self-center">
                <ModelSelector
                  selectedModelId={currentSession?.modelLabel || currentSession?.modelRawId || null}
                  onModelChange={(model) => {
                    const cur = useChatStore.getState().currentSession
                    if (cur) {
                      useChatStore.getState().switchSessionModel(cur.id, model)
                    } else {
                      useChatStore.getState().createSession(model.id, '新的对话', model.connectionId, model.rawId)
                    }
                  }}
                  className="w-[60vw] max-w-[280px]"
                />
              </div>
              <div className="justify-self-end">
                <Button variant="outline" size="icon" aria-hidden className="opacity-0 pointer-events-none">
                  <Menu className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {children}
            </div>
          </div>
        </MainContent>
      </div>
    </AuthGuard>
  )
}
