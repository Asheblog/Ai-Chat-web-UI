"use client"
import { ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  PackageCheck,
  Share2,
  ShieldCheck,
  User,
} from "lucide-react"
import { settingsNav, type SettingsNavItem } from "@/components/settings/nav"
import { SettingsShell, type SettingsSection } from "@/components/settings/shell"
import { DEFAULT_SYSTEM_LEAF } from "@/components/settings/system-settings-registry"
import { useAuthStore } from "@/store/auth-store"

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

  // Personal sections (flat, unchanged)
  const personalSections = useMemo<SettingsSection[]>(() => [
    { key: "profile", label: "个人资料与偏好", icon: <User className="h-full w-full" />, },
    { key: "skills", label: "个人 Skills", icon: <PackageCheck className="h-full w-full" />, },
    { key: "shares", label: "分享管理", icon: <Share2 className="h-full w-full" />, },
    { key: "security", label: "账号安全", icon: <ShieldCheck className="h-full w-full" />, },
  ], [])

  // System 3-level tree from shared nav
  const systemTree = useMemo<SettingsNavItem[]>(() => {
    const sys = settingsNav.find((item) => item.key === "system")
    return sys ? [sys] : []
  }, [])

  useEffect(() => {
    if (!isAdmin && activeSection === "system") {
      if (pathname === SECTION_PATH.personal) return
      if (redirectedRef.current === SECTION_PATH.personal) return
      redirectedRef.current = SECTION_PATH.personal
      router.replace(SECTION_PATH.personal)
    }
  }, [isAdmin, activeSection, pathname, router])

  useEffect(() => {
    if (activeSection !== "system") return
    // Sync nav from SystemSettings changes
    const onActiveChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key) {
        setSystemSub(detail.key)
      }
    }
    window.addEventListener("aichat:system-settings-active", onActiveChange as EventListener)
    return () => {
      window.removeEventListener("aichat:system-settings-active", onActiveChange as EventListener)
    }
  }, [activeSection])

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
        activeMain="system"
        activeSub={systemSub}
        onChangeMain={() => {}}
        onChangeSub={handleSystemSubChange}
        showNavTitle
      >
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
