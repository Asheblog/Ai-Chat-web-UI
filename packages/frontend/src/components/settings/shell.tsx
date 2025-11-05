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
 * SettingsShell: 左侧分组导航 + 右侧内容 (简化版,与nested保持一致风格)
 */
export function SettingsShell({ title = "设置", sections, active, onChange, children, className, bare }: SettingsShellProps) {
  const activeLabel = sections.find(s => s.key === active)?.label || ""
  return (
    <div className={cn(
      "mx-auto w-full max-w-5xl bg-background flex-1 min-h-0",
      bare ? "" : "rounded-2xl border shadow-2xl",
      className
    )}>
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        {/* 左侧导航 */}
        <aside className="w-full shrink-0 border-b bg-muted/30 flex flex-col min-h-0 md:w-60 md:border-b-0 md:border-r overflow-y-auto">
          <div className="px-4 py-6 font-bold text-lg sticky top-0 z-10 bg-muted/30 md:static">
            {title}
          </div>
          <nav className="px-2 pb-4 space-y-0.5">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onChange(s.key)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-all mx-2",
                  active === s.key
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {s.icon && <span className="shrink-0 w-[1.125rem] h-[1.125rem]">{s.icon}</span>}
                <span className="flex-1">{s.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 右侧主体 */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="border-b px-8 py-6 font-semibold text-2xl">{activeLabel}</div>
          <div className="flex-1 min-h-0 overflow-auto px-8 py-6">{children}</div>
        </section>
      </div>
    </div>
  )
}
