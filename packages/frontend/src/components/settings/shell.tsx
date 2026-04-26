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
  showNavTitle?: boolean
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
  showNavTitle,
}: {
  title: string
  bare?: boolean
  className?: string
  nav: ReactNode
  content: ReactNode
  asideClassName?: string
  showNavTitle?: boolean
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-0 w-full max-w-none flex-1 bg-transparent",
        bare ? "" : "",
        className
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside
          className={cn(
            "flex min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b border-slate-200/80 bg-white/70 px-3 py-4 md:w-[200px] md:border-b-0 md:border-r md:px-3 md:py-6",
            asideClassName
          )}
        >
          {showNavTitle ? (
            <div className="mb-6 px-2 text-xl font-semibold tracking-tight text-slate-950">
              {title}
            </div>
          ) : null}
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
  showNavTitle,
}: BaseProps & FlatModeProps) {
  const nav = (
    <nav className="space-y-2">
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={cn(
            "flex w-full items-center gap-3 rounded-[8px] px-3 py-3 text-left text-sm transition-all",
            active === s.key
              ? "bg-blue-50 text-primary font-medium shadow-sm"
              : "text-slate-600 hover:bg-blue-50 hover:text-slate-900"
          )}
        >
          {s.icon && <span className="shrink-0 w-[1.125rem] h-[1.125rem]">{s.icon}</span>}
          <span className="flex-1 whitespace-nowrap">{s.label}</span>
        </button>
      ))}
    </nav>
  )

  const content = (
    <section className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="flex-1 min-h-0 min-w-0 overflow-auto px-4 py-5 md:px-6 md:py-6">{children}</div>
    </section>
  )

  return (
    <SettingsShellLayout
      title={title ?? "设置"}
      bare={bare}
      className={className}
      nav={nav}
      content={content}
      showNavTitle={showNavTitle}
      asideClassName={showNavTitle ? "md:w-[228px] md:px-4" : undefined}
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
  showNavTitle,
}: BaseProps & NestedModeProps) {
  const [openKey, setOpenKey] = useState<string>("")

  useEffect(() => {
    setOpenKey(activeMain)
  }, [activeMain])

  const nav = (
    <nav className="space-y-2">
      {tree.map((m) => {
        const isOpen = openKey === m.key
        const isActiveMain = activeMain === m.key
        return (
          <div key={m.key}>
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? "" : m.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-3 py-3 text-left text-sm font-medium transition-all",
                isActiveMain
                  ? "bg-blue-50 text-slate-900"
                  : "text-slate-600 hover:bg-blue-50 hover:text-slate-900"
              )}
            >
              {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              <span className="flex-1">{m.label}</span>
            </button>
            {isOpen && (
              <div className="mt-1 space-y-1 pl-2">
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
                        "flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-sm transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground font-medium shadow-sm"
                          : "text-slate-600 hover:bg-blue-50 hover:text-slate-900"
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
      showNavTitle={showNavTitle}
      asideClassName={cn(
        "scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground",
        showNavTitle ? "md:w-[228px] md:px-4" : ""
      )}
    />
  )
}
