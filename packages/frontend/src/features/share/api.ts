import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, ChatShare, ChatShareSummary, ShareListResponse } from '@/types'

const client = apiHttpClient
const SHARE_BASE = '/shares'

export const listChatShares = async (params?: {
  sessionId?: number
  status?: 'active' | 'all'
  page?: number
  limit?: number
}) => {
  const response = await client.get<ApiResponse<ShareListResponse>>(SHARE_BASE, { params })
  return response.data
}

export const createChatShare = async (payload: {
  sessionId: number
  messageIds: number[]
  title?: string
  expiresInHours?: number | null
}) => {
  const response = await client.post<ApiResponse<ChatShare>>(SHARE_BASE, payload)
  return response.data
}

export const updateChatShare = async (
  shareId: number,
  payload: { title?: string; expiresInHours?: number | null },
) => {
  const response = await client.patch<ApiResponse<ChatShare>>(`${SHARE_BASE}/${shareId}`, payload)
  return response.data
}

export const revokeChatShare = async (shareId: number) => {
  const response = await client.post<ApiResponse<ChatShareSummary>>(
    `${SHARE_BASE}/${shareId}/revoke`,
  )
  return response.data
}
