"use client"

import dynamic from "next/dynamic"
import { BookOpen, Boxes, ClipboardList, Cloud, Database, Globe, KeyRound, LayoutDashboard, Link2, PlugZap, Puzzle, Router, ScrollText, Settings2, Terminal, Users, Wrench, type LucideIcon } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

// Leaf metadata

export type SystemLeafMeta = {
  key: string
  label: string
  icon: LucideIcon
}

export type SystemWorkspaceNode = {
  key: string
  label: string
  icon: LucideIcon
  children: SystemLeafMeta[]
}

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
const SystemGeneralPage = dynamic(
  () => import("@/features/settings/pages/system-general").then((m) => m.SystemGeneralPage),
  { loading: pageLoading },
)
const SystemModelsPage = dynamic(
  () => import("@/features/settings/pages/system-models").then((m) => m.SystemModelsPage),
  { loading: pageLoading },
)
const SystemNetworkPage = dynamic(
  () => import("@/components/settings/pages/SystemNetwork").then((m) => m.SystemNetworkPage),
  { loading: pageLoading },
)
const SystemReasoningPage = dynamic(
  () => import("@/components/settings/pages/SystemReasoning").then((m) => m.SystemReasoningPage),
  { loading: pageLoading },
)
const SystemConnectionsPage = dynamic(
  () => import("@/components/settings/pages/SystemConnections").then((m) => m.SystemConnectionsPage),
  { loading: pageLoading },
)
const SystemSkillsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkills").then((m) => m.SystemSkillsPage),
  { loading: pageLoading },
)
const SystemSkillAuditsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkillAudits").then((m) => m.SystemSkillAuditsPage),
  { loading: pageLoading },
)
const SystemUsersPage = dynamic(
  () => import("@/components/settings/pages/SystemUsers").then((m) => m.SystemUsersPage),
  { loading: pageLoading },
)
const SystemModelAccessPage = dynamic(
  () => import("@/components/settings/pages/SystemModelAccess").then((m) => m.SystemModelAccessPage),
  { loading: pageLoading },
)
const SystemMonitoringPage = dynamic(
  () => import("@/components/settings/pages/SystemMonitoring").then((m) => m.SystemMonitoringPage),
  { loading: pageLoading },
)
const SystemWebSearchPage = dynamic(
  () => import("@/components/settings/pages/SystemWebSearch").then((m) => m.SystemWebSearchPage),
  { loading: pageLoading },
)
const SystemRAGPage = dynamic(
  () => import("@/components/settings/pages/SystemRAG").then((m) => m.SystemRAGPage),
  { loading: pageLoading },
)
const SystemKnowledgeBasePage = dynamic(
  () => import("@/components/settings/pages/SystemKnowledgeBase").then((m) => m.SystemKnowledgeBasePage),
  { loading: pageLoading },
)
const LogViewerPage = dynamic(
  () => import("@/components/settings/pages/LogViewerPage").then((m) => m.LogViewerPage),
  { loading: pageLoading },
)
const SystemPythonRuntimePage = dynamic(
  () => import("@/components/settings/pages/SystemPythonRuntime").then((m) => m.SystemPythonRuntimePage),
  { loading: pageLoading },
)
const SystemMcpPage = dynamic(
  () => import("@/components/settings/pages/SystemMcpPage").then((m) => m.SystemMcpPage),
  { loading: pageLoading },
)

// Navigation tree

export const systemSettingsTree: SystemWorkspaceNode[] = [
  {
    key: "configuration-center",
    label: "配置中心",
    icon: Settings2,
    children: [
      { key: "overview", label: "概览", icon: LayoutDashboard },
      { key: "models", label: "模型管理", icon: Boxes },
      { key: "connections", label: "连接管理", icon: PlugZap },
      { key: "api-routing", label: "模型权限", icon: Router },
      { key: "token-management", label: "推理配置", icon: KeyRound },
      { key: "system-config", label: "通用设置", icon: Settings2 },
      { key: "network", label: "网络与超时", icon: Router },
    ],
  },
  {
    key: "knowledge-docs",
    label: "知识库与文档",
    icon: BookOpen,
    children: [
      { key: "rag", label: "RAG 文档解析", icon: Database },
      { key: "knowledge-base", label: "知识库管理", icon: BookOpen },
    ],
  },
  {
    key: "tools-runtime",
    label: "工具与运行时",
    icon: Wrench,
    children: [
      { key: "web-search", label: "联网搜索", icon: Globe },
      { key: "python-runtime", label: "Python 运行时", icon: Terminal },
      { key: "mcp", label: "MCP 管理", icon: Link2 },
    ],
  },
  {
    key: "audit-governance",
    label: "治理与审计",
    icon: ClipboardList,
    children: [
      { key: "members", label: "成员与权限", icon: Users },
      { key: "skills", label: "Skill 管理", icon: Puzzle },
      { key: "audit", label: "审计日志", icon: ClipboardList },
      { key: "logs", label: "日志查看器", icon: ScrollText },
    ],
  },
  {
    key: "operations",
    label: "运行维护",
    icon: Cloud,
    children: [
      { key: "backup", label: "运行监控与保留策略", icon: Cloud },
    ],
  },
]

// Leaf component map

const leafComponentMap: Record<string, ComponentType> = {
  overview: SystemOverviewContent,
  models: SystemModelsPage,
  connections: SystemConnectionsPage,
  "api-routing": SystemModelAccessPage,
  "token-management": SystemReasoningPage,
  "system-config": SystemGeneralPage,
  network: SystemNetworkPage,
  rag: SystemRAGPage,
  "knowledge-base": SystemKnowledgeBasePage,
  "web-search": SystemWebSearchPage,
  "python-runtime": SystemPythonRuntimePage,
  mcp: SystemMcpPage,
  members: SystemUsersPage,
  skills: SystemSkillsPage,
  audit: SystemSkillAuditsPage,
  logs: LogViewerPage,
  backup: SystemMonitoringPage,
}

// Utilities

export const DEFAULT_SYSTEM_LEAF = "connections"

/** Render a system leaf page by its key. Returns null if not found. */
export function renderSystemLeaf(key: string): ReactNode | null {
  const Component = leafComponentMap[key]
  if (!Component) return null
  return <Component />
}

/** Find which workspace key a leaf belongs to. Returns undefined if not found. */
export function getWorkspaceForLeaf(leafKey: string): string | undefined {
  for (const ws of systemSettingsTree) {
    if (ws.children.some((c) => c.key === leafKey)) return ws.key
  }
  return undefined
}

/** Get all leaf keys. */
export function getAllSystemLeafKeys(): string[] {
  return systemSettingsTree.flatMap((ws) => ws.children.map((c) => c.key))
}
