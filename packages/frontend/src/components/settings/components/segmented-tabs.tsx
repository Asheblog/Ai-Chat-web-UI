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
 * 段内次级标签：单排 pill 按钮，窄屏换行而非再套一层横向滚动（避免双层滚动）。
 * 纯受控展示组件（无内部 state），pill 样式沿用原 MCP 页导航的移动端分支。
 * 每个 tab 与段面板靠 id/aria-controls/aria-labelledby 关联，读屏能说出「这组标签控制哪块内容」。
 */
export function SegmentedTabs<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  idPrefix = "tab",
}: SegmentedTabsProps<K>): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={ariaLabel}>
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
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "border-primary/70 bg-primary/10 text-primary"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="rounded-full border border-current px-1.5 text-micro">{item.badge}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedTabs
