'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings } from '@/features/settings/api'
import { SubTabBar, type McpSubTab } from './tab-bar'
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
    <div className="min-w-0 space-y-4">
      <SubTabBar active={sub} onChange={setSub} />
      {sub === 'overview' && <OverviewTab mcpEnabled={mcpEnabled} savingToggle={savingToggle} loadingSettings={loadingSettings} onToggleEnabled={handleToggleEnabled} />}
      {sub === 'installations' && <InstallationsTab />}
      {sub === 'connections' && <ConnectionsTab />}
      {sub === 'secrets' && <SecretsTab />}
      {sub === 'tools' && <ToolsTab />}
      {sub === 'bindings' && <BindingsTab />}
    </div>
  )
}
