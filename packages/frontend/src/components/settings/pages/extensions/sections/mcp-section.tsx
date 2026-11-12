"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { Link2 } from "lucide-react"
import { SegmentedTabs, type SegmentedTabItem } from "@/components/settings/components/segmented-tabs"
import { BindingsTab } from "@/components/settings/system-mcp/bindings-tab"
import { ConnectionsTab } from "@/components/settings/system-mcp/connections-tab"
import { InstallationsTab } from "@/components/settings/system-mcp/installations-tab"
import { SecretsTab } from "@/components/settings/system-mcp/secrets-tab"
import { ToolsTab } from "@/components/settings/system-mcp/tools-tab"
import { Switch } from "@/components/ui/switch"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { EXTENSION_SEGMENTS } from "../extensions-sections"

/**
 * 能力扩展 · MCP 段：段页头（全局开关）+ 5 个次级标签。
 *
 * 原 `system-mcp/SystemMcpPage.tsx` 的 6 标签页壳在此收口：静态「总览」标签删除（其配置
 * 流程说明已并入能力扩展页总览），全局开关从页头右侧原样搬入；5 个既有 tab 组件的业务
 * 逻辑、payload 与校验一字未改，只在每段内容外包一层 `data-card-key` 供搜索定位。
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

export function McpSection({
  segment,
  onSegmentChange,
}: {
  /** 次级标签由页面持有：卡定位/搜索需要先切段再交给 SystemLeafWrapper 滚动。 */
  segment: McpSegment
  onSegmentChange: (segment: McpSegment) => void
}): JSX.Element {
  // 全局开关走共享 settings store（不是裸 API）：同页总览与其他设置卡读同一份状态，
  // 切回总览不会看到过期值。
  const { settings, update, refresh, isLoading, error } = useSystemSettings()
  const [saving, setSaving] = useState(false)
  const switchId = useId()
  // 未取到设置时不能猜「已开启」：宁可显示状态未知并禁用，也不给一个假的确定值。
  const enabled = settings ? Boolean(settings.mcpGlobalEnabled) : null
  const loading = settings === null

  useEffect(() => {
    if (settings) return
    void refresh().catch(() => {})
  }, [settings, refresh])

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true)
      try {
        await update({ mcpGlobalEnabled: next })
      } catch {
        // 开关值直接来自 store：写入失败时 store 不变，UI 自动回到原状态
      } finally {
        setSaving(false)
      }
    },
    [update],
  )

  const ActiveContent = SEGMENT_CONTENT[segment]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            MCP 服务
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">连接外部工具与数据源</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            id={switchId}
            checked={enabled === true}
            onCheckedChange={handleToggle}
            disabled={saving || loading || isLoading}
            aria-label="全局 MCP 开关"
          />
          <label
            htmlFor={switchId}
            className="cursor-pointer select-none text-xs text-muted-foreground"
          >
            全局 {enabled === null ? "状态未知" : enabled ? "已开启" : "已关闭"}
          </label>
          {saving && <span className="text-xs text-muted-foreground/60">保存中...</span>}
          {enabled === null && !isLoading ? (
            <button
              type="button"
              onClick={() => void refresh().catch(() => {})}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              重试
            </button>
          ) : null}
        </div>
      </div>

      <SegmentedTabs
        items={TAB_ITEMS}
        active={segment}
        onChange={onSegmentChange}
        ariaLabel="MCP 服务次级标签"
      />

      {enabled === false && segment !== "installations" && (
        <p className="text-xs text-muted-foreground">{GLOBAL_OFF_HINT}</p>
      )}
      {enabled === null && error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}

      <div data-card-key={`extensions:mcp-${segment}`}>
        <ActiveContent />
      </div>
    </div>
  )
}
