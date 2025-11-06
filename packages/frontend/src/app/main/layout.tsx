'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSettingsStore } from '@/store/settings-store'
import { useChatStore } from '@/store/chat-store'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { MainContent } from '@/components/main-content'
import { ModelSelector } from '@/components/model-selector'
import { UserMenu } from '@/components/user-menu'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'
import { useAuthStore } from '@/store/auth-store'
import { persistPreferredModel } from '@/store/model-preference-store'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { theme, setTheme, sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()
  const { currentSession } = useChatStore()
  const actorState = useAuthStore((state) => state.actorState)
  const actorType = actorState === 'authenticated' ? 'user' : 'anonymous'
  const [mounted, setMounted] = useState(false)
  const router = useRouter()

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

  const isActorReady = actorState !== 'loading'

  return (
    <div className="flex h-screen min-h-0 w-full min-w-0 bg-background overflow-x-hidden">
      <Sidebar />
      <MainContent className="relative">
        {!isActorReady ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center text-muted-foreground space-y-3">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary" />
              <p>正在同步身份信息...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="lg:hidden sticky top-0 z-40 grid grid-cols-3 items-center gap-2 px-4 py-3 border-b border-border/60 rounded-b-3xl shadow-sm bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="justify-self-start">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={sidebarCollapsed ? '展开侧边栏' : '打开侧边栏'}
                  className="h-10 w-10 rounded-full border border-border/50 bg-background/60 hover:bg-accent/60"
                  onClick={() => {
                    try {
                      if (sidebarCollapsed) {
                        setSidebarCollapsed(false)
                      }
                      window.dispatchEvent(new Event('aichat:sidebar-open'))
                    } catch {}
                  }}
                >
                  <SidebarToggleIcon className="h-5 w-5" />
                </Button>
              </div>
              <div className="justify-self-center">
                <ModelSelector
                  selectedModelId={currentSession?.modelLabel || currentSession?.modelRawId || null}
                  onModelChange={(model) => {
                    const cur = useChatStore.getState().currentSession
                    if (cur) {
                      void persistPreferredModel(model, { actorType })
                      useChatStore.getState().switchSessionModel(cur.id, model)
                    } else {
                      void persistPreferredModel(model, { actorType })
                      useChatStore
                        .getState()
                        .createSession(model.id, '新的对话', model.connectionId, model.rawId)
                        .then((created) => {
                          if (created?.id) {
                            router.push(`/main/${created.id}`)
                          }
                        })
                    }
                  }}
                  className="w-[60vw] max-w-[280px]"
                />
              </div>
              <div className="justify-self-end">
                <UserMenu variant="icon" />
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {children}
            </div>
          </div>
        )}
      </MainContent>
    </div>
  )
}
