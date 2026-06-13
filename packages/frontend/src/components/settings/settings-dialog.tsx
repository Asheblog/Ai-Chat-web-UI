"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { settingsNav, type SettingsNavItem } from "./nav"
import { SettingsShell } from "./shell"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
// import { PersonalModelsPage } from "./pages/PersonalModels"
import { PersonalPreferencesPage } from "./pages/PersonalPreferences"
import { PersonalSecurityPage } from "./pages/PersonalSecurity"
import { PersonalSkillsPage } from "./pages/PersonalSkills"
import { ShareManagementPanel } from "./pages/ShareManagement"
import { AboutPage } from "./pages/About"
import { DEFAULT_SYSTEM_LEAF, renderSystemLeaf } from "./system-settings-registry"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: "personal" | "system"
}

/** Recursively collect all leaf keys from a nav tree node list. */
function getAllLeafKeys(items: SettingsNavItem[]): string[] {
  const keys: string[] = []
  for (const item of items) {
    if (!item.children || item.children.length === 0) {
      keys.push(item.key)
    } else {
      keys.push(...getAllLeafKeys(item.children))
    }
  }
  return keys
}

/** Find the first leaf key (recursive) from a nav tree node list. */
function findFirstLeaf(items: SettingsNavItem[]): string | undefined {
  for (const item of items) {
    if (!item.children || item.children.length === 0) return item.key
    const found = findFirstLeaf(item.children)
    if (found) return found
  }
  return undefined
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

  /** Recursively filter a nav node by adminOnly/requiresAuth. Returns null if node should be removed. */
  const filterNode = useCallback(
    (node: SettingsNavItem): SettingsNavItem | null => {
      if (node.adminOnly && !isAdmin) return null
      if (node.requiresAuth && !isAuthenticated) return null
      if (!node.children || node.children.length === 0) return node
      const filteredChildren = node.children
        .map((child) => filterNode(child))
        .filter((child): child is SettingsNavItem => child !== null)
      if (filteredChildren.length === 0) return null
      return { ...node, children: filteredChildren }
    },
    [isAdmin, isAuthenticated],
  )

  const filteredTree = useMemo<SettingsNavItem[]>(() => {
    return settingsNav
      .map((item) => filterNode(item))
      .filter((item): item is SettingsNavItem => item !== null)
  }, [filterNode])

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
    const subLeaves = getAllLeafKeys(subs)
    const roleDefaultSub =
      nextMain === 'system'
        ? DEFAULT_SYSTEM_LEAF
        : (isAuthenticated ? 'personal.preferences' : 'personal.about')
    let nextSub = (urlSub || memSub || roleDefaultSub || subLeaves[0] || '') as string
    if (nextSub && !subLeaves.includes(nextSub)) {
      if (!denialNotifiedRef.current && (urlSub || urlMain)) {
        toast({
          title: '当前账户无法访问该设置',
          variant: 'destructive',
        })
        denialNotifiedRef.current = true
      }
      nextSub = nextMain === 'system' ? DEFAULT_SYSTEM_LEAF : (subLeaves[0] || '')
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
    const subLeaves = getAllLeafKeys(subs)
    if (activeSub && !subLeaves.includes(activeSub)) {
      setActiveSub(activeMain === 'system' ? DEFAULT_SYSTEM_LEAF : (subLeaves[0] || ''))
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
        className="v2-app-surface flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden border-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-none sm:h-[92vh] sm:max-h-[92vh] sm:w-[96vw] sm:max-w-[1320px] sm:rounded-[10px] sm:border sm:border-border sm:shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
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
              if (key === 'system') {
                setActiveSub(DEFAULT_SYSTEM_LEAF)
              } else {
                const mainItem = filteredTree.find((item) => item.key === key)
                const first = findFirstLeaf(mainItem?.children || []) || ''
                setActiveSub(first)
              }
            }}
            onChangeSub={setActiveSub}
            readOnly={isAnonymous}
            readOnlyMessage="当前为匿名访客，仅可浏览公开信息。请登录后再编辑设置。"
          >
            {(() => {
              // Personal pages via switch
              switch (activeSub) {
                case 'personal.preferences': return <PersonalPreferencesPage />
                case 'personal.skills': return <PersonalSkillsPage />
                case 'personal.shares': return <ShareManagementPanel />
                case 'personal.security': return <PersonalSecurityPage />
                case 'personal.about': return <AboutPage />
              }
              // System pages via shared registry
              const systemContent = renderSystemLeaf(activeSub)
              if (systemContent) return systemContent
              // Fallback
              return activeSub ? (
                <div className="p-6 text-sm text-muted-foreground">
                  当前账户无法访问该设置
                </div>
              ) : <AboutPage />
            })()}
          </SettingsShell>
        )}
      </DialogContent>
    </Dialog>
  )
}
