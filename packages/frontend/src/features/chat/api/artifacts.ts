import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, WorkspaceArtifact } from '@/types'

const client = apiHttpClient

export const getSessionArtifacts = async (
  sessionId: number,
  messageId?: number,
) => {
  const response = await client.get<ApiResponse<{ artifacts: WorkspaceArtifact[] }>>(
    `/chat/sessions/${sessionId}/artifacts`,
    {
      params: {
        ...(typeof messageId === 'number' ? { messageId } : {}),
      },
    },
  )
  return response.data.data?.artifacts || []
}

export const deleteSessionWorkspace = async (sessionId: number) => {
  const response = await client.delete<ApiResponse>(`/chat/sessions/${sessionId}/workspace`)
  return response.data
}
