import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, Message } from '@/types'

const client = apiHttpClient

export const getMessages = async (sessionId: number, signal?: AbortSignal) => {
  const response = await client.get<ApiResponse<{ messages: any[] }>>(
    `/chat/sessions/${sessionId}/messages`,
    { signal },
  )
  const { data } = response.data
  return { data: data?.messages || [] }
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
