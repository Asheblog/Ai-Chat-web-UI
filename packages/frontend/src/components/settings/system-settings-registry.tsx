"use client"

import dynamic from "next/dynamic"
import {
  Boxes,
  BrainCircuit,
  Cable,
  Database,
  HardDrive,
  Image,
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
import { SystemLeafWrapper } from "./system-leaf-wrapper"

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

/** 叶子页内可定位的功能卡元数据（FeatureCard 或等价的固定区块）。 */
export type SystemCardMeta = {
  /** 所属叶子页 key（systemSettingsTree 叶子） */
  leafKey: string
  /** 全局唯一卡 key，形如 "leafKey:cardKey" */
  key: string
  /** 卡显示名，如 "上下文压缩" */
  label: string
  /** 搜索补充词 */
  keywords?: string[]
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
const SystemConnectionsPage = dynamic(
  () => import("@/components/settings/pages/SystemConnections").then((m) => m.SystemConnectionsPage),
  { loading: pageLoading },
)
const SystemSkillAuditsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkillAudits").then((m) => m.SystemSkillAuditsPage),
  { loading: pageLoading },
)
const SystemMcpPage = dynamic(
  () => import("@/components/settings/pages/SystemMcpPage").then((m) => m.SystemMcpPage),
  { loading: pageLoading },
)
const SearchKnowledgePage = dynamic(
  () => import("@/components/settings/pages/search-knowledge/SearchKnowledgePage").then((m) => m.SearchKnowledgePage),
  { loading: pageLoading },
)
const ToolsExtensionsPage = dynamic(
  () => import("@/components/settings/pages/tools-extensions/ToolsExtensionsPage").then((m) => m.ToolsExtensionsPage),
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
const ImageTranscriptionPage = dynamic(
  () => import("@/components/settings/pages/model-connections/ImageTranscriptionCard").then((m) => m.ImageTranscriptionPage),
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
const SkillsGovernancePage = dynamic(
  () => import("@/components/settings/pages/skills-governance/SkillsGovernancePage").then((m) => m.SkillsGovernancePage),
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
        keywords: ["provider", "API Key", "openai", "google", "deepseek", "密钥"],
      },
      { key: "models", label: "模型管理", icon: Boxes, keywords: ["模型权限", "能力", "访问控制"] },
      {
        key: "image-transcription",
        label: "图片转写",
        icon: Image,
        keywords: ["图片转写", "识图", "vision", "转写代理", "图片描述"],
      },
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
      { key: "mcp", label: "MCP 管理", icon: Link2, keywords: ["模型上下文协议", "连接", "工具", "模板", "安装", "凭据", "绑定"] },
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
        keywords: ["推理", "token", "流式", "网络", "超时"],
      },
    ],
  },
]

// Card-level registry: searchable/locatable blocks inside leaf pages.
// Keys follow "leafKey:cardKey"; values mirror the cards rendered by each
// leaf page (FeatureCard title, or equivalent fixed section heading).

