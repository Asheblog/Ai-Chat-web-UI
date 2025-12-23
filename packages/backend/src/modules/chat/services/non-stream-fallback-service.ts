import { convertOpenAIReasoningPayload } from '../../../utils/providers'
import {
  convertChatCompletionsRequestToResponses,
  extractReasoningFromResponsesResponse,
  extractTextFromResponsesResponse,
} from '../../../utils/openai-responses'
import type { TaskTraceRecorder } from '../../../utils/task-trace'
import { redactHeadersForTrace, summarizeBodyForTrace, summarizeErrorForTrace } from '../../../utils/trace-helpers'
import { truncateString } from '../../../utils/task-trace'

type Provider = 'openai' | 'openai_responses' | 'azure_openai' | 'ollama'

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
  traceRecorder?: TaskTraceRecorder | null
  traceContext?: Record<string, unknown>
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
    const traceRecorder = params.traceRecorder
    const traceContext = params.traceContext || {}
    const logTrace = (eventType: string, payload: Record<string, unknown>) =>
      traceRecorder?.log(eventType, { ...traceContext, ...payload })
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
      } else if (params.provider === 'openai_responses') {
        body = convertChatCompletionsRequestToResponses(convertOpenAIReasoningPayload(body))
        url = `${params.baseUrl}/responses`
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

      logTrace('http:provider_request', {
        route: '/api/chat/stream',
        mode: 'fallback_non_stream',
        provider: params.provider,
        url,
        headers: redactHeadersForTrace(headers),
        body: summarizeBodyForTrace(body),
        timeoutMs: params.timeoutMs,
      })

      const resp = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      logTrace('http:provider_response', {
        route: '/api/chat/stream',
        mode: 'fallback_non_stream',
        provider: params.provider,
        url,
        status: resp.status,
        statusText: resp.statusText,
        headers: redactHeadersForTrace(resp.headers),
      })
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '')
        logTrace('http:provider_error_body', {
          route: '/api/chat/stream',
          mode: 'fallback_non_stream',
          provider: params.provider,
          url,
          status: resp.status,
          statusText: resp.statusText,
          bodyPreview: truncateString(errorText, 500),
        })
        return null
      }
      const json = (await resp.json()) as any
      const text = (
        params.provider === 'openai_responses'
          ? extractTextFromResponsesResponse(json)
          : (json?.choices?.[0]?.message?.content || '').trim()
      ).trim()
      if (!text) return null
      const reasoningText =
        params.provider === 'openai_responses'
          ? extractReasoningFromResponsesResponse(json)
          : (json?.choices?.[0]?.message?.reasoning_content || (json as any)?.message?.thinking || null)
      return {
        text,
        reasoning: reasoningText,
        usage: json?.usage ?? null,
      }
    } catch (error) {
      this.logger.warn?.('Non-stream fallback request failed', {
        error: error instanceof Error ? error.message : error,
      })
      logTrace('http:provider_error', {
        route: '/api/chat/stream',
        mode: 'fallback_non_stream',
        provider: params.provider,
        error: summarizeErrorForTrace(error),
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
