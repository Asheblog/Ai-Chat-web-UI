"use client"

import dynamic from "next/dynamic"
import {
  Boxes,
  BrainCircuit,
  Cable,
  Database,
  HardDrive,
  LayoutDashboard,
  Link2,
  Palette,
  PlugZap,
  Puzzle,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import type { ComponentType, ReactNode } from "react"

// Leaf metadata

export type SystemLeafMeta = {
  key: string
  label: string
  icon: LucideIcon
  keywords?: string[]
}

export type SystemWorkspaceNode = {
  key: string
  label: string
  icon: LucideIcon
  children: SystemLeafMeta[]
}

/** Top-level system settings entry: either a leaf or a workspace group. */
export type SystemSettingsEntry = SystemLeafMeta | SystemWorkspaceNode

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
const SystemPythonRuntimePage = dynamic(
  () => import("@/components/settings/pages/SystemPythonRuntime").then((m) => m.SystemPythonRuntimePage),
  { loading: pageLoading },
)
const SystemMcpPage = dynamic(
  () => import("@/components/settings/pages/SystemMcpPage").then((m) => m.SystemMcpPage),
  { loading: pageLoading },
)

// Navigation tree: overview leaf + 5 workspace groups, 12 leaves in total

export const systemSettingsTree: SystemSettingsEntry[] = [
  {
    key: "overview",
    label: "概览",
    icon: LayoutDashboard,
    keywords: ["首页", "完成度", "待办"],
  },
  {
    key: "model-connections",
    label: "模型与连接",
    icon: Cable,
    children: [
      {
        key: "connections",
        label: "供应商与连接",
        icon: PlugZap,
        keywords: ["provider", "API Key", "openai", "ollama", "azure", "google", "密钥"],
      },
      { key: "models", label: "模型管理", icon: Boxes, keywords: ["模型权限", "能力", "访问控制"] },
    ],
  },
  {
    key: "features-tools",
    label: "功能与工具",
    icon: Wrench,
    children: [
      {
        key: "search-knowledge",
        label: "搜索与知识库",
        icon: Search,
        keywords: ["联网搜索", "web search", "RAG", "知识库", "嵌入"],
      },
      {
        key: "tools-extensions",
        label: "工具与扩展",
        icon: Terminal,
        keywords: ["Python", "运行时", "Skill 安装", "乱斗", "标题总结"],
      },
      { key: "mcp", label: "MCP 管理", icon: Link2, keywords: ["模型上下文协议", "连接", "工具"] },
    ],
  },
  {
    key: "members-security",
    label: "成员与安全",
    icon: ShieldCheck,
    children: [
      { key: "users-registration", label: "用户与注册", icon: Users, keywords: ["成员", "注册", "配额", "额度"] },
      { key: "skills-governance", label: "Skill 治理", icon: Puzzle, keywords: ["审批", "版本", "绑定", "安装"] },
    ],
  },
  {
    key: "system-data",
    label: "系统与数据",
    icon: Database,
    children: [
      {
        key: "branding",
        label: "品牌与界面",
        icon: Palette,
        keywords: ["品牌", "头像", "提示词", "站点", "siteBaseUrl"],
      },
      {
        key: "logs-audit",
        label: "日志与审计",
        icon: ScrollText,
        keywords: ["审计", "任务追踪", "运行日志", "日志"],
      },
      {
        key: "data-maintenance",
        label: "数据与维护",
        icon: HardDrive,
        keywords: ["备份", "保留", "压缩", "监控"],
      },
    ],
  },
  {
    key: "advanced",
    label: "高级设置",
    icon: SlidersHorizontal,
    children: [
      {
        key: "reasoning-network",
        label: "推理与网络",
        icon: BrainCircuit,
        keywords: ["推理", "token", "流式", "网络", "超时", "ollama"],
      },
    ],
  },
]

// Leaf component map

/** 叠挂多个页面组件为一个组件（阶段 1 临时手段，阶段 2 由 FeatureCard 整合取代）。 */
function stacked(...pages: ComponentType[]): ComponentType {
  return function Stacked() {
    return (
      <div className="space-y-6">
        {pages.map((Page, index) => (
          <Page key={index} />
        ))}
      </div>
    )
  }
}

const leafComponentMap: Record<string, ComponentType> = {
  overview: SystemOverviewContent,
  connections: SystemConnectionsPage,
  models: stacked(SystemModelsPage, SystemModelAccessPage),
  "search-knowledge": stacked(SystemWebSearchPage, SystemRAGPage, SystemKnowledgeBasePage),
  "tools-extensions": SystemPythonRuntimePage,
  mcp: SystemMcpPage,
  "users-registration": SystemUsersPage,
  "skills-governance": SystemSkillsPage,
  branding: SystemGeneralPage,
  "logs-audit": SystemSkillAuditsPage,
  "data-maintenance": SystemMonitoringPage,
  "reasoning-network": stacked(SystemReasoningPage, SystemNetworkPage),
}

// Utilities

export const DEFAULT_SYSTEM_LEAF = "overview"

/** Render a system leaf page by its key. Returns null if not found. */
export function renderSystemLeaf(key: string): ReactNode | null {
  const Component = leafComponentMap[key]
  if (!Component) return null
  return <Component />
}

/** Find which top-level entry a leaf belongs to. Returns undefined if not found. */
export function getWorkspaceForLeaf(leafKey: string): string | undefined {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      if (entry.children.some((c) => c.key === leafKey)) return entry.key
    } else if (entry.key === leafKey) {
      return entry.key
    }
  }
  return undefined
}

/** Get all leaf keys. */
export function getAllSystemLeafKeys(): string[] {
  return systemSettingsTree.flatMap((entry) =>
    "children" in entry ? entry.children.map((c) => c.key) : [entry.key]
  )
}
