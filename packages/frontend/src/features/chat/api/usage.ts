import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, SessionUsageTotalsItem } from '@/types'

const client = apiHttpClient

export const getUsage = async (sessionId: number) => {
  const response = await client.get<ApiResponse<any>>('/chat/usage', {
    params: { sessionId },
  })
  return response.data
}

export const getSessionsUsage = async () => {
  const response = await client.get<ApiResponse<SessionUsageTotalsItem[]>>(
    '/chat/sessions/usage',
  )
  return response.data
}
