"use client"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SettingsSection {
  key: string
  label: string
  icon?: ReactNode
}

interface SettingsShellProps {
  title?: string
  sections: SettingsSection[]
  active: string
  onChange: (key: string) => void
  children: ReactNode
  className?: string
  bare?: boolean
}

/**
 * SettingsShell: 左侧分组导航 + 右侧内容
 * - 不使用 sticky；整体由外层容器控制滚动
 * - 统一圆角/边框/阴影，贴近 ChatGPT 设置模态的布局
 */
export function SettingsShell({ title = "设置", sections, active, onChange, children, className, bare }: SettingsShellProps) {
  const activeLabel = sections.find(s => s.key === active)?.label || ""
  return (
    <div className={cn(
      "mx-auto w-full max-w-5xl bg-background",
      bare ? "" : "rounded-xl border shadow-sm",
      className
    )}>
      <div className="flex min-h-0">
        {/* 左侧导航 */}
        <aside className="w-56 shrink-0 border-r bg-muted/10">
          <div className="px-4 py-3 font-semibold border-b">{title}</div>
          <nav className="p-2 space-y-1 overflow-auto">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onChange(s.key)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  active === s.key
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                <span className="inline-grid place-items-center h-4 w-4">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 右侧主体 */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="border-b px-4 py-3 font-medium">{activeLabel}</div>
          <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
        </section>
      </div>
    </div>
  )
}
