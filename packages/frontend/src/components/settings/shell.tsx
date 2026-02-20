"use client"
import { ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { SettingsNavItem } from "./nav"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface SettingsSection {
  key: string
  label: string
  icon?: ReactNode
}

type BaseProps = {
  title?: string
  className?: string
  bare?: boolean
  children: ReactNode
}

type FlatModeProps = {
  mode?: "flat"
  sections: SettingsSection[]
  active: string
  onChange: (key: string) => void
}

type NestedModeProps = {
  mode: "nested"
  tree: SettingsNavItem[]
  activeMain: string
  activeSub: string
  onChangeMain: (key: string) => void
  onChangeSub: (key: string) => void
  readOnly?: boolean
  readOnlyMessage?: string
}

export type SettingsShellProps = BaseProps & (FlatModeProps | NestedModeProps)

/**
 * SettingsShell: 统一支持扁平与树形导航的设置容器
 */
export function SettingsShell(props: SettingsShellProps) {
  if (props.mode === "nested") {
    return <SettingsShellNestedImpl {...props} />
  }
  return <SettingsShellFlatImpl {...props} />
}

function SettingsShellLayout({
  title,
  bare,
  className,
  nav,
  content,
  asideClassName,
}: {
  title: string
  bare?: boolean
  className?: string
  nav: ReactNode
  content: ReactNode
  asideClassName?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-5xl flex-1 min-h-0 bg-[hsl(var(--surface))/0.96]",
        bare ? "" : "rounded-[calc(var(--radius)+0.35rem)] border border-border/80 shadow-[0_24px_56px_hsl(var(--background)/0.4)]",
        className
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row">
        <aside
          className={cn(
            "w-full shrink-0 border-b border-border/80 bg-[hsl(var(--background-alt))/0.65] flex min-h-0 flex-col overflow-y-auto md:w-60 md:border-b-0 md:border-r",
            asideClassName
          )}
        >
          <div className="sticky top-0 z-10 bg-[hsl(var(--background-alt))/0.95] px-4 py-6 text-lg font-semibold md:static">
            {title}
          </div>
          {nav}
        </aside>
        {content}
      </div>
    </div>
  )
}

function SettingsShellFlatImpl({
  title = "设置",
  sections,
  active,
  onChange,
  children,
  className,
  bare,
}: BaseProps & FlatModeProps) {
  const activeLabel = sections.find((s) => s.key === active)?.label || ""

  const nav = (
    <nav className="px-2 pb-4 space-y-0.5">
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={cn(
            "w-full flex items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-all mx-2",
            active === s.key
              ? "bg-primary/90 text-primary-foreground font-medium shadow-sm"
              : "text-foreground hover:bg-[hsl(var(--surface-hover))]"
          )}
        >
          {s.icon && <span className="shrink-0 w-[1.125rem] h-[1.125rem]">{s.icon}</span>}
          <span className="flex-1">{s.label}</span>
        </button>
      ))}
    </nav>
  )

  const content = (
    <section className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="border-b border-border/80 px-8 py-6 text-2xl font-semibold">{activeLabel}</div>
      <div className="flex-1 min-h-0 min-w-0 overflow-auto px-8 py-6">{children}</div>
    </section>
  )

  return (
    <SettingsShellLayout
      title={title ?? "设置"}
      bare={bare}
      className={className}
      nav={nav}
      content={content}
    />
  )
}

function SettingsShellNestedImpl({
  title = "设置",
  tree,
  activeMain,
  activeSub,
  onChangeMain,
  onChangeSub,
  readOnly = false,
  readOnlyMessage,
  children,
  className,
  bare,
}: BaseProps & NestedModeProps) {
  const [openKey, setOpenKey] = useState<string>("")

  useEffect(() => {
    setOpenKey(activeMain)
  }, [activeMain])

  const nav = (
    <nav className="px-2 pb-4 space-y-1">
      {tree.map((m) => {
        const isOpen = openKey === m.key
        const isActiveMain = activeMain === m.key
        return (
          <div key={m.key}>
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? "" : m.key)}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-4 py-2.5 text-left text-sm font-medium transition-all",
                isActiveMain
                  ? "bg-[hsl(var(--surface-hover))] text-foreground"
                  : "text-foreground hover:bg-[hsl(var(--surface-hover))/0.75]"
              )}
            >
              {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              <span className="flex-1">{m.label}</span>
            </button>
            {isOpen && (
              <div className="ml-2 mt-1 space-y-0.5">
                {m.children?.map((s) => {
                  const isActive = activeSub === s.key
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => {
                        onChangeMain(m.key)
                        onChangeSub(s.key)
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-all",
                        isActive
                          ? "bg-primary/90 text-primary-foreground font-medium shadow-sm"
                          : "text-foreground hover:bg-[hsl(var(--surface-hover))]"
                      )}
                    >
                      {s.icon && <span className="shrink-0 w-[1.125rem] h-[1.125rem]">{s.icon}</span>}
                      <span className="flex-1">{s.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )

  const content = (
    <section className="flex-1 min-h-0 min-w-0 flex flex-col">
      {readOnly && (
        <div className="border-b border-border/80 bg-muted/20 px-6 py-3 text-sm text-muted-foreground">
          {readOnlyMessage || "当前模式下无法编辑设置，请登录后再试。"}
        </div>
      )}
      <div
        className={cn(
          "flex-1 min-h-0 min-w-0 overflow-auto px-4 py-4 md:px-6 md:py-6 transition-opacity scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground",
          readOnly ? "opacity-60" : ""
        )}
        aria-readonly={readOnly || undefined}
      >
        {children}
      </div>
    </section>
  )

  return (
    <SettingsShellLayout
      title={title ?? "设置"}
      bare={bare}
      className={className}
      nav={nav}
      content={content}
      asideClassName="scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground"
    />
  )
}
