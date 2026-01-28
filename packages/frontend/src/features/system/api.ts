import { apiHttpClient } from '@/lib/api'
import type {
  ActorQuota,
  ApiResponse,
  LatexTraceEventRecord,
  LatexTraceSummary,
  TaskTraceEventRecord,
  TaskTraceSummary,
} from '@/types'

const client = apiHttpClient

export const getAggregatedModels = async () => {
  const response = await client.get<ApiResponse<any[]>>('/catalog/models')
  return response.data
}

export const updateModelTags = async (
  connectionId: number,
  rawId: string,
  payload: {
    tags?: Array<{ name: string }>
    capabilities?: Record<string, boolean>
    maxOutputTokens?: number | null
    contextWindow?: number | null
    temperature?: number | null
    accessPolicy?:
      | {
          anonymous?: 'allow' | 'deny' | 'inherit'
          user?: 'allow' | 'deny' | 'inherit'
        }
      | null
  },
) => {
  const body: Record<string, any> = {
    connectionId,
    rawId,
  }
  if (payload?.tags) {
    body.tags = payload.tags
  }
  if (payload?.capabilities) {
    body.capabilities = payload.capabilities
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'maxOutputTokens')) {
    body.max_output_tokens = payload.maxOutputTokens
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'contextWindow')) {
    body.context_window = payload.contextWindow
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'temperature')) {
    body.temperature = payload.temperature
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'accessPolicy')) {
    body.access_policy = payload.accessPolicy
  }
  const response = await client.put<ApiResponse<any>>('/catalog/models/tags', body)
  return response.data
}

export const refreshModelCatalog = async () => {
  const response = await client.post<ApiResponse<any>>('/catalog/models/refresh')
  return response.data
}

export const deleteModelOverrides = async (
  items: Array<{ connectionId: number; rawId: string }>,
) => {
  const response = await client.delete<ApiResponse<any>>(
    '/catalog/models/tags',
    { data: { items } },
  )
  return response.data
}

export const deleteAllModelOverrides = async () => {
  const response = await client.delete<ApiResponse<any>>(
    '/catalog/models/tags',
    { data: { all: true } },
  )
  return response.data
}

export const getOverrideItems = async () => {
  const response = await client.get<ApiResponse<any[]>>('/catalog/models/overrides')
  return response.data
}

export const getSystemConnections = async () => {
  const response = await client.get<ApiResponse<any[]>>('/connections')
  return response.data
}

export const createSystemConnection = async (data: any) => {
  const response = await client.post<ApiResponse<any>>('/connections', data)
  return response.data
}

export const updateSystemConnection = async (id: number, data: any) => {
  const response = await client.put<ApiResponse<any>>(`/connections/${id}`, data)
  return response.data
}

export const deleteSystemConnection = async (id: number) => {
  const response = await client.delete<ApiResponse<any>>(`/connections/${id}`)
  return response.data
}

export const verifySystemConnection = async (data: any) => {
  const response = await client.post<ApiResponse<any>>('/connections/verify', data)
  return response.data
}

export const getUsers = async (params?: {
  page?: number
  limit?: number
  search?: string
  status?: 'PENDING' | 'ACTIVE' | 'DISABLED'
}) => {
  const response = await client.get<
    ApiResponse<{
      users: Array<{
        id: number
        username: string
        role: 'ADMIN' | 'USER'
        status: 'PENDING' | 'ACTIVE' | 'DISABLED'
        createdAt: string
        approvedAt: string | null
        approvedById: number | null
        rejectedAt: string | null
        rejectedById: number | null
        rejectionReason: string | null
        _count?: { chatSessions: number; connections: number }
      }>
      pagination: { page: number; limit: number; total: number; totalPages: number }
    }>
  >('/users', { params })
  return response.data
}

export const updateUserRole = async (userId: number, role: 'ADMIN' | 'USER') => {
  const response = await client.put(`/users/${userId}/role`, { role })
  return response.data
}

export const approveUser = async (userId: number) => {
  const response = await client.post<ApiResponse<any>>(`/users/${userId}/approve`)
  return response.data
}

export const rejectUser = async (userId: number, reason?: string) => {
  const payload: { reason?: string } = {}
  if (reason && reason.trim()) {
    payload.reason = reason.trim()
  }
  const response = await client.post<ApiResponse<any>>(
    `/users/${userId}/reject`,
    payload,
  )
  return response.data
}

export const updateUserStatus = async (
  userId: number,
  status: 'ACTIVE' | 'DISABLED',
  reason?: string,
) => {
  const payload: { status: 'ACTIVE' | 'DISABLED'; reason?: string } = { status }
  if (reason && reason.trim()) {
    payload.reason = reason.trim()
  }
  const response = await client.post<ApiResponse<any>>(
    `/users/${userId}/status`,
    payload,
  )
  return response.data
}

export const deleteUser = async (userId: number) => {
  await client.delete(`/users/${userId}`)
}

