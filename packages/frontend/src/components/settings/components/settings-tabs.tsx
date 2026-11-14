"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SETTINGS_CARD, SETTINGS_CARD_DESCRIPTION, SETTINGS_CARD_TITLE } from "./settings-surfaces"

export type SettingsTabDef = {
  key: string
  label: string
  icon: LucideIcon
  description: string
}

export interface SettingsTabsProps {
  /** tab 定义列表（顺序即渲染顺序） */
  tabs: SettingsTabDef[]
  /** 初始激活 tab key */
  defaultTab: string
  /** 可选标题格式化函数，默认取 tab.label（SystemSkillAudits 传 (t) => `${t.label}日志` 保持文案不变） */
  titleOf?: (tab: SettingsTabDef) => string
  /** 内容渲染：接收当前激活 tab key */
  renderContent: (activeKey: string) => ReactNode
}

/**
 * 泛化 tab 容器：卡头（图标 + 标题 + 描述）+ 分段控件 + 内容区。
 * 分段控件外底 surface-subtle、选中项白底 + 发丝线。行为/文案与源实现逐字一致，仅补 aria-pressed。
 */
export function SettingsTabs({ tabs, defaultTab, titleOf, renderContent }: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  const activeTabDef = tabs.find((tab) => tab.key === activeTab) || tabs[0]
  const ActiveIcon = activeTabDef.icon

  return (
    <>
      <section className={cn(SETTINGS_CARD, "p-5")}>
        <div className="flex items-start gap-2.5 pb-4">
          <ActiveIcon className="mt-[3px] h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className={SETTINGS_CARD_TITLE}>{titleOf ? titleOf(activeTabDef) : activeTabDef.label}</h2>
            <p className={SETTINGS_CARD_DESCRIPTION}>{activeTabDef.description}</p>
          </div>
        </div>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-subtle p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = tab.key === activeTab
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors duration-[160ms]",
                  active
                    ? "border-border bg-surface font-medium text-foreground"
                    : "border-transparent text-ink-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </section>
      {renderContent(activeTab)}
    </>
  )
}

export default SettingsTabs
