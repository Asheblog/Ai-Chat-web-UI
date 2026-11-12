import { convertAnthropicMessageToChatCompletion } from './anthropic-convert'
import { createAnthropicSseToOpenAIStream } from './anthropic-sse'

const copyResponseHeaders = (response: Response): Headers => {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  return headers
}

/**
 * 在 HTTP 边界把 Anthropic 响应归一化为内部 OpenAI 形状。
 * 非 Anthropic 或错误响应原样返回。
 */
export async function adaptProviderResponse(
  response: Response,
  provider: string,
  stream: boolean,
): Promise<Response> {
  if (provider !== 'anthropic' || !response.ok) return response

  const upstreamContentType = response.headers.get('content-type') || ''
  const upstreamLooksJson = /application\/json/i.test(upstreamContentType)

  if (stream && !upstreamLooksJson) {
    if (!response.body) return response
    const headers = copyResponseHeaders(response)
    headers.set('content-type', 'text/event-stream; charset=utf-8')
    return new Response(response.body.pipeThrough(createAnthropicSseToOpenAIStream()), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  const text = await response.text()
  const headers = copyResponseHeaders(response)
  headers.set('content-type', 'application/json; charset=utf-8')
  try {
    const json = JSON.parse(text)
    return new Response(JSON.stringify(convertAnthropicMessageToChatCompletion(json)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/** 直接 fetch 的调用点使用：读取并按 provider 归一化 JSON。 */
export async function readProviderJson<T = any>(
  response: { json?: () => Promise<any>; text: () => Promise<string> },
  provider: string,
): Promise<T> {
  let json: any
  if (typeof (response as any).json === 'function') {
    try {
      json = await (response as any).json()
    } catch {
      const text = await response.text()
      json = text ? JSON.parse(text) : {}
    }
  } else {
    const text = await response.text()
    json = text ? JSON.parse(text) : {}
  }
  if (provider === 'anthropic') {
    return convertAnthropicMessageToChatCompletion(json) as T
  }
  return json as T
}
