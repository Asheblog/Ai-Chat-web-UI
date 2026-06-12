'use client'

import { SectionCard } from './tab-bar'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'

interface McpOverviewProps {
  mcpEnabled: boolean
  onToggleEnabled: (v: boolean) => void
  saving: boolean
}

export function McpOverview({ mcpEnabled, onToggleEnabled, saving }: McpOverviewProps) {
  return (
    <SectionCard title="MCP 全局开关">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">启用 MCP 工具</p>
          <p className="text-xs text-muted-foreground">
            关闭后所有 MCP 连接和工具将在聊天中不可用
          </p>
        </div>
        <Switch checked={mcpEnabled} onCheckedChange={onToggleEnabled} disabled={saving} />
      </div>
      {saving && <p className="text-xs text-muted-foreground">保存中...</p>}
    </SectionCard>
  )
}

export function OverviewTab({
  mcpEnabled,
  savingToggle,
  loadingSettings,
  onToggleEnabled,
}: {
  mcpEnabled: boolean
  savingToggle: boolean
  loadingSettings: boolean
  onToggleEnabled: (v: boolean) => void
}) {
  return (
    <div className="space-y-3">
      {loadingSettings ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <McpOverview mcpEnabled={mcpEnabled} onToggleEnabled={onToggleEnabled} saving={savingToggle} />
      )}
      <SectionCard title="导航提示">
        <p className="text-xs text-muted-foreground">
          使用上方标签切换管理项：安装模板 → 连接 → 凭据 → 工具搜索/固定 → 绑定。
        </p>
      </SectionCard>
    </div>
  )
}
