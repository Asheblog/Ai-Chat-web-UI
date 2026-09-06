// ─── MCP 相关 DTO ─────────────────────────────────────────────────────────

export interface McpInstallation {
  id: number
  namespaceKey: string
  name: string
  description?: string | null
  sourceType: 'remote' | 'local_package'
  sourceUrl?: string | null
  sourceKey?: string | null
  registrySource?: string | null
  transport: 'streamable_http' | 'sse' | 'stdio'
  endpoint?: string | null
  command?: string | null
  argsJson?: string | null
  envJson?: string | null
  status?: string | null
  version?: string | null
  createdAt: string
  updatedAt: string
}

export interface McpConnection {
  id: number
  installationId: number
  name: string
  enabled: boolean
  configJson?: string | null
  secretVaultId?: number | null
  ownerUserId?: number | null
  status?: string | null
  toolSetRevision?: number | null
  lastError?: string | null
  installation?: McpInstallation | null
  createdAt: string
  updatedAt: string
}

export interface McpBinding {
  id: number
  connectionId: number
  scopeType: 'system' | 'user' | 'session' | 'battle_model'
  scopeId: string
  enabled: boolean
  createdBy?: number | null
  createdAt: string
  updatedAt: string
  connection?: McpConnection | null
}

export interface McpToolView {
  id: number
  connectionId: number
  originalName: string
  description?: string | null
  inputSchemaJson?: string | null
  pinned?: boolean
  pinnedByUserId?: number | null
  toolSetRevision?: number | null
}

export interface McpToolDetail extends McpToolView {
  inputSchema: Record<string, unknown> | null
}
