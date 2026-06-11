"use client"
import { ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3,
  BookOpen,
  Boxes,
  Cloud,
  ClipboardList,
  KeyRound,
  PackageCheck,
  PlugZap,
  Router,
  ScrollText,
  Settings2,
  Share2,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from "lucide-react"
import { SettingsShell, type SettingsSection } from "@/components/settings/shell"
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
  const [systemSub, setSystemSub] = useState("connections")

  const sections = useMemo<SettingsSection[]>(() => {
    if (activeSection === "system") {
      return [
        {
          key: "overview",
          label: "概览",
          icon: <BarChart3 className="h-full w-full" />,
        },
        {
          key: "models",
          label: "模型管理",
          icon: <Boxes className="h-full w-full" />,
        },
        {
          key: "connections",
          label: "连接管理",
          icon: <PlugZap className="h-full w-full" />,
        },
        {
          key: "api-routing",
          label: "模型权限",
          icon: <Router className="h-full w-full" />,
        },
        {
          key: "token-management",
          label: "推理配置",
          icon: <KeyRound className="h-full w-full" />,
        },
        {
          key: "members",
          label: "成员与权限",
          icon: <Users className="h-full w-full" />,
        },
        {
          key: "audit",
          label: "审计日志",
          icon: <ClipboardList className="h-full w-full" />,
        },
        {
          key: "system-config",
          label: "系统配置",
          icon: <Settings2 className="h-full w-full" />,
        },
        {
          key: "backup",
          label: "备份与恢复",
          icon: <Cloud className="h-full w-full" />,
        },
        {
          key: "knowledge-docs",
          label: "知识库与文档",
          icon: <BookOpen className="h-full w-full" />,
        },
        {
          key: "tools-runtime",
          label: "工具与运行时",
          icon: <Wrench className="h-full w-full" />,
        },
        {
          key: "logs",
          label: "日志查看器",
          icon: <ScrollText className="h-full w-full" />,
        },
      ]
    }
    return [
      {
        key: "profile",
        label: "个人资料与偏好",
        icon: <User className="h-full w-full" />,
      },
      {
        key: "skills",
        label: "个人 Skills",
        icon: <PackageCheck className="h-full w-full" />,
      },
      {
        key: "shares",
        label: "分享管理",
        icon: <Share2 className="h-full w-full" />,
      },
      {
        key: "security",
        label: "账号安全",
        icon: <ShieldCheck className="h-full w-full" />,
      },
    ]
  }, [activeSection])

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

    if (activeSection === "system") {
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

  if (!isAdmin && activeSection === "system") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        当前账户无权访问系统设置，正在跳转到个人设置…
      </div>
    )
  }

  const resolvedActive = activeSection === "personal" ? personalSub : systemSub

  return (
    <SettingsShell
      title={activeSection === "system" ? "系统设置" : "个人设置"}
      sections={sections}
      active={resolvedActive}
      onChange={handleChange}
      showNavTitle={activeSection === "system"}
    >
      {children}
    </SettingsShell>
  )
}
