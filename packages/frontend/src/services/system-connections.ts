import {
  createSystemConnection as createSystemConnectionApi,
  deleteSystemConnection as deleteSystemConnectionApi,
  exportSystemConnections as exportSystemConnectionsApi,
  getSystemConnections,
  importSystemConnections as importSystemConnectionsApi,
  updateSystemConnection as updateSystemConnectionApi,
  verifySystemConnection as verifySystemConnectionApi,
} from '@/api/system'

export interface SystemConnectionApiKey {
  id?: number
  apiKeyLabel?: string | null
  apiKey?: string
  apiKeyMasked?: string | null
  hasStoredApiKey?: boolean
  modelIds: string[]
  enable: boolean
  createdAt?: string
  updatedAt?: string
}

export interface SystemConnectionGroup {
  id: number
  displayName: string
  connectionIds: number[]
  provider: string
  vendor?: string | null
  baseUrl: string
  authType: string
  headers?: Record<string, string> | null
  prefixId?: string | null
  tags: Array<{ name: string }>
  connectionType: string
  defaultCapabilities: Record<string, boolean>
  apiKeys: SystemConnectionApiKey[]
  createdAt: string
  updatedAt: string
}

export interface SystemConnectionPayload {
  displayName: string
  provider: string
  vendor?: string
  baseUrl: string
  authType: string
  headers?: Record<string, string>
  prefixId?: string
  tags: Array<{ name: string }>
  connectionType: string
  defaultCapabilities: Record<string, boolean>
  apiKeys: Array<{
    id?: number
    apiKeyLabel?: string
    apiKey?: string
    modelIds: string[]
    enable: boolean
  }>
}

export interface VerifyConnectionModel {
  id: string
  rawId: string
  name: string
  provider: string
  channelName?: string
  connectionBaseUrl?: string
  connectionType?: string
  tags?: Array<{ name: string }>
  capabilities?: Record<string, boolean>
  capabilitySource?: string
}

export interface VerifyConnectionKeyResult {
  id?: number
  apiKeyLabel?: string | null
  apiKeyMasked?: string | null
  hasStoredApiKey?: boolean
  enable: boolean
  success: boolean
  warning?: string | null
  error?: string | null
  models: VerifyConnectionModel[]
}

export interface VerifyConnectionResult {
  results: VerifyConnectionKeyResult[]
  successCount: number
  failureCount: number
  totalModels: number
}

export async function fetchSystemConnections(): Promise<SystemConnectionGroup[]> {
  const response = await getSystemConnections()
  return response?.data ?? []
}

export async function createSystemConnection(payload: SystemConnectionPayload) {
  return createSystemConnectionApi(payload)
}

export async function updateSystemConnection(id: number, payload: SystemConnectionPayload) {
  return updateSystemConnectionApi(id, payload)
}

export async function deleteSystemConnection(id: number) {
  return deleteSystemConnectionApi(id)
}

export async function verifySystemConnection(payload: SystemConnectionPayload) {
  return verifySystemConnectionApi(payload)
}

export interface SystemConnectionsExportData {
  schemaVersion: number
  exportedAt: string
  connections: unknown[]
  skippedKeys?: number
  skippedReasons?: string[]
}

export interface SystemConnectionsImportPayload {
  schemaVersion: number
  exportedAt?: string
  connections: unknown[]
  skippedKeys?: number
  skippedReasons?: string[]
}

export interface SystemConnectionsImportResult {
  createdGroups: number
  updatedGroups: number
  addedKeys: number
  skippedKeys: number
  skippedReasons: string[]
}

function formatConnectionsExportFilename(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `aichat-connections-export-${year}${month}${day}.json`
}

export async function exportSystemConnections(): Promise<SystemConnectionsExportData> {
  const response = await exportSystemConnectionsApi()
  return response?.data as SystemConnectionsExportData
}

export function downloadConnectionsExport(data: SystemConnectionsExportData): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = formatConnectionsExportFilename()
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function importSystemConnections(
  payload: SystemConnectionsImportPayload,
): Promise<SystemConnectionsImportResult> {
  const response = await importSystemConnectionsApi(payload)
  return response?.data as SystemConnectionsImportResult
}

