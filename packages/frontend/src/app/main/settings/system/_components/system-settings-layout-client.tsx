"use client"
import { ReactNode, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth-store"

const SYSTEM_SECTIONS: Array<{ key: string; label: string; description: string; href: string }> = [
  { key: "general", label: "通用", description: "品牌、配额、站点参数", href: "/main/settings/system/general" },
  { key: "network", label: "网络与流式", description: "SSE 与请求超时", href: "/main/settings/system/network" },
  { key: "reasoning", label: "推理链（CoT）", description: "推理开关与标签策略", href: "/main/settings/system/reasoning" },
  { key: "web-search", label: "联网搜索", description: "代理和搜索引擎", href: "/main/settings/system/web-search" },
  { key: "connections", label: "连接管理", description: "Upstream 连接与凭据", href: "/main/settings/system/connections" },
  { key: "models", label: "模型管理", description: "聚合模型编排", href: "/main/settings/system/models" },
  { key: "users", label: "用户管理", description: "审批、额度与角色", href: "/main/settings/system/users" },
  { key: "logging", label: "日志与监控", description: "任务追踪与清理", href: "/main/settings/system/logging" },
  { key: "about", label: "关于", description: "版本与许可信息", href: "/main/settings/system/about" },
]

const findActiveKey = (pathname: string | null): string => {
  if (!pathname) return "general"
  const normalized = pathname.split("?")[0]
  const match = SYSTEM_SECTIONS.find((section) => normalized.startsWith(section.href))
  return match?.key ?? "general"
}

export function SystemSettingsLayoutClient({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const activeKey = useMemo(() => findActiveKey(pathname), [pathname])

  const { user, actorState } = useAuthStore((state) => ({
    user: state.user,
    actorState: state.actorState,
  }))
  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border bg-muted/20 text-sm text-muted-foreground">
        当前账户无权访问系统设置
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="lg:w-64 shrink-0 rounded-2xl border bg-muted/10 p-4">
        <div className="text-sm font-semibold text-muted-foreground mb-3">系统设置分区</div>
        <nav className="space-y-1">
          {SYSTEM_SECTIONS.map((section) => {
            const isActive = section.key === activeKey
            return (
              <button
                key={section.key}
                type="button"
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent hover:border-border hover:bg-background"
                )}
                onClick={() => {
                  if (pathname === section.href) return
                  router.push(section.href)
                }}
              >
                <div className="text-sm font-medium">{section.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{section.description}</div>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
