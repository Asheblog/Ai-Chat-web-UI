"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { settingsNav, type SettingsNavItem } from "./nav"
import { SettingsShell } from "./shell"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
// import { PersonalModelsPage } from "./pages/PersonalModels"
import { PersonalPreferencesPage } from "./pages/PersonalPreferences"
import { PersonalSecurityPage } from "./pages/PersonalSecurity"
import { AboutPage } from "./pages/About"
import { SystemGeneralPage } from "./pages/SystemGeneral"
import { SystemNetworkPage } from "./pages/SystemNetwork"
import { SystemReasoningPage } from "./pages/SystemReasoning"
import { SystemModelsPage } from "./pages/SystemModels"
// import { SystemModelsPage } from "./pages/SystemModels"
import { SystemUsersPage } from "./pages/SystemUsers"
import { SystemConnectionsPage } from "./pages/SystemConnections"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: "personal" | "system"
}

export function SettingsDialog({ open, onOpenChange, defaultTab = "personal" }: SettingsDialogProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAuthenticated = actorState === 'authenticated'
  const isAdmin = isAuthenticated && user?.role === 'ADMIN'
  const isAnonymous = !isAuthenticated
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeMain, setActiveMain] = useState<string>(defaultTab)
  const [activeSub, setActiveSub] = useState<string>("personal.about")
  const denialNotifiedRef = useRef(false)

  const filteredTree = useMemo<SettingsNavItem[]>(() => {
    return settingsNav.reduce<SettingsNavItem[]>((acc, item) => {
      if (item.adminOnly && !isAdmin) return acc
      if (item.requiresAuth && !isAuthenticated) return acc
      const children = (item.children || []).filter((child) => {
        if (child.adminOnly && !isAdmin) return false
        if (child.requiresAuth && !isAuthenticated) return false
        return true
      })
      if (children.length === 0 && (item.children?.length ?? 0) > 0) {
        return acc
      }
      acc.push({ ...item, children })
      return acc
    }, [])
  }, [isAdmin, isAuthenticated])

  useEffect(() => {
    if (!open) {
      denialNotifiedRef.current = false
    }
  }, [open])

  // 初始化：来自 URL > localStorage > 角色默认
  useEffect(() => {
    if (!open || filteredTree.length === 0) return
    const urlMain = searchParams?.get('main')
    const urlSub = searchParams?.get('sub')
    const memMain = isAuthenticated && typeof window !== 'undefined'
      ? localStorage.getItem('settings:lastMain') || undefined
      : undefined
    const memSub = isAuthenticated && typeof window !== 'undefined'
      ? localStorage.getItem('settings:lastSub') || undefined
      : undefined
    const roleDefaultMain = isAdmin ? (defaultTab || 'system') : 'personal'
    let nextMain = (urlMain || memMain || roleDefaultMain) as string
    const availableMains = filteredTree.map((item) => item.key)
    if (!availableMains.includes(nextMain)) {
      if (!denialNotifiedRef.current && urlMain) {
        toast({
          title: urlMain === 'system' ? '你无权打开该功能' : '当前账户无法访问该设置',
          variant: 'destructive',
        })
        denialNotifiedRef.current = true
      }
      nextMain = filteredTree[0]?.key ?? 'personal'
    }
    setActiveMain(nextMain)

    const subs = filteredTree.find((item) => item.key === nextMain)?.children ?? []
    const roleDefaultSub =
      nextMain === 'system'
        ? 'system.general'
        : (isAuthenticated ? 'personal.preferences' : 'personal.about')
    let nextSub = (urlSub || memSub || roleDefaultSub || subs[0]?.key || '') as string
    if (nextSub && !subs.some((item) => item.key === nextSub)) {
      if (!denialNotifiedRef.current && (urlSub || urlMain)) {
        toast({
          title: '当前账户无法访问该设置',
          variant: 'destructive',
        })
        denialNotifiedRef.current = true
      }
      nextSub = subs[0]?.key || ''
    }
    setActiveSub(nextSub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filteredTree, searchParams, isAuthenticated, isAdmin, defaultTab, toast])

  // 树结构变化时校正子项
  useEffect(() => {
    if (filteredTree.length === 0) return
    if (!filteredTree.some((item) => item.key === activeMain)) {
      setActiveMain(filteredTree[0].key)
      return
    }
    const subs = filteredTree.find((item) => item.key === activeMain)?.children ?? []
    if (activeSub && !subs.some((item) => item.key === activeSub)) {
      setActiveSub(subs[0]?.key || '')
    }
  }, [filteredTree, activeMain, activeSub])

  // 同步 URL 与记忆
  useEffect(() => {
    if (!open || !activeMain) return
    const sp = new URLSearchParams(searchParams?.toString())
    sp.set('settings', '1')
    sp.set('main', activeMain)
    if (activeSub) {
      sp.set('sub', activeSub)
    } else {
      sp.delete('sub')
    }
    router.replace(`${pathname}?${sp.toString()}`)
    if (isAuthenticated && typeof window !== 'undefined') {
      localStorage.setItem('settings:lastMain', activeMain)
      localStorage.setItem('settings:lastSub', activeSub)
    }
  }, [open, activeMain, activeSub, pathname, router, searchParams, isAuthenticated])

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
      <DialogContent
        className="w-screen h-[100dvh] max-w-none border-0 p-0 shadow-none sm:w-[92vw] sm:h-[82vh] sm:max-h-[85vh] sm:max-w-5xl sm:border sm:rounded-2xl sm:shadow-2xl flex flex-col min-h-0 overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] animate-in fade-in-0 zoom-in-95 duration-200"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>管理系统与个人配置项</DialogDescription>
        </DialogHeader>
        {filteredTree.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            当前账户没有可用的设置项
          </div>
        ) : (
          <SettingsShell
            mode="nested"
            title="设置"
            tree={filteredTree}
            activeMain={activeMain}
            activeSub={activeSub}
            onChangeMain={(key) => {
              setActiveMain(key)
              const first = filteredTree.find((item) => item.key === key)?.children?.[0]?.key || ''
              setActiveSub(first)
            }}
            onChangeSub={setActiveSub}
            readOnly={isAnonymous}
            readOnlyMessage="当前为匿名访客，仅可浏览公开信息。请登录后再编辑设置。"
          >
            {(() => {
              switch (activeSub) {
                // case 'personal.models': return <PersonalModelsPage />
                case 'personal.preferences': return <PersonalPreferencesPage />
                case 'personal.security': return <PersonalSecurityPage />
                case 'personal.about': return <AboutPage />
                case 'system.general': return <SystemGeneralPage />
                case 'system.network': return <SystemNetworkPage />
                case 'system.reasoning': return <SystemReasoningPage />
                case 'system.connections': return <SystemConnectionsPage />
                case 'system.models': return <SystemModelsPage />
                case 'system.users': return <SystemUsersPage />
                default:
                  return activeSub ? (
                    <div className="p-6 text-sm text-muted-foreground">
                      当前账户无法访问该设置
                    </div>
                  ) : <AboutPage />
              }
            })()}
          </SettingsShell>
        )}
      </DialogContent>
    </Dialog>
  )
}
