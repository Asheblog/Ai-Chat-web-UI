"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Menu, X } from "lucide-react"
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet"
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
  const [desktop, setDesktop] = useState<boolean | null>(null)
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => { setDesktop(media.matches); setMenuOpen(false) }
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => { setMenuOpen(false) }, [activeKey])

  const navigation = <>
    {showNavTitle ? <div className="mb-4 px-2 text-xl font-semibold text-foreground">{title}</div> : null}
    {nav}
  </>

  return (
    <div className={cn("mx-auto flex min-h-0 min-w-0 w-full max-w-none flex-1 overflow-hidden", className)}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {desktop !== false ? (
          <aside className={cn("hidden min-h-0 w-[252px] md:flex shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-subtle px-4 py-6", asideClassName)}>
            {navigation}
          </aside>
        ) : null}
        {desktop !== true ? (
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <div className="flex shrink-0 items-center border-b border-border bg-surface px-4 py-2 md:hidden">
              <SheetTrigger asChild>
                <button type="button" aria-label="打开设置目录" className="flex min-h-11 min-w-11 items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">当前：{activeLabel}</span>
                </button>
              </SheetTrigger>
            </div>
            <SheetContent side="left" dialogTitle="设置目录" dialogDescription="选择要打开的设置页面" showCloseButton={false} className="flex w-[284px] max-w-[calc(100vw-3rem)] flex-col bg-surface-subtle pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
              <div className="flex min-h-16 shrink-0 items-center justify-between px-6">
                <span className="text-xl font-semibold">{title}</span>
                <SheetClose asChild><button type="button" aria-label="收起设置目录" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-5 w-5" aria-hidden="true" /></button></SheetClose>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6" onClickCapture={event => { if ((event.target as HTMLElement).closest("[data-leaf-key]")) setMenuOpen(false) }}>
                {nav}
              </div>
            </SheetContent>
          </Sheet>
        ) : null}
        {content}
      </div>
    </div>
  )
}

export function SettingsContentColumn({ children, measureClassName, notice, dimmed, resetKey, skipScrollReset }: {
  children: ReactNode
  measureClassName: string
  notice?: ReactNode
  dimmed?: boolean
  /** 变化即把内容区滚回顶部（页面 key） */
  resetKey?: string
  /** 卡定位期间跳过重置，避免与 SystemLeafWrapper 的滚动互相拉扯 */
  skipScrollReset?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (skipScrollReset) return
    const node = scrollRef.current
    if (!node) return
    if (typeof node.scrollTo === "function") node.scrollTo({ top: 0 })
    else node.scrollTop = 0
  }, [resetKey, skipScrollReset])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {notice}
      <div ref={scrollRef} data-settings-scroll="content" className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground transition-opacity", dimmed && "opacity-60")}>
        <div className={cn("mx-auto w-full min-w-0 px-5 py-6 md:px-12 md:py-9", measureClassName)}>{children}</div>
      </div>
    </section>
  )
}
