"use client"

import { useId, useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  SETTINGS_CARD,
  SETTINGS_CARD_ACTION,
  SETTINGS_CARD_BODY,
  SETTINGS_CARD_DESCRIPTION,
  SETTINGS_CARD_DISCLOSURE,
  SETTINGS_CARD_HEADER,
  SETTINGS_CARD_TITLE,
} from "./settings-surfaces"

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
 * FeatureCard: 设置页通用功能卡。白底 + 发丝线 + 圆角 12；卡头 16/20，
 * 图标走 ink-tertiary 不做色块瓦片；内容区/折叠区/操作区一律以 1px 上边线切分。
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
    <section className={SETTINGS_CARD} data-card-key={cardKey}>
      <div className={SETTINGS_CARD_HEADER}>
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-[3px] h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className={SETTINGS_CARD_TITLE}>{title}</h3>
            {description ? <p className={SETTINGS_CARD_DESCRIPTION}>{description}</p> : null}
          </div>
        </div>
        {hasSwitch ? (
          <Switch checked={enabled} onCheckedChange={(c) => onEnabledChange(Boolean(c))} aria-label={`启用${title}`} />
        ) : null}
      </div>
      {children ? <div className={cn(SETTINGS_CARD_BODY, "space-y-4")}>{children}</div> : null}
      {more !== undefined ? (
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? moreRegionId : undefined}
          className={SETTINGS_CARD_DISCLOSURE}
        >
          <span>{moreLabel}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-[160ms]", moreOpen && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}
      {moreOpen && more !== undefined ? (
        <div id={moreRegionId} className={cn(SETTINGS_CARD_BODY, "space-y-4")}>{more}</div>
      ) : null}
      {footer !== undefined ? <div className={SETTINGS_CARD_ACTION}>{footer}</div> : null}
    </section>
  )
}