export const systemSettingsCards: SystemCardMeta[] = [
  // 供应商与连接
  { leafKey: "connections", key: "connections:quick-connect", label: "快速接入", keywords: ["模板", "供应商", "密钥", "预填"] },
  { leafKey: "connections", key: "connections:advanced", label: "高级管理", keywords: ["连接列表", "Key 池", "导入", "导出", "迁移", "JSON"] },
  // 模型管理
  { leafKey: "models", key: "models:catalog", label: "模型目录与能力", keywords: ["模型列表", "能力", "上下文窗口", "批量开关", "覆写"] },
  { leafKey: "models", key: "models:access", label: "访问控制", keywords: ["默认访问策略", "访问覆写", "匿名", "注册"] },
  // 图片转写
  { leafKey: "image-transcription", key: "image-transcription:image-transcription", label: "图片转写代理", keywords: ["识图", "vision", "转写", "图片描述", "连接"] },
  // 搜索与知识库
  { leafKey: "search-knowledge", key: "search-knowledge:web-search", label: "联网搜索", keywords: ["web search", "引擎", "API Key", "并行", "白名单"] },
  { leafKey: "search-knowledge", key: "search-knowledge:rag", label: "RAG 文档解析", keywords: ["Embedding", "分块", "检索", "TopK", "文档管理"] },
  { leafKey: "search-knowledge", key: "search-knowledge:knowledge-base", label: "知识库", keywords: ["持久化", "新建", "文档"] },
  // 工具与扩展
  { leafKey: "tools-extensions", key: "tools-extensions:python-tools", label: "Python 工具", keywords: ["沙箱", "代码执行"] },
  { leafKey: "tools-extensions", key: "tools-extensions:python-runtime", label: "Python 运行时管理", keywords: ["依赖安装", "索引", "Reconcile", "已安装包"] },
  { leafKey: "tools-extensions", key: "tools-extensions:skill-install", label: "Skill 安装", keywords: ["GitHub", "仓库"] },
  { leafKey: "tools-extensions", key: "tools-extensions:battle", label: "模型大乱斗", keywords: ["乱斗", "每日次数"] },
  { leafKey: "tools-extensions", key: "tools-extensions:title-summary", label: "标题智能总结", keywords: ["对话标题", "模型", "字数"] },
  // 用户与注册
  { leafKey: "users-registration", key: "users-registration:policy", label: "用户注册", keywords: ["注册开放", "访客", "每日额度", "配额"] },
  { leafKey: "users-registration", key: "users-registration:users", label: "用户管理", keywords: ["用户列表", "审批", "账号状态", "角色"] },
  // Skill 治理
  { leafKey: "skills-governance", key: "skills-governance:approvals", label: "待审批调用", keywords: ["审批", "待审批"] },
  { leafKey: "skills-governance", key: "skills-governance:versions", label: "Skill 版本管理", keywords: ["版本", "激活", "默认", "卸载"] },
  { leafKey: "skills-governance", key: "skills-governance:bindings", label: "绑定策略", keywords: ["作用域", "策略 JSON"] },
  // 品牌与界面
  { leafKey: "branding", key: "branding:avatar", label: "AI 头像", keywords: ["上传", "图片"] },
  { leafKey: "branding", key: "branding:branding", label: "品牌定制", keywords: ["LOGO", "系统提示词", "siteBaseUrl", "图片域名"] },
  // 数据与维护
  { leafKey: "data-maintenance", key: "data-maintenance:retention", label: "数据保留策略", keywords: ["清理", "天数", "自动清理"] },
  { leafKey: "data-maintenance", key: "data-maintenance:compression", label: "上下文压缩", keywords: ["触发阈值", "保留消息"] },
  { leafKey: "data-maintenance", key: "data-maintenance:concurrency", label: "并发生成控制", keywords: ["并发", "流式", "限制"] },
  { leafKey: "data-maintenance", key: "data-maintenance:task-trace", label: "任务追踪", keywords: ["启用", "保留天数", "心跳告警"] },
  { leafKey: "data-maintenance", key: "data-maintenance:system-log", label: "系统运行日志", keywords: ["日志级别", "文件", "保留天数"] },
  // 推理与网络
  { leafKey: "reasoning-network", key: "reasoning-network:reasoning", label: "推理链配置", keywords: ["思考过程", "温度", "标签"] },
  { leafKey: "reasoning-network", key: "reasoning-network:stream", label: "流式与性能", keywords: ["分片", "flush", "Keepalive"] },
  { leafKey: "reasoning-network", key: "reasoning-network:network", label: "网络与超时", keywords: ["SSE 心跳", "空闲", "usage"] },
]

// Leaf component map

const leafComponentMap: Record<string, ComponentType> = {
  overview: SystemOverviewContent,
  connections: SystemConnectionsPage,
  models: ModelsPage,
  "image-transcription": ImageTranscriptionPage,
  "search-knowledge": SearchKnowledgePage,
  "tools-extensions": ToolsExtensionsPage,
  mcp: SystemMcpPage,
  "users-registration": UsersRegistrationPage,
  "skills-governance": SkillsGovernancePage,
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
  const Component = leafComponentMap[key]
  if (!Component) return null
  return (
    <SystemLeafWrapper leafKey={key} hostId={hostId}>
      <Component />
    </SystemLeafWrapper>
  )
}

/** 叶子 label 查找（用于卡结果的所属页提示）。 */
export function getLeafLabel(leafKey: string): string | undefined {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      const leaf = entry.children.find((c) => c.key === leafKey)
      if (leaf) return leaf.label
    } else if (entry.key === leafKey) {
      return entry.label
    }
  }
  return undefined
}

/** 卡 label 查找。 */
export function getCardLabel(cardKey: string): string | undefined {
  return systemSettingsCards.find((c) => c.key === cardKey)?.label
}

/**
 * 描述设置项位置：「分组 → 叶子」或「分组 → 叶子 · 卡」。
 * 叶子或卡不存在时返回 null（banner 不显示）。
 */
export function describeSettingsLocation(leafKey: string, cardKey?: string): string | null {
  const workspaceKey = getWorkspaceForLeaf(leafKey)
  const workspaceLabel =
    workspaceKey && workspaceKey !== leafKey
      ? (systemSettingsTree.find((e) => e.key === workspaceKey) as SystemWorkspaceNode | undefined)?.label
      : undefined
  const leafLabel = getLeafLabel(leafKey)
  if (!leafLabel) return null

  let path = workspaceLabel ? `${workspaceLabel} → ${leafLabel}` : leafLabel
  if (cardKey) {
    const cardLabel = getCardLabel(cardKey)
    if (!cardLabel) return null
    path = `${path} · ${cardLabel}`
  }
  return path
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
