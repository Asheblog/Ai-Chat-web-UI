'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as mcpApi from '@/features/mcp/api'
import { useAuthStore } from '@/store/auth-store'
import type { McpToolView } from '@/types'

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
  ensureLoaded: () => Promise<void>
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
  const [loadRequested, setLoadRequested] = useState(false)

  const actorState = useAuthStore((state) => state.actorState)
  const isAuthenticated = actorState === 'authenticated'
  const hasSession = Boolean(sessionId)
  const mcpGlobalEnabled = systemSettings?.mcpGlobalEnabled ?? true

  const optionsRef = useRef(connectionOptions)
  optionsRef.current = connectionOptions
  const inFlightRef = useRef<Promise<void> | null>(null)
  const loadedSessionRef = useRef<number | null>(null)

  useEffect(() => {
    setLoadRequested(false)
    loadedSessionRef.current = null
    setConnectionOptions([])
    setSessionTools([])
    setError(null)
  }, [sessionId])

  const load = useCallback(async () => {
    if (!isAuthenticated || !hasSession || !mcpGlobalEnabled || !sessionId) {
      setConnectionOptions([])
      setSessionTools([])
      return
    }
    if (loadedSessionRef.current === sessionId && !inFlightRef.current) {
      return
    }
    if (inFlightRef.current) {
      await inFlightRef.current
      return
    }

    setLoading(true)
    setError(null)
    const task = (async () => {
      try {
        const [connRes, bindRes, toolsRes] = await Promise.all([
          mcpApi.listConnections({ mine: true }),
          mcpApi.listBindings({ scopeType: 'session', scopeId: String(sessionId) }),
          mcpApi.listSessionTools(sessionId),
        ])

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
        loadedSessionRef.current = sessionId
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || '加载 MCP 数据失败')
      } finally {
        setLoading(false)
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = task
    await task
  }, [hasSession, isAuthenticated, mcpGlobalEnabled, sessionId])

  useEffect(() => {
    if (!loadRequested) return
    void load()
  }, [load, loadRequested])

  const ensureLoaded = useCallback(async () => {
    setLoadRequested(true)
    await load()
  }, [load])

  const toggleBinding = useCallback(async (connectionId: number, enabled: boolean) => {
    if (!sessionId || !isAuthenticated) return

    const option = optionsRef.current.find((o) => o.connectionId === connectionId)
    if (!option) return

    const prev = optionsRef.current
    setConnectionOptions((current) =>
      current.map((o) => (o.connectionId === connectionId ? { ...o, enabled, updating: true } : o)),
    )

    try {
      if (option.bindingId) {
        const res = await mcpApi.updateBinding(option.bindingId, { enabled })
        const toolsRes = await mcpApi.listSessionTools(sessionId)
        setSessionTools(toolsRes.data ?? [])
        const updatedBinding = res.data
        setConnectionOptions((current) =>
          current.map((o) =>
            o.connectionId === connectionId
              ? { ...o, enabled, updating: false, bindingId: updatedBinding?.id ?? o.bindingId }
              : o,
          ),
        )
      } else {
        const res = await mcpApi.createBinding({
          connectionId,
          scopeType: 'session',
          scopeId: String(sessionId),
          enabled,
        })
        const toolsRes = await mcpApi.listSessionTools(sessionId)
        setSessionTools(toolsRes.data ?? [])
        setConnectionOptions((current) =>
          current.map((o) =>
            o.connectionId === connectionId
              ? { ...o, enabled, updating: false, bindingId: res.data?.id }
              : o,
          ),
        )
      }
    } catch {
      setConnectionOptions(
        prev.map((o) =>
          o.connectionId === connectionId ? { ...o, updating: false, enabled: !enabled } : o,
        ),
      )
    }
  }, [sessionId, isAuthenticated])

  return {
    mcpGlobalEnabled,
    connectionOptions,
    sessionTools,
    loading,
    error,
    ensureLoaded,
    toggleBinding,
  }
}
