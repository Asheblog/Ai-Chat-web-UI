"use client"
import { ReactNode, useEffect, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
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
  const { user, actorState } = useAuthStore((state) => ({
    user: state.user,
    actorState: state.actorState,
  }))

  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
  const activeSection = deriveSection(pathname)

  const sections = useMemo<SettingsSection[]>(() => {
    const base: SettingsSection[] = [{ key: "personal", label: "个人设置" }]
    if (isAdmin) {
      base.push({ key: "system", label: "系统设置" })
    }
    return base
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin && activeSection === "system") {
      router.replace(SECTION_PATH.personal)
    }
  }, [isAdmin, activeSection, router])

  const handleChange = (key: string) => {
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

  const resolvedActive = isAdmin ? activeSection : "personal"

  return (
    <SettingsShell
      title="设置"
      sections={sections}
      active={resolvedActive}
      onChange={handleChange}
    >
      {children}
    </SettingsShell>
  )
}
