'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings } from '@/features/settings/api'
import { Switch } from '@/components/ui/switch'
import { McpNavRail, McpContentHeader, MCP_TABS, type McpSubTab } from './mcp-ui'
import { OverviewTab } from './overview-tab'
import { InstallationsTab } from './installations-tab'
import { ConnectionsTab } from './connections-tab'
import { SecretsTab } from './secrets-tab'
import { ToolsTab } from './tools-tab'
import { BindingsTab } from './bindings-tab'

export function SystemMcpPage() {
  const [sub, setSub] = useState<McpSubTab>('overview')
  const [mcpEnabled, setMcpEnabled] = useState(true)
  const [savingToggle, setSavingToggle] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const activeTabMeta = MCP_TABS.find((t) => t.key === sub) ?? MCP_TABS[0]

  useEffect(() => {
    let cancelled = false
    getSystemSettings().then((res) => {
      if (cancelled) return
      const data = res.data as any
      if (data?.mcpGlobalEnabled !== undefined) setMcpEnabled(Boolean(data.mcpGlobalEnabled))
    }).catch(() => {}).finally(() => { if (!cancelled) setLoadingSettings(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggleEnabled = useCallback(async (v: boolean) => {
    setSavingToggle(true)
    const prev = mcpEnabled
    setMcpEnabled(v)
    try {
      await updateSystemSettings({ mcpGlobalEnabled: v } as any)
    } catch {
      setMcpEnabled(prev)
    } finally { setSavingToggle(false) }
  }, [mcpEnabled])

  return (
    <div className="min-w-0">
      {/* Workspace header with global switch */}
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-border/60">
        <div>
          <h2 className="text-lg font-semibold text-foreground">MCP 管理</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Model Context Protocol — 连接外部工具与数据源。关闭后所有 MCP 连接和工具将在聊天中不可用
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            id="mcp-global-toggle"
            checked={mcpEnabled}
            onCheckedChange={handleToggleEnabled}
            disabled={savingToggle || loadingSettings}
            aria-label="全局 MCP 开关"
          />
          <label htmlFor="mcp-global-toggle" className="text-xs text-muted-foreground cursor-pointer select-none">
            全局 {mcpEnabled ? '开启' : '关闭'}
          </label>
          {savingToggle && <span className="text-xs text-muted-foreground/60">保存中...</span>}
        </div>
      </div>

      {/* Sidebar + content layout */}
      <div className="flex flex-col md:flex-row gap-6">
        <McpNavRail active={sub} onChange={setSub} />

        <div className="flex-1 min-w-0">
          <McpContentHeader tab={activeTabMeta} />

          {!mcpEnabled && sub !== 'overview' && (
            <p className="text-xs text-muted-foreground mb-4">
              MCP 全局关闭中，请在总览中开启后使用相关功能。
            </p>
          )}

          {sub === 'overview' && <OverviewTab />}
          {sub === 'installations' && <InstallationsTab />}
          {sub === 'connections' && <ConnectionsTab />}
          {sub === 'secrets' && <SecretsTab />}
          {sub === 'tools' && <ToolsTab />}
          {sub === 'bindings' && <BindingsTab />}
        </div>
      </div>
    </div>
  )
}
