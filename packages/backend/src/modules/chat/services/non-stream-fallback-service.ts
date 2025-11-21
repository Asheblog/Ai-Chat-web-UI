import { convertOpenAIReasoningPayload } from '../../../utils/providers'

type Provider = 'openai' | 'azure_openai' | 'ollama'

export interface NonStreamFallbackParams {
  provider: Provider
  baseUrl: string
  modelRawId: string
  messagesPayload: any[]
  requestData: any
  authHeader: Record<string, string>
  extraHeaders: Record<string, string>
  azureApiVersion?: string | null
  timeoutMs: number
  logger?: Pick<typeof console, 'warn'>
  fetchImpl?: typeof fetch
}

export interface NonStreamFallbackResult {
  text: string
  reasoning?: string | null
  usage?: any
}

export class NonStreamFallbackService {
  private logger: Pick<typeof console, 'warn'>
  private fetchImpl: typeof fetch

  constructor(deps: { logger?: Pick<typeof console, 'warn'>; fetchImpl?: typeof fetch } = {}) {
    this.logger = deps.logger ?? console
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  async execute(params: NonStreamFallbackParams): Promise<NonStreamFallbackResult | null> {
    const nonStreamData = { ...params.requestData, stream: false } as any
    const ac = new AbortController()
    const fallbackTimeout = setTimeout(
      () => ac.abort(new Error('provider non-stream timeout')),
      params.timeoutMs,
    )
    try {
      let url = ''
      let body: any = { ...nonStreamData }
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...params.authHeader,
        ...params.extraHeaders,
      }
      if (params.provider === 'openai') {
        body = convertOpenAIReasoningPayload(body)
        url = `${params.baseUrl}/chat/completions`
      } else if (params.provider === 'azure_openai') {
        const v = params.azureApiVersion || '2024-02-15-preview'
        body = convertOpenAIReasoningPayload(body)
        url = `${params.baseUrl}/openai/deployments/${encodeURIComponent(
          params.modelRawId,
        )}/chat/completions?api-version=${encodeURIComponent(v)}`
      } else if (params.provider === 'ollama') {
        url = `${params.baseUrl}/api/chat`
        body = {
          model: params.modelRawId,
          messages: params.messagesPayload.map((m: any) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content?.map((p: any) => p.text).filter(Boolean).join('\n'),
          })),
          stream: false,
        }
      } else {
        url = `${params.baseUrl}`
      }

      const resp = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      if (!resp.ok) return null
      const json = (await resp.json()) as any
      const text = (json?.choices?.[0]?.message?.content || '').trim()
      if (!text) return null
      const reasoningText =
        json?.choices?.[0]?.message?.reasoning_content || (json as any)?.message?.thinking || null
      return {
        text,
        reasoning: reasoningText,
        usage: json?.usage ?? null,
      }
    } catch (error) {
      this.logger.warn?.('Non-stream fallback request failed', {
        error: error instanceof Error ? error.message : error,
      })
      return null
    } finally {
      clearTimeout(fallbackTimeout)
    }
  }
}

let nonStreamFallbackService = new NonStreamFallbackService()

export const setNonStreamFallbackService = (service: NonStreamFallbackService) => {
  nonStreamFallbackService = service
}

export { nonStreamFallbackService }
