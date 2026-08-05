"use client"

import { useId, useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export interface FeatureCardProps {
  /** 卡片左上角图标（Lucide 图标组件） */
  icon: LucideIcon
  /** 白话标题，如 "联网搜索" */
  title: string
  /** 白话副标题，如 "在回答前自动检索网页，支持多引擎并行" */
  description?: string
  /** 主开关值（受控）。必须与 onEnabledChange 成对提供，否则不渲染开关 */
  enabled?: boolean
  /** 主开关回调 (checked: boolean) => void。必须与 enabled 成对提供，否则不渲染开关 */
  onEnabledChange?: (checked: boolean) => void
  /** 「更多参数」折叠按钮文案，默认 "更多参数" */
  moreLabel?: string
  /** 折叠区内容（默认收起） */
  more?: ReactNode
  /** 卡底部操作区（保存按钮等），仅在提供时渲染 */
  footer?: ReactNode
  /** 常用内容区（SettingRow 等） */
  children?: ReactNode
  /** 卡级定位标记（systemSettingsCards 的 key），渲染为 data-card-key 供搜索跳转定位 */
  cardKey?: string
}

/**
 * FeatureCard: 设置页通用功能卡。头部为图标瓦片 + 标题/描述 + 可选主开关，
 * 中部为 children 内容区，可折叠「更多参数」区，底部可选 footer 操作区。
 */
export function FeatureCard({
  icon: Icon,
  title,
  description,
  enabled,
  onEnabledChange,
  moreLabel = "更多参数",
  more,
  footer,
  children,
  cardKey,
}: FeatureCardProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRegionId = useId()
  const hasSwitch = enabled !== undefined && onEnabledChange !== undefined

  return (
    <section className="v2-panel flex flex-col overflow-hidden" data-card-key={cardKey}>
      <div className="flex items-center justify-between gap-4 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-foreground">{title}</span>
            {description ? (
              <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
            ) : null}
          </span>
        </div>
        {hasSwitch ? (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(Boolean(checked))}
            aria-label={`启用${title}`}
          />
        ) : null}
      </div>

      {children ? <div className="space-y-3 px-4 py-4">{children}</div> : null}

      {more !== undefined ? (
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? moreRegionId : undefined}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent/55 hover:text-foreground"
        >
          <span>{moreLabel}</span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 transition-transform duration-200", moreOpen && "rotate-180")}
          />
        </button>
      ) : null}

      {moreOpen && more !== undefined ? (
        <div id={moreRegionId} className="space-y-3 border-t border-border px-4 py-4">{more}</div>
      ) : null}

      {footer !== undefined ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </section>
  )
}
