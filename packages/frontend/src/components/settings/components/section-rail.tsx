"use client"

import { useRef } from "react"
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
  /** 移动端 tablist 的 aria-controls 目标：页面内容区元素的 id（不传则不输出该属性） */
  panelId?: string
}

const desktopItemBase =
  "flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-[13px] transition-colors duration-[160ms]"
const mobileItemBase =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-[160ms]"

/**
 * 分段导航：桌面左侧竖排段列表，移动端折成一行可横向滚动的分段按钮。
 * 纯受控展示组件（无内部 state）。选中态 = 白底 + 发丝线 + 左侧 2×14 信号竖条；
 * 焦点环由全局 :focus-visible 提供（1.5px signal 描边），此处不再写 ring。
 * 移动端用 role=tab，故补 aria-controls 指向页面内容区，读屏能说出标签控制哪块内容。
 */
export function SectionRail<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  panelId,
}: SectionRailProps<K>): JSX.Element {
  const mobileRefs = useRef<Array<HTMLButtonElement | null>>([])
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
                  ? "border-border bg-surface font-medium text-foreground"
                  : "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <span className={cn("h-3.5 w-0.5 shrink-0 rounded-full", isActive ? "bg-signal" : "bg-transparent")} aria-hidden="true" />
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* 移动端：横向滚动的分段按钮，文案用 shortLabel */}
      <div className="flex max-w-full md:hidden overflow-x-auto gap-1 p-1 -mx-1" role="tablist" aria-label={ariaLabel}>
        {items.map((item, index) => {
          const Icon = item.icon
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              ref={element => { mobileRefs.current[index] = element }}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={event => {
                const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length : null
                if (next !== null) { event.preventDefault(); onChange(items[next].key); mobileRefs.current[next]?.focus() }
              }}
              aria-selected={isActive}
              aria-controls={panelId}
              onClick={() => onChange(item.key)}
              className={cn(
                mobileItemBase,
                isActive
                  ? "border-border bg-surface text-foreground"
                  : "border-border bg-surface-subtle text-ink-secondary hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.shortLabel ?? item.label}
            </button>
          )
        })}
      </div>
    </>
  )
}

export default SectionRail
