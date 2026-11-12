"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type SectionRailItem<K extends string = string> = {
  key: K
  label: string
  shortLabel?: string
  icon: LucideIcon
  description?: string
}

export type SectionRailProps<K extends string = string> = {
  items: SectionRailItem<K>[]
  active: K
  onChange: (key: K) => void
  ariaLabel: string
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

const desktopItemBase = cn(
  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
  focusRing,
)

const mobileItemBase = cn(
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
  focusRing,
)

/**
 * 分段导航：桌面左侧竖排段列表，移动端折成一行可横向滚动的分段按钮。
 * 纯受控展示组件（无内部 state），样式沿用 McpNavRail 的桌面/移动两分支。
 */
export function SectionRail<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
}: SectionRailProps<K>): JSX.Element {
  return (
    <>
      {/* 桌面：左侧竖排段导航 */}
      <nav className="hidden md:flex w-44 shrink-0 flex-col gap-0.5" aria-label={ariaLabel}>
        {items.map((item) => {
          const Icon = item.icon
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              type="button"
              title={item.description}
              onClick={() => onChange(item.key)}
              data-active={isActive || undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                desktopItemBase,
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {isActive && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
            </button>
          )
        })}
      </nav>

      {/* 移动端：横向滚动的分段按钮，文案用 shortLabel */}
      <div className="flex md:hidden overflow-x-auto gap-1 p-1 -mx-1" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const Icon = item.icon
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(item.key)}
              className={cn(
                mobileItemBase,
                isActive
                  ? "border-primary/70 bg-primary/10 text-primary"
                  : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.shortLabel ?? item.label}
            </button>
          )
        })}
      </div>
    </>
  )
}

export default SectionRail
