import { apiHttpClient } from '@/lib/api'
import type { ApiResponse } from '@/types'

const client = apiHttpClient

export const getSessions = async () => {
  const response = await client.get<ApiResponse<{ sessions: any[] }>>(
    '/sessions',
  )
  const { data } = response.data
  return { data: data?.sessions || [] }
}

export const getSession = async (sessionId: number) => {
  const response = await client.get<ApiResponse<any>>(`/sessions/${sessionId}`)
  return response.data
}

export const createSessionByModelId = async (
  modelId: string,
  title?: string,
  connectionId?: number,
  rawId?: string,
  systemPrompt?: string | null,
  knowledgeBaseIds?: number[],
) => {
  const payload: Record<string, unknown> = { modelId }
  if (title) payload.title = title
  if (connectionId && rawId) {
    payload.connectionId = connectionId
    payload.rawId = rawId
  }
  if (typeof systemPrompt === 'string') {
    payload.systemPrompt = systemPrompt
  }
  if (Array.isArray(knowledgeBaseIds)) {
    payload.knowledgeBaseIds = knowledgeBaseIds
  }
  const response = await client.post<ApiResponse<any>>('/sessions', payload)
  return response.data
}

export const deleteSession = async (sessionId: number) => {
  await client.delete(`/sessions/${sessionId}`)
}

export const updateSession = async (
  sessionId: number,
  updates: Partial<{
    title: string
    pinned: boolean
    reasoningEnabled: boolean
    reasoningEffort: 'low' | 'medium' | 'high'
    ollamaThink: boolean
    systemPrompt: string | null
    knowledgeBaseIds: number[]
  }>,
) => {
  const response = await client.put<ApiResponse<any>>(
    `/sessions/${sessionId}`,
    updates,
  )
  return response.data
}

export const updateSessionModel = async (
  sessionId: number,
  payload: { modelId: string; connectionId?: number; rawId?: string },
) => {
  const response = await client.put<ApiResponse<any>>(
    `/sessions/${sessionId}/model`,
    payload,
  )
  return response.data
}

export const summarizeSessionTitle = async (
  sessionId: number,
  content: string,
): Promise<{ title: string }> => {
  const response = await client.post<ApiResponse<{ title: string }>>(
    `/chat/sessions/${sessionId}/summarize-title`,
    { content },
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || 'Failed to summarize title')
  }
  return response.data.data
}
