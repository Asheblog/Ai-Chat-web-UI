"use client"

import {
  SegmentedTabs,
  segmentPanelId,
  segmentTabId,
  type SegmentedTabItem,
} from "@/components/settings/components/segmented-tabs"
import { BindingsTab } from "@/components/settings/system-mcp/bindings-tab"
import { ConnectionsTab } from "@/components/settings/system-mcp/connections-tab"
import { InstallationsTab } from "@/components/settings/system-mcp/installations-tab"
import { SecretsTab } from "@/components/settings/system-mcp/secrets-tab"
import { ToolsTab } from "@/components/settings/system-mcp/tools-tab"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { EXTENSION_SEGMENTS } from "../extensions-sections"
import { SectionHeader } from "./section-frame"
import { SectionSwitch } from "./section-switch"

/**
 * 能力扩展 · MCP 段：段页头（全局开关）+ 5 个次级标签。
 *
 * 原 `system-mcp/SystemMcpPage.tsx` 的 6 标签页壳在此收口：静态「总览」标签删除（其配置
 * 流程说明已并入能力扩展页总览），全局开关从页头右侧原样搬入并由 SectionSwitch 承担；
 * 5 个既有 tab 组件的业务逻辑、payload 与校验一字未改，只在每段内容外包一层
 * `data-card-key` 供搜索定位。
 */

/** MCP 段次级标签顺序：安装模板 → 连接 → 凭据 → 工具 → 绑定。 */
const MCP_SEGMENTS = ["installations", "connections", "secrets", "tools", "bindings"] as const

export type McpSegment = (typeof MCP_SEGMENTS)[number]

export function isMcpSegment(value: string | undefined): value is McpSegment {
  return typeof value === "string" && (MCP_SEGMENTS as readonly string[]).includes(value)
}

/** 标签文案的单一来源是 extensions-sections 的段配置，避免中文在两地各写一份。 */
const TAB_ITEMS: SegmentedTabItem<McpSegment>[] = MCP_SEGMENTS.map((key) => ({
  key,
  label: EXTENSION_SEGMENTS.mcp.find((item) => item.key === key)?.label ?? key,
}))

const SEGMENT_CONTENT: Record<McpSegment, () => JSX.Element> = {
  installations: InstallationsTab,
  connections: ConnectionsTab,
  secrets: SecretsTab,
  tools: ToolsTab,
  bindings: BindingsTab,
}

const GLOBAL_OFF_HINT = "MCP 全局已关闭，开启后才能连接与调用工具。"

/** 标签/面板 id 前缀：keep-alive 下 Skill 段的同名标签同时在册，id 必须带段前缀才唯一。 */
const TAB_PREFIX = "mcp-tab"

export function McpSection({
  segment,
  onSegmentChange,
}: {
  /** 次级标签由页面持有：卡定位/搜索需要先切段再交给 SystemLeafWrapper 滚动。 */
  segment: McpSegment
  onSegmentChange: (segment: McpSegment) => void
}): JSX.Element {
  // 开关本身的读写归 SectionSwitch；本段只读同一份 store 判断要不要提示「全局已关闭」。
  const { settings } = useSystemSettings()
  const globalEnabled = settings ? Boolean(settings.mcpGlobalEnabled) : null

  const ActiveContent = SEGMENT_CONTENT[segment]

  return (
    <div className="space-y-3">
      <SectionHeader
        sectionKey="mcp"
        aside={
          <SectionSwitch
            settingsKey="mcpGlobalEnabled"
            label="全局"
            onLabel="已开启"
            offLabel="已关闭"
            ariaLabel="全局 MCP 开关"
          />
        }
      />

      <SegmentedTabs
        items={TAB_ITEMS}
        active={segment}
        onChange={onSegmentChange}
        ariaLabel="MCP 服务次级标签"
        idPrefix={TAB_PREFIX}
      />

      {globalEnabled === false && segment !== "installations" && (
        <p className="text-xs text-muted-foreground">{GLOBAL_OFF_HINT}</p>
      )}

      {/* 段内容需要自己的承载面：表格与空态在页面底色上会显得悬空（Skills/工具段由 v2-panel 卡片自理） */}
      <div
        data-card-key={`extensions:mcp-${segment}`}
        id={segmentPanelId(TAB_PREFIX, segment)}
        role="tabpanel"
        aria-labelledby={segmentTabId(TAB_PREFIX, segment)}
        className="v2-panel p-4"
      >
        <ActiveContent />
      </div>
    </div>
  )
}
