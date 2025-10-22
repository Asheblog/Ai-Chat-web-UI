"use client"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface Shell2Props {
  title?: string
  mains: { key: string; label: string }[]
  subs: { key: string; label: string }[]
  activeMain: string
  activeSub: string
  onChangeMain: (key: string) => void
  onChangeSub: (key: string) => void
  children: ReactNode
}

export function SettingsShell2({
  title = "设置",
  mains,
  subs,
  activeMain,
  activeSub,
  onChangeMain,
  onChangeSub,
  children,
}: Shell2Props) {
  return (
    <div className="mx-auto w-full max-w-5xl bg-background h-full">
      <div className="flex h-full min-h-0">
        {/* 一级 */}
        <aside className="w-40 shrink-0 border-r bg-muted/10">
          <div className="px-4 py-3 font-semibold border-b">{title}</div>
          <nav className="p-2 space-y-1 overflow-auto">
            {mains.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onChangeMain(m.key)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  activeMain === m.key ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* 二级 */}
        <aside className="w-56 shrink-0 border-r bg-background">
          <div className="px-4 py-3 text-sm font-medium border-b">二级菜单</div>
          <nav className="p-2 space-y-1 overflow-auto">
            {subs.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onChangeSub(s.key)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  activeSub === s.key ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* 内容区 */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="border-b px-4 py-3 font-medium">{subs.find(s=>s.key===activeSub)?.label || ''}</div>
          <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
        </section>
      </div>
    </div>
  )
}
