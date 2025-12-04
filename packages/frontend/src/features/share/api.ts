import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, ChatShare, ChatShareSummary, ShareListResponse } from '@/types'

const client = apiHttpClient

export const listChatShares = async (params?: {
  sessionId?: number
  status?: 'active' | 'all'
  page?: number
  limit?: number
}) => {
  const response = await client.get<ApiResponse<ShareListResponse>>('/chat/share', {
    params,
  })
  return response.data
}

export const createChatShare = async (payload: {
  sessionId: number
  messageIds: number[]
  title?: string
  expiresInHours?: number | null
}) => {
  const response = await client.post<ApiResponse<ChatShare>>('/chat/share', payload)
  return response.data
}

export const updateChatShare = async (
  shareId: number,
  payload: { title?: string; expiresInHours?: number | null },
) => {
  const response = await client.put<ApiResponse<ChatShare>>(
    `/chat/share/${shareId}`,
    payload,
  )
  return response.data
}

export const revokeChatShare = async (shareId: number) => {
  const response = await client.delete<ApiResponse<ChatShareSummary>>(
    `/chat/share/${shareId}`,
  )
  return response.data
}
