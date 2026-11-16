import { LayoutGrid, Link2, Puzzle, Swords, Terminal } from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * 能力扩展页的段模型：段文案/图标（段页头与总览能力行）、段内次级标签（SegmentedTabs）
 * 与卡 key → 段/次级标签的路由。段导航本身归设置侧栏，这里不再有页内导航配置。
 * 纯数据模块（除 lucide 图标外不依赖 React），供页面与各段组件共用。
 */

export type ExtensionSection = "overview" | "mcp" | "skills" | "tools" | "extra"

export type ExtensionSectionMeta = {
  key: ExtensionSection
  label: string
  /** 段页头的一句话说明 */
  description: string
  /** 总览能力行的一句话（比段页头说明更短，避免总览与段页头各写一份） */
  summary: string
  icon: LucideIcon
}

export const EXTENSION_SECTIONS: ExtensionSectionMeta[] = [
  {
    key: "overview",
    label: "总览",
    description: "管理模型可使用的外部服务、Skill 与内置能力。",
    summary: "工具与扩展的整体状态",
    icon: LayoutGrid,
  },
  {
    key: "mcp",
    label: "MCP 服务",
    description: "连接外部工具与数据源，管理模型可以调用的服务。",
    summary: "连接外部工具与数据源",
    icon: Link2,
  },
  {
    key: "skills",
    label: "Skill",
    description: "管理第三方 Skill 的安装、调用审批、版本与绑定。",
    summary: "安装、审批与绑定第三方 Skill",
    icon: Puzzle,
  },
  {
    key: "tools",
    label: "内置工具",
    description: "Python 工具开关与运行时依赖管理",
    summary: "在沙箱中执行 Python，管理运行依赖",
    icon: Terminal,
  },
  {
    key: "extra",
    label: "对话增强",
    description: "模型大乱斗与标题智能总结",
    summary: "模型大乱斗、标题智能总结",
    icon: Swords,
  },
]

/**
 * 按 key 取段配置：段标题/说明/图标的唯一来源。
 * EXTENSION_SECTIONS 覆盖全部 key，取不到只可能是新增了 key 却漏了配置，直接报错而不是静默降级。
 */
export function sectionMeta(key: ExtensionSection): ExtensionSectionMeta {
  const meta = EXTENSION_SECTIONS.find((item) => item.key === key)
  if (!meta) throw new Error(`未注册的能力扩展段: ${key}`)
  return meta
}

export type ExtensionSegment = { key: string; label: string }

/** 只有 mcp / skills 两段有次级标签，其余段的 segment 恒为 undefined。 */
export const EXTENSION_SEGMENTS: { mcp: ExtensionSegment[]; skills: ExtensionSegment[] } = {
  mcp: [
    { key: "installations", label: "安装模板" },
    { key: "connections", label: "连接" },
    { key: "secrets", label: "凭据" },
    { key: "tools", label: "工具" },
    { key: "bindings", label: "绑定" },
  ],
  skills: [
    { key: "install", label: "安装" },
    { key: "approvals", label: "待审批" },
    { key: "versions", label: "版本" },
    { key: "bindings", label: "绑定" },
  ],
}

export type ExtensionCardRoute = { section: ExtensionSection; segment?: string }

/**
 * systemSettingsCards 中全部 extensions:* 卡 → 段/次级标签。
 * 卡必须先在页内切到所在段（及次级标签）再交给 SystemLeafWrapper 滚动，否则定位失败。
 */
export const EXTENSION_CARD_ROUTES: Record<string, ExtensionCardRoute> = {
  "extensions:mcp-installations": { section: "mcp", segment: "installations" },
  "extensions:mcp-connections": { section: "mcp", segment: "connections" },
  "extensions:mcp-secrets": { section: "mcp", segment: "secrets" },
  "extensions:mcp-tools": { section: "mcp", segment: "tools" },
  "extensions:mcp-bindings": { section: "mcp", segment: "bindings" },
  "extensions:skill-install": { section: "skills", segment: "install" },
  "extensions:skill-approvals": { section: "skills", segment: "approvals" },
  "extensions:skill-versions": { section: "skills", segment: "versions" },
  "extensions:skill-bindings": { section: "skills", segment: "bindings" },
  "extensions:python-tools": { section: "tools" },
  "extensions:python-runtime": { section: "tools" },
  "extensions:battle": { section: "extra" },
  "extensions:title-summary": { section: "extra" },
}

/** 卡 key → 段路由；未注册的卡返回 null（不猜段）。 */
export function routeForCard(cardKey: string): ExtensionCardRoute | null {
  return Object.prototype.hasOwnProperty.call(EXTENSION_CARD_ROUTES, cardKey)
    ? EXTENSION_CARD_ROUTES[cardKey]
    : null
}
