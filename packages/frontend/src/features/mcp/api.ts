import { apiHttpClient } from '@/lib/api'
import type {
  ApiResponse,
  McpInstallation,
  McpConnection,
  McpBinding,
  McpToolView,
  McpToolDetail,
} from '@/types'

const client = apiHttpClient

export const listInstallations = async (params?: { sourceType?: string; status?: string }) => {
  const response = await client.get<ApiResponse<McpInstallation[]>>('/mcp/installations', {
    params: params as Record<string, string>,
  })
  return response.data
}

export const getInstallation = async (id: number) => {
  const response = await client.get<ApiResponse<McpInstallation>>(`/mcp/installations/${id}`)
  return response.data
}

export const createInstallation = async (payload: {
  namespaceKey: string
  name: string
  description?: string
  sourceType?: 'remote' | 'local_package'
  transport?: 'streamable_http' | 'sse' | 'stdio'
  endpoint?: string
  command?: string
  argsJson?: string
  envJson?: string
  sourceUrl?: string
  sourceKey?: string
  registrySource?: string
}) => {
  const response = await client.post<ApiResponse<McpInstallation>>('/mcp/installations', payload)
  return response.data
}

export const updateInstallation = async (id: number, payload: Partial<McpInstallation>) => {
  const response = await client.patch<ApiResponse<McpInstallation>>(`/mcp/installations/${id}`, payload)
  return response.data
}

export const listConnections = async (params?: { installationId?: number; status?: string; mine?: boolean }) => {
  const response = await client.get<ApiResponse<McpConnection[]>>('/mcp/connections', {
    params: params as Record<string, string | number | boolean>,
  })
  return response.data
}

export const getConnection = async (id: number) => {
  const response = await client.get<ApiResponse<McpConnection>>(`/mcp/connections/${id}`)
  return response.data
}

export const createConnection = async (payload: {
  installationId: number
  name: string
  enabled?: boolean
  configJson?: string
  secretVaultId?: number
}) => {
  const response = await client.post<ApiResponse<McpConnection>>('/mcp/connections', payload)
  return response.data
}

export const createSystemConnection = async (payload: {
  installationId: number
  name: string
  enabled?: boolean
  configJson?: string
  secretVaultId?: number
}) => {
  const response = await client.post<ApiResponse<McpConnection>>('/mcp/connections/system', payload)
  return response.data
}

export const updateConnection = async (id: number, payload: {
  name?: string
  enabled?: boolean
  configJson?: string
  secretVaultId?: number | null
  status?: 'active' | 'error' | 'disabled'
}) => {
  const response = await client.patch<ApiResponse<McpConnection>>(`/mcp/connections/${id}`, payload)
  return response.data
}

export const deleteConnection = async (id: number) => {
  const response = await client.delete<ApiResponse>(`/mcp/connections/${id}`)
  return response.data
}

export const refreshConnectionTools = async (id: number) => {
  const response = await client.post<ApiResponse<{ toolSetRevision: number }>>(`/mcp/connections/${id}/refresh-tools`)
  return response.data
}

export const listBindings = async (params?: {
  scopeType?: string
  scopeId?: string
  connectionId?: number
}) => {
  const response = await client.get<ApiResponse<McpBinding[]>>('/mcp/bindings', {
    params: params as Record<string, string | number>,
  })
  return response.data
}

export const createBinding = async (payload: {
  connectionId: number
  scopeType: 'system' | 'user' | 'session' | 'battle_model'
  scopeId: string
  enabled?: boolean
}) => {
  const response = await client.post<ApiResponse<McpBinding>>('/mcp/bindings', payload)
  return response.data
}

export const updateBinding = async (id: number, payload: { enabled: boolean }) => {
  const response = await client.patch<ApiResponse<McpBinding>>(`/mcp/bindings/${id}`, payload)
  return response.data
}

export const deleteBinding = async (id: number) => {
  const response = await client.delete<ApiResponse>(`/mcp/bindings/${id}`)
  return response.data
}

export const searchTools = async (q: string) => {
  const response = await client.get<ApiResponse<McpToolView[]>>('/mcp/tools/search', {
    params: { q },
  })
  return response.data
}

export const getToolDetail = async (connectionId: number, originalName: string) => {
  const response = await client.get<ApiResponse<McpToolDetail>>(
    `/mcp/tools/${connectionId}/${encodeURIComponent(originalName)}`,
  )
  // Normalize: if backend returns inputSchemaJson as string but not inputSchema, parse it
  const raw = response.data?.data as Record<string, unknown> | undefined
  if (raw && !raw.inputSchema && typeof raw.inputSchemaJson === 'string') {
    try {
      raw.inputSchema = JSON.parse(raw.inputSchemaJson)
    } catch {
      raw.inputSchema = null
    }
  } else if (raw && !raw.inputSchema) {
    raw.inputSchema = null
  }
  return response.data
}

export const pinTool = async (connectionId: number, originalName: string) => {
  const response = await client.post<ApiResponse<McpToolView>>('/mcp/tools/pin', { connectionId, originalName })
  return response.data
}

export const unpinTool = async (connectionId: number, originalName: string) => {
  const response = await client.post<ApiResponse<McpToolView>>('/mcp/tools/unpin', { connectionId, originalName })
  return response.data
}

export const listSessionTools = async (sessionId: number) => {
  const response = await client.get<ApiResponse<McpToolView[]>>(`/mcp/sessions/${sessionId}/tools`)
  return response.data
}
