import { apiHttpClient, handleUnauthorizedRedirect } from '@/lib/api'
import { DEFAULT_API_BASE_URL } from '@/lib/http/client'
import type { ApiResponse, BattleRunDetail, BattleRunListResponse, BattleShare, BattleStreamEvent } from '@/types'

const client = apiHttpClient

export interface BattleStreamPayload {
  title?: string
  prompt: string
  expectedAnswer: string
  judge: {
    modelId: string
    connectionId?: number
    rawId?: string
  }
  judgeThreshold?: number
  runsPerModel: number
  passK: number
  models: Array<{
    modelId: string
    connectionId?: number
    rawId?: string
    features?: {
      web_search?: boolean
      web_search_scope?: 'webpage' | 'document' | 'paper' | 'image' | 'video' | 'podcast'
      web_search_include_summary?: boolean
      web_search_include_raw?: boolean
      web_search_size?: number
      python_tool?: boolean
    }
    custom_body?: Record<string, any>
    custom_headers?: Array<{ name: string; value: string }>
    reasoningEnabled?: boolean
    reasoningEffort?: 'low' | 'medium' | 'high'
    ollamaThink?: boolean
  }>
  maxConcurrency?: number
}

export async function* streamBattle(payload: BattleStreamPayload): AsyncGenerator<BattleStreamEvent, void, unknown> {
  const response = await fetch(`${DEFAULT_API_BASE_URL}/battle/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    credentials: 'include',
  })

  if (response.status === 401) {
    handleUnauthorizedRedirect()
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      // ignore
    }
    const error: any = new Error(`HTTP error ${response.status}`)
    error.status = response.status
    error.payload = payload
    throw error
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  if (!reader) {
    throw new Error('Response body is not readable')
  }

  let buffer = ''
  let completed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        while (true) {
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex === -1) break
          const rawLine = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          const line = rawLine.replace(/\r$/, '')
          if (!line || line.startsWith(':')) continue
          if (!line.startsWith('data:')) continue
          const payloadRaw = line.slice(5).trimStart()
          if (!payloadRaw) continue
          if (payloadRaw === '[DONE]') {
            completed = true
            return
          }
          try {
            const parsed = JSON.parse(payloadRaw) as BattleStreamEvent
            if (parsed?.type === 'complete') {
              completed = true
            }
            if (parsed) {
              yield parsed
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (!completed) {
    const error: any = new Error('Stream closed before completion')
    error.code = 'STREAM_INCOMPLETE'
    throw error
  }
}

export const listBattleRuns = async (params?: { page?: number; limit?: number }) => {
  const response = await client.get<ApiResponse<BattleRunListResponse>>('/battle/runs', { params })
  return response.data
}

export const getBattleRun = async (runId: number) => {
  const response = await client.get<ApiResponse<BattleRunDetail>>(`/battle/runs/${runId}`)
  return response.data
}

export const deleteBattleRun = async (runId: number) => {
  const response = await client.delete<ApiResponse>(`/battle/runs/${runId}`)
  return response.data
}

export const createBattleShare = async (runId: number, payload?: { title?: string; expiresInHours?: number | null }) => {
  const response = await client.post<ApiResponse<BattleShare>>(`/battle/runs/${runId}/share`, payload || {})
  return response.data
}
