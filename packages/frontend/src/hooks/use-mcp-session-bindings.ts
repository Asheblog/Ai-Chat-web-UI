'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as mcpApi from '@/features/mcp/api'
import { useAuthStore } from '@/store/auth-store'
import type { McpConnection, McpBinding, McpToolView } from '@/types'

export type { McpToolView }

export interface McpConnectionOption {
  connectionId: number
  connectionName: string
  installationLabel: string
  enabled: boolean
  bindingId?: number
  updating?: boolean
}

export interface UseMcpSessionBindingsResult {
  mcpGlobalEnabled: boolean
  connectionOptions: McpConnectionOption[]
  sessionTools: McpToolView[]
  loading: boolean
  error: string | null
  toggleBinding: (connectionId: number, enabled: boolean) => Promise<void>
}

export const useMcpSessionBindings = (
  sessionId?: number | null,
  systemSettings?: { mcpGlobalEnabled?: boolean } | null,
): UseMcpSessionBindingsResult => {
  const [connectionOptions, setConnectionOptions] = useState<McpConnectionOption[]>([])
  const [sessionTools, setSessionTools] = useState<McpToolView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actorState = useAuthStore((state) => state.actorState)
  const isAuthenticated = actorState === 'authenticated'
  const hasSession = Boolean(sessionId)
  const mcpGlobalEnabled = systemSettings?.mcpGlobalEnabled ?? true

  const optionsRef = useRef(connectionOptions)
  optionsRef.current = connectionOptions

  // Load connections and bindings when session is available
  useEffect(() => {
    let cancelled = false
    if (!isAuthenticated || !hasSession || !mcpGlobalEnabled || !sessionId) {
      setConnectionOptions([])
      setSessionTools([])
      return () => { cancelled = true }
    }

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [connRes, bindRes, toolsRes] = await Promise.all([
          mcpApi.listConnections({ mine: true }),
          mcpApi.listBindings({ scopeType: 'session', scopeId: String(sessionId) }),
          mcpApi.listSessionTools(sessionId),
        ])

        if (cancelled) return

        const connections = connRes.data ?? []
        const bindings = bindRes.data ?? []
        const bindMap = new Map(bindings.map((b) => [b.connectionId, b]))

        setConnectionOptions(
          connections.map((c) => ({
            connectionId: c.id,
            connectionName: c.name,
            installationLabel: c.installation?.namespaceKey ?? String(c.installationId),
            enabled: bindMap.get(c.id)?.enabled ?? false,
            bindingId: bindMap.get(c.id)?.id,
          })),
        )
        setSessionTools(toolsRes.data ?? [])
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.error || err?.message || '加载 MCP 数据失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [isAuthenticated, hasSession, mcpGlobalEnabled, sessionId])

  const toggleBinding = useCallback(async (connectionId: number, enabled: boolean) => {
    if (!sessionId || !isAuthenticated) return

    const option = optionsRef.current.find((o) => o.connectionId === connectionId)
    if (!option) return

    // Optimistic update
    const prev = optionsRef.current
    setConnectionOptions((prev) =>
      prev.map((o) => (o.connectionId === connectionId ? { ...o, enabled, updating: true } : o)),
    )

    try {
      if (option.bindingId) {
        // Update existing binding
        const res = await mcpApi.updateBinding(option.bindingId, { enabled })
        // Update session tools after toggling
        const toolsRes = await mcpApi.listSessionTools(sessionId)
        setSessionTools(toolsRes.data ?? [])
        // Update bindingId from response if available
        const updatedBinding = res.data
        setConnectionOptions((prev) =>
          prev.map((o) =>
            o.connectionId === connectionId
              ? { ...o, enabled, updating: false, bindingId: updatedBinding?.id ?? o.bindingId }
              : o,
          ),
        )
      } else {
        // Create new binding
        const res = await mcpApi.createBinding({
          connectionId,
          scopeType: 'session',
          scopeId: String(sessionId),
          enabled,
        })
        // Reload session tools
        const toolsRes = await mcpApi.listSessionTools(sessionId)
        setSessionTools(toolsRes.data ?? [])
        setConnectionOptions((prev) =>
          prev.map((o) =>
            o.connectionId === connectionId
              ? { ...o, enabled, updating: false, bindingId: res.data?.id }
              : o,
          ),
        )
      }
    } catch {
      // Revert on failure
      setConnectionOptions(prev => prev.map((o) =>
        o.connectionId === connectionId ? { ...o, updating: false, enabled: !enabled } : o,
      ))
    }
  }, [sessionId, isAuthenticated])

  return {
    mcpGlobalEnabled,
    connectionOptions,
    sessionTools,
    loading,
    error,
    toggleBinding,
  }
}
