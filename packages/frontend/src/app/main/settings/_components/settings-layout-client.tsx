"use client"
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  PackageCheck,
  Share2,
  ShieldCheck,
  User,
} from "lucide-react"
import { settingsNav, type SettingsNavItem } from "@/components/settings/nav"
import { SettingsShell, type SettingsSection } from "@/components/settings/shell"
import { SettingsSearch } from "@/components/settings/components/settings-search"
import { SettingsLocationBanner } from "@/components/settings/components/settings-location-banner"
import { isDialogOpen, requestFlash } from "@/components/settings/settings-flash-bus"
import { DEFAULT_SYSTEM_LEAF, getAllSystemLeafKeys, getWorkspaceForLeaf } from "@/components/settings/system-settings-registry"
import { useAuthStore } from "@/store/auth-store"

type FlashTarget = { leafKey: string; cardKey?: string }

const SECTION_PATH: Record<string, string> = {
  personal: "/main/settings/personal",
  system: "/main/settings/system",
}

const deriveSection = (pathname: string | null): "personal" | "system" => {
  if (!pathname) return "personal"
  const normalized = pathname.split("?")[0]
  const segments = normalized.split("/").filter(Boolean)
  const settingsIndex = segments.indexOf("settings")
  const next = settingsIndex >= 0 ? segments[settingsIndex + 1] : null
  if (next === "system") return "system"
  return "personal"
}

