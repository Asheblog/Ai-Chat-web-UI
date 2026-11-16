"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type SegmentedTabItem<K extends string = string> = {
  key: K
  label: string
  icon?: LucideIcon
  badge?: string
}

/** 外观：pill = 胶囊底（默认，既有页面沿用）；underline = 段页头下划线（Figma 工具与扩展）。 */
export type SegmentedTabVariant = "pill" | "underline"

export type SegmentedTabsProps<K extends string = string> = {
  items: SegmentedTabItem<K>[]
  active: K
  onChange: (key: K) => void
  ariaLabel: string
  /** 标签/面板的 DOM id 前缀（默认 "tab"）：同页多组标签同时挂载时必须各给一个 */
  idPrefix?: string
  variant?: SegmentedTabVariant
}

/** 标签 id：`{idPrefix}-{key}`。段面板用 segmentPanelId / segmentTabId 成对生成。 */
export function segmentTabId(idPrefix: string, key: string): string {
  return `${idPrefix}-${key}`
}

/** 面板 id：`{idPrefix}-panel-{key}`，与 segmentTabId 成对（aria-controls / aria-labelledby） */
export function segmentPanelId(idPrefix: string, key: string): string {
  return `${idPrefix}-panel-${key}`
}

/** 胶囊容器：外底 surface-subtle，选中项白底 + 发丝线；窄屏换行，不套第二层横向滚动。 */
const PILL_CONTAINER = "inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-subtle p-1"
const PILL_TAB =
  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors duration-[160ms]"
const PILL_TAB_ACTIVE = "border-border bg-surface font-medium text-foreground"
const PILL_TAB_IDLE = "border-transparent text-ink-secondary hover:text-foreground"

/**
 * 下划线容器：一条横向发丝线由选中项的 2px 底线压住（-mb-px）。
 * 选中项用青瓷色文字 + 底线，未选中靠文字色区分；不用底色块，避免和段页头抢层级。
 */
const UNDERLINE_CONTAINER = "flex flex-wrap items-center gap-x-6 border-b border-border"
const UNDERLINE_TAB =
  "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-0.5 text-sm transition-colors duration-[160ms] md:min-h-9"
const UNDERLINE_TAB_ACTIVE = "border-signal font-medium text-signal-text"
const UNDERLINE_TAB_IDLE = "border-transparent text-ink-secondary hover:text-foreground"

/**
 * 段内次级标签：纯受控展示组件（无内部 state）。
 * 焦点环由全局 :focus-visible 提供；tab 与面板靠 id/aria-controls 关联。
 * 两种外观共用同一套标签语义（role=tab、aria-selected、id/aria-controls），只换视觉。
 */
export function SegmentedTabs<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  idPrefix = "tab",
  variant = "pill",
}: SegmentedTabsProps<K>): JSX.Element {
  const outline = variant === "underline"

  return (
    <div
      className={outline ? UNDERLINE_CONTAINER : PILL_CONTAINER}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const Icon = item.icon
        const isActive = item.key === active
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={segmentTabId(idPrefix, item.key)}
            aria-controls={segmentPanelId(idPrefix, item.key)}
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            className={cn(
              outline ? UNDERLINE_TAB : PILL_TAB,
              isActive ? (outline ? UNDERLINE_TAB_ACTIVE : PILL_TAB_ACTIVE) : outline ? UNDERLINE_TAB_IDLE : PILL_TAB_IDLE,
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="num-tabular rounded-full border border-current px-1.5 text-[11px]">
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedTabs
