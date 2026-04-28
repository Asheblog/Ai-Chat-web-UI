'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
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
import { SetupWizard } from '@/components/setup-wizard/setup-wizard'
import { SkillApprovalInbox } from '@/components/skills/skill-approval-inbox'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { sidebarCollapsed, setSidebarCollapsed, fetchSystemSettings } = useSettingsStore()
  const currentSession = useChatStore((state) => state.currentSession)
  const actorState = useAuthStore((state) => state.actorState)
  const actorType = actorState === 'authenticated' ? 'user' : 'anonymous'
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  // 迁移旧 Zustand 主题设置到 next-themes（仅执行一次）
  useEffect(() => {
    if (!mounted) return
    try {
      if (localStorage.getItem('theme-migrated')) return
      const raw = localStorage.getItem('settings-storage')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.state?.theme) {
          setTheme(parsed.state.theme)
        }
      }
    } catch {}
    localStorage.setItem('theme-migrated', '1')
  }, [mounted, setTheme])

  const hasRequestedSettings = useRef(false)
  useEffect(() => {
    if (!mounted) return
    if (actorState !== 'authenticated') {
      hasRequestedSettings.current = false
      return
    }
    if (hasRequestedSettings.current) return
    hasRequestedSettings.current = true
    fetchSystemSettings().catch(() => {
      hasRequestedSettings.current = false
    })
  }, [actorState, fetchSystemSettings, mounted])

  // 防止服务端渲染hydration问题
  if (!mounted) {
    return null
  }

  const isActorReady = actorState !== 'loading'

  return (
    <div className="flex h-screen min-h-0 w-full min-w-0 overflow-x-hidden bg-background">
      <Sidebar />
      <MainContent className="v2-app-surface relative border-l border-border">
        <SetupWizard />
        <SkillApprovalInbox />
        {!isActorReady ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="space-y-3 text-center text-muted-foreground">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-border/80 border-t-primary" />
              <p>正在同步身份信息...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="v2-toolbar sticky top-0 z-40 grid grid-cols-3 items-center gap-2 px-4 lg:hidden">
              <div className="justify-self-start">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={sidebarCollapsed ? '展开侧边栏' : '打开侧边栏'}
                  className="group/sidebar-toggle h-10 w-10 rounded-[10px] border border-border bg-surface hover:bg-accent hover:text-primary"
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
                  selectedModelId={
                    currentSession && typeof currentSession.connectionId === 'number' && currentSession.modelRawId
                      ? `${currentSession.connectionId}:${currentSession.modelRawId}`
                      : null
                  }
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
                  size="sm"
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
