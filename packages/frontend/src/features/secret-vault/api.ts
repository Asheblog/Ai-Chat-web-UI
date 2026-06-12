import { apiHttpClient } from '@/lib/api'
import type {
  ApiResponse,
  SecretView,
  SecretCreateRequest,
  SecretUpdateRequest,
} from '@/types'

const client = apiHttpClient

export const listSecrets = async (params?: { scope?: string; kind?: string }) => {
  const response = await client.get<ApiResponse<SecretView[]>>('/secrets', {
    params: params as Record<string, string>,
  })
  return response.data
}

export const createSecret = async (payload: SecretCreateRequest) => {
  const response = await client.post<ApiResponse<{ id: number }>>('/secrets', payload)
  return response.data
}

export const updateSecret = async (id: number, payload: SecretUpdateRequest) => {
  const response = await client.patch<ApiResponse<SecretView>>(`/secrets/${id}`, payload)
  return response.data
}

export const deleteSecret = async (id: number) => {
  const response = await client.delete<ApiResponse>(`/secrets/${id}`)
  return response.data
}
