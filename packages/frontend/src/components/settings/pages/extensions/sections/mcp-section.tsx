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
import { getSystemSettings, updateSystemSettings } from "@/features/settings/api"
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
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const switchId = useId()

  useEffect(() => {
    let cancelled = false
    getSystemSettings()
      .then((res) => {
        if (cancelled) return
        if (res.data?.mcpGlobalEnabled !== undefined) {
          setEnabled(Boolean(res.data.mcpGlobalEnabled))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 乐观更新 + 失败回滚：与旧 MCP 页头完全一致。
  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true)
      const prev = enabled
      setEnabled(next)
      try {
        await updateSystemSettings({ mcpGlobalEnabled: next })
      } catch {
        setEnabled(prev)
      } finally {
        setSaving(false)
      }
    },
    [enabled],
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
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving || loading}
            aria-label="全局 MCP 开关"
          />
          <label
            htmlFor={switchId}
            className="cursor-pointer select-none text-xs text-muted-foreground"
          >
            全局 {enabled ? "已开启" : "已关闭"}
          </label>
          {saving && <span className="text-xs text-muted-foreground/60">保存中...</span>}
        </div>
      </div>

      <SegmentedTabs
        items={TAB_ITEMS}
        active={segment}
        onChange={onSegmentChange}
        ariaLabel="MCP 服务次级标签"
      />

      {!enabled && segment !== "installations" && (
        <p className="text-xs text-muted-foreground">{GLOBAL_OFF_HINT}</p>
      )}

      <div data-card-key={`extensions:mcp-${segment}`}>
        <ActiveContent />
      </div>
    </div>
  )
}
