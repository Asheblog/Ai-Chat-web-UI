"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { settingsNav } from "./nav"
import { SettingsShellNested } from "./shell-nested"
import { useAuthStore } from "@/store/auth-store"
import { PersonalModelsPage } from "./pages/PersonalModels"
import { PersonalPreferencesPage } from "./pages/PersonalPreferences"
import { AboutPage } from "./pages/About"
import { SystemGeneralPage } from "./pages/SystemGeneral"
import { SystemNetworkPage } from "./pages/SystemNetwork"
import { SystemModelsPage } from "./pages/SystemModels"
import { SystemUsersPage } from "./pages/SystemUsers"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: "personal" | "system"
}

export function SettingsDialog({ open, onOpenChange, defaultTab = "personal" }: SettingsDialogProps) {
  const { user } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeMain, setActiveMain] = useState<string>(defaultTab)
  const [activeSub, setActiveSub] = useState<string>("personal.models")

  // 初始化：来自 URL > localStorage > 角色默认
  useEffect(() => {
    const urlMain = searchParams?.get('main')
    const urlSub = searchParams?.get('sub')
    const memMain = typeof window !== 'undefined' ? localStorage.getItem('settings:lastMain') || undefined : undefined
    const memSub = typeof window !== 'undefined' ? localStorage.getItem('settings:lastSub') || undefined : undefined
    const isAdmin = user?.role === 'ADMIN'
    const defMain = isAdmin ? (defaultTab || 'system') : 'personal'
    const defSub = isAdmin ? (defMain === 'system' ? 'system.general' : 'personal.models') : 'personal.models'
    setActiveMain((urlMain || memMain || defMain) as string)
    setActiveSub((urlSub || memSub || defSub) as string)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, open])

  // 同步 URL 与记忆
  useEffect(() => {
    if (!open) return
    const sp = new URLSearchParams(searchParams?.toString())
    sp.set('settings', '1')
    sp.set('main', activeMain)
    sp.set('sub', activeSub)
    router.replace(`${pathname}?${sp.toString()}`)
    if (typeof window !== 'undefined') {
      localStorage.setItem('settings:lastMain', activeMain)
      localStorage.setItem('settings:lastSub', activeSub)
    }
  }, [open, activeMain, activeSub, pathname, router, searchParams])

  // 关闭时清理 URL 的 settings 参数（保留其他参数）
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      const sp = new URLSearchParams(searchParams?.toString())
      sp.delete('settings'); sp.delete('main'); sp.delete('sub')
      router.replace(`${pathname}?${sp.toString()}`)
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[1000px] w-[92vw] h-[82vh] max-h-[85vh] p-0 sm:rounded-2xl border shadow-[0_24px_64px_rgba(0,0,0,0.18)] overflow-hidden flex flex-col min-h-0">
        {(() => {
          const tree = settingsNav.filter(m => !m.adminOnly || user?.role === 'ADMIN')
          const mains = tree.map(m => ({ key: m.key, label: m.label }))
          const subs = (tree.find(m => m.key === activeMain)?.children || []).map(s => ({ key: s.key, label: s.label }))
          const render = () => {
            switch (activeSub) {
              case 'personal.models': return <PersonalModelsPage />
              case 'personal.preferences': return <PersonalPreferencesPage />
              case 'personal.about': return <AboutPage />
              case 'system.general': return <SystemGeneralPage />
              case 'system.network': return <SystemNetworkPage />
              case 'system.models': return <SystemModelsPage />
              case 'system.users': return <SystemUsersPage />
              default: return null
            }
          }
          // 子菜单保护：若切换到没有的子项，重置到第一个
          const safeSub = subs.length>0 ? subs.some(s=>s.key===activeSub) ? activeSub : subs[0].key : ''
          if (safeSub !== activeSub) setActiveSub(safeSub)
          return (
            <SettingsShellNested
              title="设置"
              tree={tree}
              activeMain={activeMain}
              activeSub={safeSub}
              onChangeMain={(k)=>{ setActiveMain(k); const first=(tree.find(m=>m.key===k)?.children||[])[0]; setActiveSub(first?.key||'') }}
              onChangeSub={setActiveSub}
            >
              {render()}
            </SettingsShellNested>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
