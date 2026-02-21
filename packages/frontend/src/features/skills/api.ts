import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, SkillBindingItem, SkillCatalogItem } from '@/types'

const client = apiHttpClient

export const listSkillCatalog = async () => {
  const response = await client.get<ApiResponse<SkillCatalogItem[]>>('/skills/catalog')
  return response.data
}

export const installSkillFromGithub = async (payload: { source: string; token?: string }) => {
  const response = await client.post<ApiResponse>('/skills/install', payload)
  return response.data
}

export const approveSkillVersion = async (skillId: number, versionId: number) => {
  const response = await client.post<ApiResponse>(`/skills/${skillId}/versions/${versionId}/approve`)
  return response.data
}

export const activateSkillVersion = async (
  skillId: number,
  versionId: number,
  payload?: { makeDefault?: boolean },
) => {
  const response = await client.post<ApiResponse>(
    `/skills/${skillId}/versions/${versionId}/activate`,
    payload || {},
  )
  return response.data
}

export const upsertSkillBinding = async (payload: {
  skillId: number
  versionId?: number | null
  scopeType: 'system' | 'user' | 'session' | 'battle_model'
  scopeId: string
  enabled?: boolean
  policy?: Record<string, unknown>
  overrides?: Record<string, unknown>
}) => {
  const response = await client.post<ApiResponse<SkillBindingItem>>('/skills/bindings', payload)
  return response.data
}

export const listSkillBindings = async (params?: { scopeType?: string; scopeId?: string }) => {
  const response = await client.get<ApiResponse<SkillBindingItem[]>>('/skills/bindings', { params })
  return response.data
}

export const deleteSkillBinding = async (bindingId: number) => {
  const response = await client.delete<ApiResponse>(`/skills/bindings/${bindingId}`)
  return response.data
}

export const respondSkillApproval = async (
  requestId: number,
  payload: { approved: boolean; note?: string },
) => {
  const response = await client.post<ApiResponse>(`/skills/approvals/${requestId}/respond`, payload)
  return response.data
}
