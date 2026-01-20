import type { ProviderType } from './providers'
import { convertOpenAIReasoningPayload } from './providers'
import { convertChatCompletionsRequestToResponses } from './openai-responses'

export type ProviderStreamMode = 'sse' | 'json'

export function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: any) => {
      if (part?.type === 'text') return part.text
      if (part?.type === 'image_url') return `[image:${part.image_url?.url}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function convertMessagesToPlainText(messages: any[]): Array<{ role: string; content: string }> {
  return messages.map((msg: any) => ({
    role: msg?.role,
    content: flattenMessageContent(msg?.content),
  }))
}

export function buildChatProviderRequest(params: {
  provider: ProviderType
  baseUrl: string
  rawModelId: string
  body: any
  azureApiVersion?: string | null
  stream?: boolean
}): { url: string; body: any; streamMode: ProviderStreamMode } {
  const baseUrl = (params.baseUrl || '').replace(/\/+$/, '')
  const stream =
    typeof params.stream === 'boolean' ? params.stream : Boolean(params.body?.stream)
  const streamMode: ProviderStreamMode =
    params.provider === 'openai' ||
    params.provider === 'openai_responses' ||
    params.provider === 'azure_openai'
      ? stream
        ? 'sse'
        : 'json'
      : 'json'

  const basePayload = convertOpenAIReasoningPayload({
    ...params.body,
    model: params.rawModelId,
    stream,
  })

  if (params.provider === 'openai') {
    return {
      url: `${baseUrl}/chat/completions`,
      body: basePayload,
      streamMode,
    }
  }

  if (params.provider === 'openai_responses') {
    return {
      url: `${baseUrl}/responses`,
      body: convertChatCompletionsRequestToResponses(basePayload),
      streamMode,
    }
  }

  if (params.provider === 'azure_openai') {
    const apiVersion = params.azureApiVersion || '2024-02-15-preview'
    return {
      url: `${baseUrl}/openai/deployments/${encodeURIComponent(
        params.rawModelId,
      )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
      body: basePayload,
      streamMode,
    }
  }

  if (params.provider === 'ollama') {
    return {
      url: `${baseUrl}/api/chat`,
      body: {
        model: params.rawModelId,
        stream,
        messages: convertMessagesToPlainText(params.body?.messages || []),
      },
      streamMode,
    }
  }

  if (params.provider === 'google_genai') {
    const endpoint = stream ? ':streamGenerateContent' : ':generateContent'
    return {
      url: `${baseUrl}/models/${encodeURIComponent(params.rawModelId)}${endpoint}`,
      body: {
        contents: (params.body?.messages || []).map((msg: any) => ({
          role: msg?.role,
          parts: [
            {
              text: flattenMessageContent(msg?.content),
            },
          ],
        })),
        generationConfig: {
          temperature: params.body?.temperature,
          topP: params.body?.top_p,
          maxOutputTokens: params.body?.max_tokens || params.body?.max_output_tokens,
        },
      },
      streamMode,
    }
  }

  throw new Error(`Unsupported provider: ${params.provider}`)
}
