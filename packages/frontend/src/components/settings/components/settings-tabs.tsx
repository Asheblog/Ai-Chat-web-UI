"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

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
 * 泛化 tab 容器：v2-panel 头部（图标瓦片 + 标题 + 描述）+ pill tab 按钮行 + 内容区。
 * 从 SystemSkillAudits 161-194 提取，行为/文案与源实现逐字一致，仅补充 aria-pressed。
 */
export function SettingsTabs({ tabs, defaultTab, titleOf, renderContent }: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  const activeTabDef = tabs.find((tab) => tab.key === activeTab) || tabs[0]
  const ActiveIcon = activeTabDef.icon

  return (
    <>
      <section className="v2-panel p-4 shadow-none sm:p-5">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="v2-section-title">{titleOf ? titleOf(activeTabDef) : activeTabDef.label}</h2>
            <p className="v2-muted-line mt-1">{activeTabDef.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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
                  "inline-flex min-h-9 items-center gap-2 rounded-[8px] border px-4 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(37,99,235,0.18)]"
                    : "border-border bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
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