export const getUserQuota = async (userId: number) => {
  const response = await client.get<ApiResponse<{ quota: ActorQuota }>>(
    `/users/${userId}/quota`,
  )
  return response.data
}

export const updateUserQuota = async (
  userId: number,
  options: { dailyLimit: number | null; resetUsed?: boolean },
) => {
  const response = await client.put<ApiResponse<{ quota: ActorQuota }>>(
    `/users/${userId}/quota`,
    options,
  )
  return response.data
}

export const getTaskTraces = async (params?: {
  page?: number
  pageSize?: number
  sessionId?: number
  status?: string
  keyword?: string
}) => {
  const response = await client.get<
    ApiResponse<{
      items: TaskTraceSummary[]
      total: number
      page: number
      pageSize: number
    }>
  >('/task-trace', {
    params,
  })
  return response.data
}

export const getTaskTrace = async (id: number) => {
  const response = await client.get<
    ApiResponse<{
      trace: TaskTraceSummary
      latexTrace: LatexTraceSummary | null
      events: TaskTraceEventRecord[]
      truncated: boolean
    }>
  >(`/task-trace/${id}`)
  return response.data
}

export const exportTaskTrace = async (id: number) => {
  const response = await client.get(`/task-trace/${id}/export`, {
    responseType: 'blob',
  })
  return response.data as Blob
}

export const cleanupTaskTraces = async (retentionDays?: number) => {
  const payload = typeof retentionDays === 'number' ? { retentionDays } : {}
  const response = await client.post<
    ApiResponse<{ deleted: number; retentionDays: number }>
  >('/task-trace/cleanup', payload)
  return response.data
}

export const deleteAllTaskTraces = async () => {
  const response = await client.delete<ApiResponse<{ deleted: number }>>(
    '/task-trace/all',
  )
  return response.data
}

export const deleteTaskTrace = async (id: number) => {
  const response = await client.delete<ApiResponse<any>>(`/task-trace/${id}`)
  return response.data
}

export const getLatexTrace = async (taskTraceId: number) => {
  const response = await client.get<
    ApiResponse<{ latexTrace: LatexTraceSummary }>
  >(`/task-trace/${taskTraceId}/latex`)
  return response.data
}

export const getLatexTraceEvents = async (taskTraceId: number) => {
  const response = await client.get<
    ApiResponse<{ events: LatexTraceEventRecord[]; truncated: boolean }>
  >(`/task-trace/${taskTraceId}/latex/events`)
  return response.data
}

export const exportLatexTrace = async (taskTraceId: number) => {
  const response = await client.get(`/task-trace/${taskTraceId}/latex/export`, {
    responseType: 'blob',
  })
  return response.data as Blob
}

export const deleteLatexTrace = async (taskTraceId: number) => {
  const response = await client.delete<ApiResponse<any>>(
    `/task-trace/${taskTraceId}/latex`,
  )
  return response.data
}

// ============================================================================
// 系统运行日志 API
// ============================================================================

export interface SystemLogEntry {
  id: number
  ts: string
  level: 'debug' | 'info' | 'warn' | 'error'
  tag: string
  msg: string
  ctx?: Record<string, unknown>
}

export interface SystemLogConfig {
  level: 'debug' | 'info' | 'warn' | 'error'
  toFile: boolean
  logDir: string
  retentionDays: number
}

export interface SystemLogStats {
  totalFiles: number
  totalSizeBytes: number
  oldestDate: string | null
  newestDate: string | null
  fileList: Array<{ name: string; sizeBytes: number; date: string }>
}

export const getSystemLogs = async (params?: {
  page?: number
  pageSize?: number
  level?: 'debug' | 'info' | 'warn' | 'error'
  tag?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}) => {
  const response = await client.get<
    ApiResponse<{
      items: SystemLogEntry[]
      total: number
      hasMore: boolean
    }>
  >('/system-logs', { params })
  return response.data
}

export const getSystemLogStats = async () => {
  const response = await client.get<ApiResponse<SystemLogStats>>('/system-logs/stats')
  return response.data
}

export const getSystemLogTags = async () => {
  const response = await client.get<ApiResponse<{ tags: string[] }>>('/system-logs/tags')
  return response.data
}

export const getSystemLogConfig = async () => {
  const response = await client.get<ApiResponse<SystemLogConfig>>('/system-logs/config')
  return response.data
}

export const updateSystemLogConfig = async (config: Partial<SystemLogConfig>) => {
  const response = await client.put<ApiResponse<SystemLogConfig>>('/system-logs/config', config)
  return response.data
}

export const cleanupSystemLogs = async (retentionDays?: number) => {
  const payload = typeof retentionDays === 'number' ? { retentionDays } : {}
  const response = await client.post<
    ApiResponse<{ deleted: number; freedBytes: number; retentionDays: number }>
  >('/system-logs/cleanup', payload)
  return response.data
}
