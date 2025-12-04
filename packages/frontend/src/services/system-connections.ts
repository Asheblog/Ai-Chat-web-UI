import {
  createSystemConnection as createSystemConnectionApi,
  deleteSystemConnection as deleteSystemConnectionApi,
  getSystemConnections,
  updateSystemConnection as updateSystemConnectionApi,
  verifySystemConnection as verifySystemConnectionApi,
} from '@/features/system/api'

export interface SystemConnection {
  id: number
  provider: string
  vendor?: string | null
  baseUrl: string
  authType: string
  azureApiVersion?: string | null
  enable?: boolean
  prefixId?: string | null
  tagsJson?: string | null
  modelIdsJson?: string | null
  connectionType?: string | null
  defaultCapabilitiesJson?: string | null
  [key: string]: any
}

export interface SystemConnectionPayload {
  provider: string
  vendor?: string
  baseUrl: string
  authType: string
  apiKey?: string
  azureApiVersion?: string
  enable: boolean
  prefixId?: string
  tags: Array<{ name: string }>
  modelIds: string[]
  connectionType: string
  defaultCapabilities: Record<string, boolean>
}

export async function fetchSystemConnections(): Promise<SystemConnection[]> {
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
