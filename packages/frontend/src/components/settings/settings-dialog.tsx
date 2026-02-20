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
import { SystemGeneralPage } from "@/features/settings/pages/system-general"
import { SystemNetworkPage } from "./pages/SystemNetwork"
import { SystemReasoningPage } from "./pages/SystemReasoning"
import { SystemModelsPage } from "@/features/settings/pages/system-models"
// import { SystemModelsPage } from "./pages/SystemModels"
import { SystemUsersPage } from "./pages/SystemUsers"
import { SystemModelAccessPage } from "./pages/SystemModelAccess"
import { SystemConnectionsPage } from "./pages/SystemConnections"
import { SystemWebSearchPage } from "./pages/SystemWebSearch"
import { SystemMonitoringPage } from "./pages/SystemMonitoring"
import { SystemRAGPage } from "./pages/SystemRAG"
import { SystemKnowledgeBasePage } from "./pages/SystemKnowledgeBase"

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
  const lastClearedHrefRef = useRef<string | null>(null)
  const openedFromQueryRef = useRef(false)
  const closeCleanupTimerRef = useRef<number | null>(null)

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
      lastClearedHrefRef.current = null
      openedFromQueryRef.current = false
      if (closeCleanupTimerRef.current) {
        window.clearTimeout(closeCleanupTimerRef.current)
        closeCleanupTimerRef.current = null
      }
      return
    }
    const currentSearch =
      typeof window !== 'undefined'
        ? window.location.search.replace(/^\?/, '')
        : (searchParams?.toString() ?? '')
    const sp = new URLSearchParams(currentSearch)
    const main = sp.get('main')
    const sub = sp.get('sub')
    const hasLegacySettingsHint =
      main === 'personal' ||
      main === 'system' ||
      sub?.startsWith('personal.') ||
      sub?.startsWith('system.')
    // 仅深链进入 settings 时标记 URL 清理；普通按钮打开不改 URL，避免路由重渲染闪烁。
    openedFromQueryRef.current = sp.get('settings') === '1' || Boolean(hasLegacySettingsHint)
    if (closeCleanupTimerRef.current) {
      window.clearTimeout(closeCleanupTimerRef.current)
      closeCleanupTimerRef.current = null
    }
  }, [open, searchParams])

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

  // 仅同步记忆；不在弹窗打开期间写 URL，避免动画期路由重渲染造成闪烁。
  useEffect(() => {
    if (!open || !activeMain) return
    if (isAuthenticated && typeof window !== 'undefined') {
      localStorage.setItem('settings:lastMain', activeMain)
      localStorage.setItem('settings:lastSub', activeSub)
    }
  }, [open, activeMain, activeSub, isAuthenticated])

  // 关闭时清理 URL 的 settings 参数（保留其他参数）
  const handleOpenChange = (v: boolean) => {
    onOpenChange(v)
    if (!v) {
      if (closeCleanupTimerRef.current) {
        window.clearTimeout(closeCleanupTimerRef.current)
        closeCleanupTimerRef.current = null
      }
      if (!openedFromQueryRef.current) {
        lastClearedHrefRef.current = null
        return
      }
      const cleanupUrl = () => {
        const currentSearch =
          typeof window !== 'undefined'
            ? window.location.search.replace(/^\?/, '')
            : (searchParams?.toString() ?? '')
        const sp = new URLSearchParams(currentSearch)
        const hadSettingsParams = sp.has('settings') || sp.has('main') || sp.has('sub')
        sp.delete('settings')
        sp.delete('main')
        sp.delete('sub')
        const query = sp.toString()
        const href = query ? `${pathname}?${query}` : pathname
        const currentHref =
          typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}`
            : (searchParams?.toString() ? `${pathname}?${searchParams.toString()}` : pathname)
        if (hadSettingsParams && lastClearedHrefRef.current !== href && currentHref !== href) {
          lastClearedHrefRef.current = href
          router.replace(href)
        }
        openedFromQueryRef.current = false
      }
      // 等待关闭动画接近结束再清 URL，避免路由更新与退场动画叠加导致的视觉闪烁。
      if (typeof window !== 'undefined') {
        closeCleanupTimerRef.current = window.setTimeout(cleanupUrl, 180)
      } else {
        cleanupUrl()
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="h-[100dvh] w-screen max-w-none border-0 bg-[hsl(var(--surface))/0.96] p-0 shadow-none sm:h-[84vh] sm:max-h-[86vh] sm:w-[92vw] sm:max-w-5xl sm:rounded-[calc(var(--radius)+0.4rem)] sm:border sm:border-border/80 sm:bg-card/95 sm:shadow-[0_30px_80px_hsl(var(--background)/0.5)] flex min-h-0 flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
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
                case 'system.web-search': return <SystemWebSearchPage />
                case 'system.rag': return <SystemRAGPage />
                case 'system.connections': return <SystemConnectionsPage />
                case 'system.models': return <SystemModelsPage />
                case 'system.model-access': return <SystemModelAccessPage />
                case 'system.logging': return <SystemMonitoringPage />
                case 'system.users': return <SystemUsersPage />
                case 'system.knowledge-base': return <SystemKnowledgeBasePage />
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
