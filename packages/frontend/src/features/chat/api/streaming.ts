import {
  apiHttpClient,
  handleUnauthorizedRedirect,
} from '@/lib/api'
import { DEFAULT_API_BASE_URL } from '@/lib/http/client'
import { parseEventStream } from './stream-reader'
import type { ActorQuota, ApiResponse, ChatStreamChunk } from '@/types'

const client = apiHttpClient
const streamControllers = new Map<string, AbortController>()

type ImageAttachmentPayload = {
  data: string
  mime: string
}

export const streamChat = async function* streamChat(
  sessionId: number,
  content: string,
  images?: ImageAttachmentPayload[],
  options?: {
    reasoningEnabled?: boolean
    reasoningEffort?: 'low' | 'medium' | 'high'
    ollamaThink?: boolean
    saveReasoning?: boolean
    contextEnabled?: boolean
    clientMessageId?: string
    traceEnabled?: boolean
    replyToMessageId?: number | string
    replyToClientMessageId?: string
    customBody?: Record<string, any>
    customHeaders?: Array<{ name: string; value: string }>
    streamKey?: string
    knowledgeBaseIds?: number[]
  },
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const doOnce = async (signal: AbortSignal) => {
    const { replyToMessageId, replyToClientMessageId, ...rest } = options || {}
    const payload: Record<string, any> = {
      sessionId,
      content,
      ...(images ? { images } : {}),
      ...rest,
    }
    if (rest?.customBody) {
      payload.custom_body = rest.customBody
      delete payload.customBody
    }
    if (Array.isArray(rest?.customHeaders)) {
      payload.custom_headers = rest.customHeaders
      delete payload.customHeaders
    }
    if (typeof replyToMessageId === 'number') {
      payload.replyToMessageId = replyToMessageId
    }
    if (
      typeof replyToClientMessageId === 'string' &&
      replyToClientMessageId.trim().length > 0
    ) {
      payload.replyToClientMessageId = replyToClientMessageId.trim()
    }
    return fetch(`${DEFAULT_API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
      credentials: 'include',
    })
  }

  const streamKey =
    typeof options?.streamKey === 'string' && options.streamKey.trim().length > 0
      ? options.streamKey.trim()
      : `session:${sessionId}:${Date.now().toString(36)}:${Math.random()
        .toString(36)
        .slice(2)}`

  const controller = new AbortController()
  streamControllers.set(streamKey, controller)

  let response = await doOnce(controller.signal)
  if (response.status === 401) {
    handleUnauthorizedRedirect()
    throw new Error('Unauthorized')
  }
  if (response.status === 429) {
    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      // ignore
    }
    const error: any = new Error('Quota exceeded')
    error.status = 429
    error.payload = payload
    throw error
  }
  if (response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    response = await doOnce(controller.signal)
    if (response.status === 401) {
      handleUnauthorizedRedirect()
      throw new Error('Unauthorized')
    }
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

  const cleanup = () => {
    streamControllers.delete(streamKey)
  }

  for await (const chunk of parseEventStream(response, streamKey, cleanup)) {
    yield chunk
  }
}

export const cancelStream = (streamKey?: string) => {
  if (streamKey) {
    const controller = streamControllers.get(streamKey)
    if (controller) {
      try {
        controller.abort()
      } catch {
        // ignore
      }
      streamControllers.delete(streamKey)
    }
    return
  }
  streamControllers.forEach((controller) => {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  })
  streamControllers.clear()
}

export const cancelAgentStream = async (
  sessionId: number,
  options?: { clientMessageId?: string | null; messageId?: number | string | null },
) => {
  const payload: Record<string, unknown> = { sessionId }
  const clientMessageId = options?.clientMessageId
  const messageIdRaw = options?.messageId
  if (clientMessageId) {
    payload.clientMessageId = clientMessageId
  }
  if (typeof messageIdRaw === 'number' && Number.isFinite(messageIdRaw)) {
    payload.messageId = messageIdRaw
  } else if (typeof messageIdRaw === 'string' && messageIdRaw.trim()) {
    const numeric = Number(messageIdRaw)
    if (Number.isFinite(numeric)) {
      payload.messageId = numeric
    }
  }
  if (!payload.clientMessageId && typeof payload.messageId !== 'number') {
    return
  }
  try {
    await client.post('/chat/stream/cancel', payload)
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(
        '[cancelAgentStream] ignore error',
        (error as any)?.message || error,
      )
    }
  }
}

export const chatCompletion = async (
  sessionId: number,
  content: string,
  images?: ImageAttachmentPayload[],
  options?: {
    reasoningEnabled?: boolean
    reasoningEffort?: 'low' | 'medium' | 'high'
    ollamaThink?: boolean
    saveReasoning?: boolean
    contextEnabled?: boolean
    clientMessageId?: string
    customBody?: Record<string, any>
    customHeaders?: Array<{ name: string; value: string }>
  },
) => {
  const buildPayload = () => {
    const payload: Record<string, any> = {
      sessionId,
      content,
      images,
      ...(options || {}),
    }
    if (options?.customBody) {
      payload.custom_body = options.customBody
      delete payload.customBody
    }
    if (Array.isArray(options?.customHeaders)) {
      payload.custom_headers = options.customHeaders
      delete payload.customHeaders
    }
    return payload
  }
  const doOnce = () =>
    client.post<
      ApiResponse<{ content: string; usage: any; quota?: ActorQuota }>
    >('/chat/completion', buildPayload())
  let res = await doOnce()
  if (res.status === 429) {
    const error: any = new Error('Quota exceeded')
    error.status = 429
    error.response = res
    throw error
  } else if (res.status >= 500) {
    await new Promise((r) => setTimeout(r, 2000))
    res = await doOnce()
  }
  return res.data
}
