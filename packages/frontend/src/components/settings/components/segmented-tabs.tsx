"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type SegmentedTabItem<K extends string = string> = {
  key: K
  label: string
  icon?: LucideIcon
  badge?: string
}

export type SegmentedTabsProps<K extends string = string> = {
  items: SegmentedTabItem<K>[]
  active: K
  onChange: (key: K) => void
  ariaLabel: string
  /** 标签/面板的 DOM id 前缀（默认 "tab"）：同页多组标签同时挂载时必须各给一个 */
  idPrefix?: string
}

/** 标签 id：`{idPrefix}-{key}`。段面板用 segmentPanelId / segmentTabId 成对生成。 */
export function segmentTabId(idPrefix: string, key: string): string {
  return `${idPrefix}-${key}`
}

/** 面板 id：`{idPrefix}-panel-{key}`，与 segmentTabId 成对（aria-controls / aria-labelledby） */
export function segmentPanelId(idPrefix: string, key: string): string {
  return `${idPrefix}-panel-${key}`
}
/**
 * 段内次级标签：外底 surface-subtle，选中项白底 + 发丝线；窄屏换行，不再套第二层横向滚动。
 * 纯受控展示组件（无内部 state）；焦点环由全局 :focus-visible 提供，tab 与面板靠 id/aria-controls 关联。
 */
export function SegmentedTabs<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  idPrefix = "tab",
}: SegmentedTabsProps<K>): JSX.Element {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-subtle p-1" role="tablist" aria-label={ariaLabel}>
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
              "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors duration-[160ms]",
              isActive
                ? "border-border bg-surface font-medium text-foreground"
                : "border-transparent text-ink-secondary hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="num-tabular rounded-full border border-current px-1.5 text-[11px]">{item.badge}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedTabs
