import type { ChatStreamChunk } from '@/types'

const STREAM_DEBUG_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_STREAM === '1'

export async function* parseEventStream(
  response: Response,
  streamKey: string,
  onCleanup: () => void,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  if (!reader) {
    throw new Error('Response body is not readable')
  }

  let buffer = ''
  let completed = false

  try {
    let terminated = false
    while (!terminated) {
      const { done, value } = await reader.read()
      if (value) {
        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        if (STREAM_DEBUG_ENABLED) {
          console.debug('[streamChat] chunk', decoded.slice(0, 120))
        }
        while (true) {
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex === -1) break
          const rawLine = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          const line = rawLine.replace(/\r$/, '')
          if (!line || line.startsWith(':')) continue
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trimStart()
          if (!payload) continue
          if (payload === '[DONE]') {
            completed = true
            terminated = true
            break
          }
          try {
            const parsed = JSON.parse(payload)
            if (parsed?.type === 'complete') {
              completed = true
            }
            const chunk = normalizeChunk(parsed)
            if (chunk) {
              yield chunk
            }
          } catch (error) {
            if (STREAM_DEBUG_ENABLED) {
              console.debug('[streamChat] JSON parse ignore:', error)
            }
          }
        }
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
    onCleanup()
  }

  if (!completed) {
    const error: any = new Error('Stream closed before completion')
    error.code = 'STREAM_INCOMPLETE'
    error.streamKey = streamKey
    throw error
  }
}

export const normalizeChunk = (payload: any): ChatStreamChunk | null => {
  if (payload?.type === 'content' && payload.content) {
    return { type: 'content', content: payload.content }
  }
  if (payload?.type === 'usage' && payload.usage) {
    return { type: 'usage', usage: payload.usage }
  }
  if (payload?.type === 'reasoning') {
    const chunk: ChatStreamChunk = {
      type: 'reasoning',
      meta: payload.meta,
    }
    if (payload.done) {
      chunk.done = true
      if (typeof payload.duration === 'number') {
        chunk.duration = payload.duration
      }
    } else if (payload.keepalive) {
      chunk.keepalive = true
      if (typeof payload.idle_ms === 'number') {
        chunk.idleMs = payload.idle_ms
      }
    } else if (typeof payload.content === 'string') {
      chunk.content = payload.content
    }
    if (chunk.done || chunk.keepalive || chunk.content) {
      return chunk
    }
    return null
  }
  if (payload?.type === 'reasoning_unavailable') {
    return {
      type: 'reasoning_unavailable',
      unavailableCode: typeof payload.code === 'string' ? payload.code : undefined,
      unavailableReason: typeof payload.reason === 'string' ? payload.reason : undefined,
      unavailableSuggestion: typeof payload.suggestion === 'string' ? payload.suggestion : undefined,
      reasoningProtocol:
        payload.protocol === 'responses' || payload.protocol === 'chat_completions'
          ? payload.protocol
          : undefined,
      reasoningDecision: typeof payload.decision === 'string' ? payload.decision : undefined,
    }
  }
  if (payload?.type === 'tool') {
    return {
      type: 'tool',
      tool: payload.tool,
      stage: payload.stage,
      id: payload.id,
      query: payload.query,
      hits: payload.hits,
      error: payload.error,
      summary: payload.summary,
      details: payload.details,
      meta: payload.meta,
    }
  }
  // 生图模型返回的图片
  if (payload?.type === 'image') {
    return {
      type: 'image',
      generatedImages: payload.generatedImages,
      messageId: payload.messageId,
    }
  }
  if (payload?.type === 'artifact' && Array.isArray(payload.artifacts)) {
    return {
      type: 'artifact',
      artifacts: payload.artifacts,
      messageId: payload.messageId,
    }
  }
  if (payload?.type === 'start') {
    const normalizedMessageId =
      typeof payload.messageId === 'number'
        ? payload.messageId
        : typeof payload.message_id === 'number'
          ? payload.message_id
          : null
    const normalizedAssistantId =
      typeof payload.assistantMessageId === 'number'
        ? payload.assistantMessageId
        : typeof payload.assistant_message_id === 'number'
          ? payload.assistant_message_id
          : null
    const normalizedAssistantClientId =
      typeof payload.assistantClientMessageId === 'string'
        ? payload.assistantClientMessageId
        : typeof payload.assistant_client_message_id === 'string'
          ? payload.assistant_client_message_id
          : undefined
    return {
      type: 'start',
      messageId: normalizedMessageId,
      assistantMessageId: normalizedAssistantId,
      assistantClientMessageId: normalizedAssistantClientId ?? null,
    }
  }
  if (payload?.type === 'end') {
    return { type: 'end' }
  }
  if (payload?.type === 'complete') {
    return { type: 'complete' }
  }
  if (payload?.type === 'skill_approval_request') {
    return {
      type: 'skill_approval_request',
      requestId: payload.requestId,
      skillId: payload.skillId,
      skillSlug: payload.skillSlug,
      skillVersionId: payload.skillVersionId,
      tool: payload.tool,
      toolCallId: payload.toolCallId,
      reason: payload.reason,
      expiresAt: payload.expiresAt,
    }
  }
  if (payload?.type === 'skill_approval_result') {
    return {
      type: 'skill_approval_result',
      requestId: payload.requestId,
      skillId: payload.skillId,
      skillSlug: payload.skillSlug,
      tool: payload.tool,
      toolCallId: payload.toolCallId,
      decision: payload.decision,
    }
  }
  if (payload?.type === 'quota' && payload.quota) {
    return { type: 'quota', quota: payload.quota }
  }
  if (payload?.type === 'error') {
    const message =
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : '工具调用失败，请稍后重试'
    return {
      type: 'error',
      error: message,
      errorType: payload.errorType,
      suggestion: payload.suggestion,
    }
  }
  if (payload?.error) {
    throw new Error(payload.error)
  }
  return null
}
