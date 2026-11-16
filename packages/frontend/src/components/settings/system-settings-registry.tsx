"use client"

import dynamic from "next/dynamic"
import type { ComponentType, ReactNode } from "react"
import { peekFlash } from "./settings-flash-bus"
import { SystemLeafWrapper } from "./system-leaf-wrapper"
import { getExtensionSection, extensionLeafForSection } from "./extensions-navigation"
import type { ExtensionSection } from "./pages/extensions/extensions-sections"

// 导航树、卡索引与位置描述都在纯数据层 system-settings-tree.tsx：
// 概览页也要读导航树，若与组件一起放在本文件会形成 registry → overview → registry 循环 import。
// 这里保留原有全部导出名，调用方（nav / settings-search / 宿主 / 测试）无需改动。
export * from "./system-settings-tree"

// Dynamic page loading placeholder

const pageLoading = () => (
  <div className="v2-panel-soft p-6 text-sm text-muted-foreground">
    正在加载设置模块...
  </div>
)

// Dynamic page imports

const SystemOverviewContent = dynamic(
  () => import("./system-settings-registry-overview").then((m) => m.SystemOverviewContent),
  { loading: pageLoading },
)
const SystemConnectionsPage = dynamic(
  () => import("@/components/settings/pages/SystemConnections").then((m) => m.SystemConnectionsPage),
  { loading: pageLoading },
)
const SystemSkillAuditsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkillAudits").then((m) => m.SystemSkillAuditsPage),
  { loading: pageLoading },
)
const SearchKnowledgePage = dynamic(
  () => import("@/components/settings/pages/search-knowledge/SearchKnowledgePage").then((m) => m.SearchKnowledgePage),
  { loading: pageLoading },
)
const ExtensionsPage = dynamic(
  () => import("./pages/extensions/ExtensionsPage").then((m) => m.ExtensionsPage),
  { loading: pageLoading },
)
const ReasoningNetworkPage = dynamic(
  () => import("@/components/settings/pages/reasoning-network/ReasoningNetworkPage").then((m) => m.ReasoningNetworkPage),
  { loading: pageLoading },
)
const DataMaintenancePage = dynamic(
  () => import("@/components/settings/pages/data-maintenance/DataMaintenancePage").then((m) => m.DataMaintenancePage),
  { loading: pageLoading },
)
const ModelsPage = dynamic(
  () => import("@/components/settings/pages/models/ModelsPage").then((m) => m.ModelsPage),
  { loading: pageLoading },
)
const SessionDefaultsPage = dynamic(
  () => import("@/components/settings/pages/session-defaults/SessionDefaultsPage").then((m) => m.SessionDefaultsPage),
  { loading: pageLoading },
)
const UsersRegistrationPage = dynamic(
  () => import("@/components/settings/pages/users-registration/UsersRegistrationPage").then((m) => m.UsersRegistrationPage),
  { loading: pageLoading },
)
const BrandingPage = dynamic(
  () => import("@/components/settings/pages/branding/BrandingPage").then((m) => m.BrandingPage),
  { loading: pageLoading },
)

// Leaf component map

const leafComponentMap: Record<string, ComponentType> = {
  overview: SystemOverviewContent,
  connections: SystemConnectionsPage,
  models: ModelsPage,
  "session-defaults": SessionDefaultsPage,
  "search-knowledge": SearchKnowledgePage,
  "users-registration": UsersRegistrationPage,
  branding: BrandingPage,
  "logs-audit": SystemSkillAuditsPage,
  "data-maintenance": DataMaintenancePage,
  "reasoning-network": ReasoningNetworkPage,
}

// Utilities

export const DEFAULT_SYSTEM_LEAF = "overview"

/**
 * Render a system leaf page by its key, wrapped for card-location support.
 * hostId 标识渲染宿主（"dialog" / "layout"），用于卡定位请求的精确匹配。
 * Returns null if not found.
 */
export function renderSystemLeaf(key: string, hostId?: string): ReactNode | null {
  const extensionSection = getExtensionSection(key)
  const Component = extensionSection ? ExtensionsPage : leafComponentMap[key]
  if (!Component) return null
  // 渲染期读取（不消费）待处理定位请求：dynamic 页面挂载晚于 wrapper 的挂载副作用，
  // 等页面自己的 effect 再读就已经被 consumeFlash 取走，冷启动会落回默认段。
  const initialCardKey = peekFlash(key, hostId)?.cardKey
  return (
    <SystemLeafWrapper leafKey={key} hostId={hostId}>
      {/* 能力扩展页需要宿主标识与冷启动目标卡；其余叶子保持无 props 渲染 */}
      {extensionSection ? (
        <ExtensionsPage
          hostId={hostId}
          leafKey={key}
          section={extensionSection}
          onSectionChange={(section: ExtensionSection) => window.dispatchEvent(new CustomEvent("aichat:system-settings-select", {
            detail: { key: extensionLeafForSection(section), hostId },
          }))}
          initialCardKey={initialCardKey}
        />
      ) : (
        <Component />
      )}
    </SystemLeafWrapper>
  )
}
