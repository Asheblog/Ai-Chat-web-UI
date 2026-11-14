'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import { useSettingsStore } from '@/store/settings-store'
import { useChatStore } from '@/store/chat-store'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { ModelSelector } from '@/components/model-selector'
import { UserMenu } from '@/components/user-menu'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'
import { useAuthStore } from '@/store/auth-store'
import { persistPreferredModel } from '@/store/model-preference-store'
import { SkillApprovalInbox } from '@/components/skills/skill-approval-inbox'
import { useMainBootstrap } from '@/hooks/use-main-bootstrap'
import { AppShell } from '@/components/app-shell'

// 首次安装向导只在管理员身份下加载；内部系统连接页再由向导自身分包。
const SetupWizard = dynamic(
  () => import('@/components/setup-wizard/setup-wizard').then((m) => m.SetupWizard),
  {
    ssr: false,
    loading: () => null,
  },
)

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed)
  const currentSession = useChatStore((state) => state.currentSession)
  const actorState = useAuthStore((state) => state.actorState)
  const userRole = useAuthStore((state) => state.user?.role ?? null)
  const [mounted, setMounted] = useState(false)
  const actorType = actorState === 'authenticated' ? 'user' : 'anonymous'
  const router = useRouter()
  const { setTheme } = useTheme()

  useMainBootstrap(true)

  // SSR 与客户端首帧都渲染骨架；挂载后再读持久化身份，避免水合不一致。
  useEffect(() => {
    setMounted(true)
  }, [])

  // 迁移旧 Zustand 主题设置到 next-themes（仅执行一次）
  useEffect(() => {
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
  }, [setTheme])

  const isActorReady = mounted && actorState !== 'loading'
  const isAdmin = actorState === 'authenticated' && userRole === 'ADMIN'

  const toolbar = (
            <div className="v2-toolbar sticky top-0 z-40 grid grid-cols-3 items-center gap-2 px-4 lg:hidden">
              <div className="justify-self-start">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={sidebarCollapsed ? '展开侧边栏' : '打开侧边栏'}
                  className="group/sidebar-toggle h-8 w-8 rounded-[8px] text-ink-tertiary hover:bg-surface-hover hover:text-foreground"
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
  )

  return (
    <AppShell
      ready={isActorReady}
      sidebar={<Sidebar />}
      toolbar={toolbar}
    >
      {isAdmin ? <SetupWizard /> : null}
      {isActorReady ? <SkillApprovalInbox /> : null}
      {children}
    </AppShell>
  )
}
