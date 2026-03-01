import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, Message } from '@/types'

const client = apiHttpClient

export interface MessagesPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface GetMessagesOptions {
  page?: number | 'latest'
  limit?: number
}

export const getMessages = async (
  sessionId: number,
  signal?: AbortSignal,
  options?: GetMessagesOptions,
) => {
  const response = await client.get<ApiResponse<{ messages: any[]; pagination?: MessagesPagination }>>(
    `/chat/sessions/${sessionId}/messages`,
    {
      signal,
      params: {
        ...(typeof options?.page !== 'undefined' ? { page: options.page } : {}),
        ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
      },
    },
  )
  const { data } = response.data
  return {
    data: data?.messages || [],
    pagination: data?.pagination,
  }
}

export const getMessageProgress = async (
  sessionId: number,
  messageId: number,
) => {
  const response = await client.get<ApiResponse<{ message: Message }>>(
    `/chat/sessions/${sessionId}/messages/${messageId}/progress`,
  )
  return response.data
}

export const getMessageByClientId = async (
  sessionId: number,
  clientMessageId: string,
) => {
  const encoded = encodeURIComponent(clientMessageId.trim())
  const response = await client.get<ApiResponse<{ message: Message }>>(
    `/chat/sessions/${sessionId}/messages/by-client/${encoded}`,
  )
  return response.data
}

export const updateUserMessage = async (
  sessionId: number,
  messageId: number,
  content: string,
) => {
  const response = await client.put<ApiResponse<{
    messageId: number
    deletedAssistantMessageIds: number[]
  }>>(`/chat/sessions/${sessionId}/messages/${messageId}`, { content })
  return response.data
}

export const updateCompressionGroupState = async (
  sessionId: number,
  groupId: number,
  expanded: boolean,
) => {
  const response = await client.patch<ApiResponse<{ groupId: number; expanded: boolean }>>(
    `/chat/sessions/${sessionId}/compression/${groupId}`,
    { expanded },
  )
  return response.data
}

export const cancelCompressionGroup = async (
  sessionId: number,
  groupId: number,
) => {
  const response = await client.post<ApiResponse<{ groupId: number; releasedCount: number }>>(
    `/chat/sessions/${sessionId}/compression/${groupId}/cancel`,
  )
  return response.data
}