export function SettingsLayoutClient({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const redirectedRef = useRef<string | null>(null)
  const { user, actorState } = useAuthStore((state) => ({
    user: state.user,
    actorState: state.actorState,
  }))

  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
  const activeSection = deriveSection(pathname)
  const [personalSub, setPersonalSub] = useState("profile")
  const [systemSub, setSystemSub] = useState(DEFAULT_SYSTEM_LEAF)
  const [systemMain, setSystemMain] = useState(DEFAULT_SYSTEM_LEAF)
  const [flashTarget, setFlashTarget] = useState<FlashTarget | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [flashSeq, setFlashSeq] = useState(0)

  // Personal sections (flat, unchanged)
  const personalSections = useMemo<SettingsSection[]>(() => [
    { key: "profile", label: "个人资料与偏好", icon: <User className="h-full w-full" />, },
    { key: "skills", label: "个人 Skills", icon: <PackageCheck className="h-full w-full" />, },
    { key: "shares", label: "分享管理", icon: <Share2 className="h-full w-full" />, },
    { key: "security", label: "账号安全", icon: <ShieldCheck className="h-full w-full" />, },
  ], [])

  // System 3-level tree from shared nav: the system item's children (6 top-level entries)
  const systemTree = useMemo<SettingsNavItem[]>(() => {
    const sys = settingsNav.find((item) => item.key === "system")
    return sys?.children ?? []
  }, [])

  useEffect(() => {
    // 等待 auth 状态就绪再判定，否则 loading 期间会被误判为无权限而重定向
    if (actorState === "loading") return
    if (!isAdmin && activeSection === "system") {
      if (pathname === SECTION_PATH.personal) return
      if (redirectedRef.current === SECTION_PATH.personal) return
      redirectedRef.current = SECTION_PATH.personal
      router.replace(SECTION_PATH.personal)
    }
  }, [actorState, isAdmin, activeSection, pathname, router])

  useEffect(() => {
    if (activeSection !== "system") return
    // Sync nav from SystemSettings changes
    const onActiveChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key) {
        const key = detail.key
        setSystemSub(key)
        setSystemMain((current) => getWorkspaceForLeaf(key) ?? current)
      }
    }
    window.addEventListener("aichat:system-settings-active", onActiveChange as EventListener)
    return () => {
      window.removeEventListener("aichat:system-settings-active", onActiveChange as EventListener)
    }
  }, [activeSection])

  // 搜索框 select（origin=search）：SystemSettings 负责切页，这里只触发位置提醒。
  // Dialog 打开期间由弹窗宿主接管搜索跳转，布局跳过避免重复闪烁与状态残留；
  // key 需在注册表中（防止与树漂移时产生卡死状态）。
  useEffect(() => {
    if (activeSection !== "system") return
    const onSelect = (event: Event) => {
      if (isDialogOpen()) return
      const detail = (event as CustomEvent<{ key?: string; cardKey?: string; origin?: string }>).detail
      if (detail?.origin !== "search" || !detail?.key) return
      if (!getAllSystemLeafKeys().includes(detail.key)) return
      const leafKey = detail.key
      setFlashTarget({ leafKey, cardKey: detail.cardKey })
      setFlashKey(leafKey)
      setFlashSeq((seq) => seq + 1)
      requestFlash({ leafKey, cardKey: detail.cardKey, hostId: "layout" })
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey, cardKey: detail.cardKey, hostId: "layout" },
        })
      )
    }
    window.addEventListener("aichat:system-settings-select", onSelect as EventListener)
    return () => {
      window.removeEventListener("aichat:system-settings-select", onSelect as EventListener)
    }
  }, [activeSection])

  // flashKey 与 flashTarget 分离：导航闪烁结束即清 flashKey，banner 自管 3s
  const handleFlashDone = useCallback(() => {
    setFlashKey(null)
  }, [])

  useEffect(() => {
    if (activeSection !== "personal") return
    if (typeof window === "undefined") return

    const applyHashSelection = () => {
      const hash = window.location.hash.replace(/^#/, "")
      const nextKeyByHash: Record<string, string> = {
        "settings-personal-preferences": "profile",
        "settings-personal-skills": "skills",
        "settings-share-management": "shares",
        "settings-personal-security": "security",
      }
      const nextKey = nextKeyByHash[hash]
      if (!nextKey) return
      setPersonalSub(nextKey)
      window.requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }

    applyHashSelection()
    window.addEventListener("hashchange", applyHashSelection)
    return () => {
      window.removeEventListener("hashchange", applyHashSelection)
    }
  }, [activeSection])

  const handleChange = (key: string) => {
    if (activeSection === "personal") {
      setPersonalSub(key)
      const targetIdByKey: Record<string, string> = {
        profile: "settings-personal-preferences",
        skills: "settings-personal-skills",
        shares: "settings-share-management",
        security: "settings-personal-security",
      }
      const targetId = targetIdByKey[key] || "settings-personal-preferences"
      const target = typeof document !== "undefined" ? document.getElementById(targetId) : null
      target?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }

    // System: leaf selection from nested nav
    if (activeSection === "system") {
      if (key === "personal-skills") {
        setPersonalSub("skills")
        router.push(`${SECTION_PATH.personal}#settings-personal-skills`)
        return
      }
      setSystemSub(key)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail: { key } }))
      }
      return
    }

    const target = SECTION_PATH[key]
    if (!target) return
    if (target === pathname) return
    router.push(target)
  }

  // System leaf selected via nested nav
  const handleSystemSubChange = (key: string) => {
    setSystemSub(key)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail: { key } }))
    }
  }

  if (!isAdmin && activeSection === "system") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        当前账户无权访问系统设置，正在跳转到个人设置…
      </div>
    )
  }

  if (activeSection === "system") {
    return (
      <SettingsShell
        mode="nested"
        title="系统设置"
        tree={systemTree}
        activeMain={systemMain}
        activeSub={systemSub}
        onChangeMain={setSystemMain}
        onChangeSub={handleSystemSubChange}
        showNavTitle
        navTop={<SettingsSearch />}
        flashKey={flashKey}
        onFlashDone={handleFlashDone}
      >
        {flashTarget && (
          <SettingsLocationBanner
            key={flashSeq}
            leafKey={flashTarget.leafKey}
            cardKey={flashTarget.cardKey}
          />
        )}
        {children}
      </SettingsShell>
    )
  }

  const resolvedActive = personalSub

  return (
    <SettingsShell
      title="个人设置"
      sections={personalSections}
      active={resolvedActive}
      onChange={handleChange}
      showNavTitle={false}
    >
      {children}
    </SettingsShell>
  )
}
