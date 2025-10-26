'use client'

// 移动端主布局：提供顶部导航与内容区容器。
// 采用独立路由 /m/*，以便与桌面端完全解耦且可随时按需调整。

import { useEffect, useState } from 'react'
import { AuthGuard } from '@/components/auth-guard'
import { useSettingsStore } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import { Sidebar } from '@/components/sidebar'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'

export default function MobileMainLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useSettingsStore()
  const [mounted, setMounted] = useState(false)
  const { currentSession } = useChatStore()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (mounted) setTheme(theme) }, [mounted, theme, setTheme])
  if (!mounted) return null

  return (
    <AuthGuard>
      {/* Sidebar 组件内已自带移动端 Sheet + 固定的菜单按钮 */}
      <Sidebar />
      <div className="flex h-screen min-h-0 w-full min-w-0 bg-background overflow-x-hidden">
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* 顶部栏（移动端）：左侧菜单按钮 + 中间模型选择器；移除Logo及右侧按钮 */}
          <div className="sticky top-0 z-40 px-4 py-3 border-b grid grid-cols-3 items-center bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {/* 左：菜单按钮（保留） */}
            <div className="justify-self-start">
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label="菜单"
                onClick={() => { try { window.dispatchEvent(new Event('aichat:sidebar-open')) } catch {} }}
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
            {/* 中：模型选择器（无会话也显示；选择即创建/切换） */}
            <div className="justify-self-center">
              <ModelSelector
                selectedModelId={currentSession?.modelLabel || currentSession?.modelRawId || null}
                onModelChange={(modelId) => {
                  const cur = useChatStore.getState().currentSession
                  if (cur) {
                    useChatStore.getState().switchSessionModel(cur.id, modelId)
                  } else {
                    useChatStore.getState().createSession(modelId, '新的对话')
                  }
                }}
                className="w-[60vw] max-w-[280px]"
              />
            </div>
            {/* 右：占位，确保中间绝对居中 */}
            <div className="justify-self-end">
              <Button variant="outline" size="icon" aria-hidden className="opacity-0 pointer-events-none lg:hidden">
                <Menu className="h-4 w-4" />
              </Button>
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
