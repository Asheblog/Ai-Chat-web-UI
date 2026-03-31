import {
  createSystemConnection as createSystemConnectionApi,
  deleteSystemConnection as deleteSystemConnectionApi,
  getSystemConnections,
  updateSystemConnection as updateSystemConnectionApi,
  verifySystemConnection as verifySystemConnectionApi,
} from '@/features/system/api'

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
  connectionIds: number[]
  provider: string
  vendor?: string | null
  baseUrl: string
  authType: string
  azureApiVersion?: string | null
  prefixId?: string | null
  tags: Array<{ name: string }>
  connectionType: string
  defaultCapabilities: Record<string, boolean>
  apiKeys: SystemConnectionApiKey[]
  createdAt: string
  updatedAt: string
}

export interface SystemConnectionPayload {
  provider: string
  vendor?: string
  baseUrl: string
  authType: string
  azureApiVersion?: string
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
