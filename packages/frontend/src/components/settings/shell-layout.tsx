"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Menu } from "lucide-react"
import { cn } from "@/lib/utils"

export function SettingsShellLayout({ title, className, nav, content, asideClassName, showNavTitle, activeKey, activeLabel }: {
  title: string
  className?: string
  nav: ReactNode
  content: ReactNode
  asideClassName?: string
  showNavTitle?: boolean
  activeKey: string
  activeLabel: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setMenuOpen(false) }, [activeKey])

  return (
    <div className={cn("mx-auto flex min-h-0 min-w-0 w-full max-w-none flex-1 overflow-hidden", className)}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside className={cn("flex max-h-[50dvh] min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-border bg-surface-subtle px-3 py-2 md:max-h-none md:w-[232px] md:overflow-y-auto md:border-b-0 md:border-r md:px-4 md:py-5", asideClassName)}>
          <button ref={triggerRef} type="button" aria-label={menuOpen ? "收起设置目录" : "打开设置目录"} aria-expanded={menuOpen} aria-controls={menuId}
            onClick={() => setMenuOpen(value => !value)}
            className="flex h-11 min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-left text-[13px] font-medium text-foreground md:hidden">
            <Menu className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">当前：{activeLabel}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", menuOpen && "rotate-180")} aria-hidden="true" />
          </button>
          <div id={menuId} className={cn("min-h-0 overflow-y-auto overscroll-contain md:block md:overflow-visible", menuOpen ? "mt-2 block md:mt-0" : "hidden")}
            onClickCapture={event => { if ((event.target as HTMLElement).closest("[data-leaf-key]")) { setMenuOpen(false); if (menuOpen) triggerRef.current?.focus() } }}
            onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus() } }}>
            {showNavTitle ? <div className="mb-3 hidden px-2 text-[11px] font-medium tracking-[0.5px] text-ink-tertiary md:block">{title}</div> : null}
            {nav}
          </div>
        </aside>
        {content}
      </div>
    </div>
  )
}

export function SettingsContentColumn({ children, measureClassName, notice, dimmed }: {
  children: ReactNode
  measureClassName: string
  notice?: ReactNode
  dimmed?: boolean
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {notice}
      <div data-settings-scroll="content" className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground transition-opacity", dimmed && "opacity-60")}>
        <div className={cn("mx-auto w-full min-w-0 px-4 py-5 md:px-6 md:py-6", measureClassName)}>{children}</div>
      </div>
    </section>
  )
}
