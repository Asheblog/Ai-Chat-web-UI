import { apiHttpClient } from '@/api/http'
import type { ApiResponse } from '@/types'

export interface ProcessControlTarget {
  clientMessageId?: string | null
  messageId?: string | number | null
}

export interface FinishToolsAcknowledgement {
  accepted: boolean
  reason?: string
  target?: { sessionId: number; streamKey?: string; messageId?: number; via?: 'active' }
}

/** Stop subsequent tools, preserving the live connection for the final answer. */
export async function requestFinishWithAvailable(
  sessionId: number, target: ProcessControlTarget,
): Promise<FinishToolsAcknowledgement> {
  const clientMessageId = target.clientMessageId?.trim() || undefined
  const numericId = Number(target.messageId)
  const messageId = Number.isInteger(numericId) && numericId > 0 ? numericId : undefined
  if (!Number.isInteger(sessionId) || sessionId <= 0 || (!clientMessageId && messageId == null)) {
    throw new Error('请指定正在生成的消息')
  }
  const response = await apiHttpClient.post<ApiResponse<FinishToolsAcknowledgement>>(
    '/chat/stream/stop-tools', { sessionId, clientMessageId, messageId },
  ).catch((error: unknown) => {
    const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error
    if (typeof message === 'string' && message.trim()) throw new Error(message)
    throw error
  })
  const result = response.data
  if (!result.success || !result.data?.accepted) {
    throw new Error('该消息已结束或暂未受理，请以当前运行状态为准')
  }
  return result.data
}
