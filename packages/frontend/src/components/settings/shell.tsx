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
            "flex min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b border-border bg-surface/70 px-3 py-4 md:w-[200px] md:border-b-0 md:border-r md:px-3 md:py-6",
            asideClassName
          )}
        >
          {showNavTitle ? (
            <div className="mb-6 px-2 text-xl font-semibold tracking-tight text-foreground">
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
              ? "bg-accent text-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
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

/** Walk the tree to find ancestor chain leading to targetKey (exclusive of target itself). */
function findAncestors(tree: SettingsNavItem[], targetKey: string): string[] {
  for (const item of tree) {
    if (item.key === targetKey) return []
    if (item.children) {
      const found = findAncestors(item.children, targetKey)
      if (found.length > 0 || item.children.some((c) => c.key === targetKey)) {
        return [item.key, ...found]
      }
    }
  }
  return []
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  // Auto-expand ancestors when activeMain or activeSub changes so active leaf is visible
  useEffect(() => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (activeMain) next.add(activeMain)
      const ancestors = findAncestors(tree, activeSub)
      ancestors.forEach((a) => next.add(a))
      return next
    })
  }, [tree, activeMain, activeSub])

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Recursive render. rootKey tracks which top-level root the current sub-tree belongs to. */
  const renderItems = (items: SettingsNavItem[], depth: number, rootKey?: string) =>
    items.map((item) => {
      const hasChildren = !!(item.children && item.children.length > 0)
      const isExpanded = expandedKeys.has(item.key)
      const isActiveMain = item.key === activeMain
      const isActiveLeaf = !hasChildren && activeSub === item.key
      const itemRootKey = depth === 0 ? item.key : rootKey

      if (hasChildren) {
        if (depth === 0) {
          // Top-level accordion (personal / system)
          return (
            <div key={item.key}>
              <button
                type="button"
                onClick={() => {
                  if (isExpanded) {
                    setExpandedKeys((prev) => {
                      const next = new Set(prev)
                      next.delete(item.key)
                      return next
                    })
                  } else {
                    setExpandedKeys((prev) => {
                      const next = new Set(prev)
                      next.add(item.key)
                      return next
                    })
                    onChangeMain(item.key)
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[8px] px-3 py-3 text-left text-sm font-medium transition-all",
                  isActiveMain
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="flex-1">{item.label}</span>
              </button>
              {isExpanded && (
                <div className="mt-1 space-y-1 pl-2">{renderItems(item.children || [], depth + 1, item.key)}</div>
              )}
            </div>
          )
        }
        // Workspace / group node (depth >= 1)
        return (
          <div key={item.key}>
            <button
              type="button"
              onClick={() => toggleExpand(item.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-left text-sm transition-all",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <span className="flex-1">{item.label}</span>
            </button>
            {isExpanded && (
              <div className="mt-1 space-y-1 pl-3">{renderItems(item.children || [], depth + 1, itemRootKey)}</div>
            )}
          </div>
        )
      }

      // Leaf item
      const Icon = item.icon
      return (
        <button
          key={item.key}
          type="button"
          onClick={() => {
            // Sync activeMain if leaf belongs to a different root
            if (itemRootKey && itemRootKey !== activeMain) {
              onChangeMain(itemRootKey)
            }
            onChangeSub(item.key)
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-sm transition-all",
            isActiveLeaf
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {Icon && <span className="h-[1.125rem] w-[1.125rem] shrink-0">{Icon}</span>}
          <span className="flex-1">{item.label}</span>
        </button>
      )
    })

  const nav = <nav className="space-y-2">{renderItems(tree, 0)}</nav>

  const content = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {readOnly && (
        <div className="border-b border-border/80 bg-muted/20 px-6 py-3 text-sm text-muted-foreground">
          {readOnlyMessage || "当前模式下无法编辑设置，请登录后再试。"}
        </div>
      )}
      <div
        className={cn(
          "flex-1 min-h-0 min-w-0 overflow-auto px-4 py-4 transition-opacity scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground md:px-6 md:py-6",
          readOnly ? "opacity-60" : "",
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
        showNavTitle ? "md:w-[228px] md:px-4" : "",
      )}
    />
  )
}
