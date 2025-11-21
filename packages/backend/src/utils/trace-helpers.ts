import { sanitizePayload, truncateString } from './task-trace'

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-openai-api-key',
  'x-rapidapi-key',
  'x-azure-api-key',
  'subscription-key',
  'cookie',
  'set-cookie',
  'token',
  'secret',
  'openrouter',
]

const maskHeaderValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '***'
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

export const redactHeadersForTrace = (
  headers?: Headers | Record<string, string | string[] | undefined | null> | null,
): Record<string, string> => {
  if (!headers) return {}
  const entries =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers)
  return entries.reduce<Record<string, string>>((acc, [key, raw]) => {
    if (raw == null) return acc
    const serialized = Array.isArray(raw) ? raw.join(', ') : String(raw)
    const lower = key.toLowerCase()
    const isSensitive = SENSITIVE_HEADER_KEYS.some((needle) => lower.includes(needle))
    acc[key] = isSensitive ? maskHeaderValue(serialized) : truncateString(serialized, 200)
    return acc
  }, {})
}

const summarizeMessages = (messages: any[]) =>
  messages.slice(0, 5).map((msg) => ({
    role: msg?.role,
    name: msg?.name,
    contentPreview: typeof msg?.content === 'string'
      ? truncateString(msg.content, 240)
      : Array.isArray(msg?.content)
        ? truncateString(
            msg.content
              .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
              .filter(Boolean)
              .join('\n'),
            240,
          )
        : undefined,
    toolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : undefined,
    thinkingPreview:
      typeof msg?.thinking === 'string'
        ? truncateString(msg.thinking, 160)
        : undefined,
  }))

const summarizeImages = (images: any[]) =>
  images.slice(0, 4).map((img) => ({
    mime: img?.mime,
    size: typeof img?.data === 'string' ? img.data.length : undefined,
  }))

export const summarizeBodyForTrace = (body: unknown): any => {
  if (body == null) return body
  if (typeof body === 'string') {
    return { kind: 'text', length: body.length, preview: truncateString(body, 260) }
  }
  if (Array.isArray(body)) {
    return {
      kind: 'array',
      length: body.length,
      sample: body.slice(0, 5).map((item) => summarizeBodyForTrace(item)),
    }
  }
  if (typeof body === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (key === 'messages' && Array.isArray(value)) {
        result.messages = summarizeMessages(value)
        continue
      }
      if (key === 'images' && Array.isArray(value)) {
        result.images = summarizeImages(value)
        continue
      }
      if (key.toLowerCase().includes('header') || key.toLowerCase().includes('token')) {
        result[key] = '[redacted]'
        continue
      }
      result[key] = sanitizePayload(value)
    }
    return result
  }
  return body
}

export const summarizeErrorForTrace = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? truncateString(error.stack, 800) : undefined,
    }
  }
  return { error: sanitizePayload(error) }
}
