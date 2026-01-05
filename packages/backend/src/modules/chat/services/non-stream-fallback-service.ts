import { convertOpenAIReasoningPayload } from '../../../utils/providers'
import {
  convertChatCompletionsRequestToResponses,
  extractReasoningFromResponsesResponse,
  extractTextFromResponsesResponse,
} from '../../../utils/openai-responses'
import type { GeneratedImage } from '../../../services/image-generation'
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
  images?: GeneratedImage[]
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
      
      // 调试日志：记录完整响应结构以便分析图片数据位置
      const message = json?.choices?.[0]?.message
      const messageImages = (message as any)?.images
      logTrace('http:provider_response_body', {
        route: '/api/chat/stream',
        mode: 'fallback_non_stream',
        provider: params.provider,
        hasChoices: !!json?.choices,
        choiceCount: json?.choices?.length ?? 0,
        messageKeys: message ? Object.keys(message) : [],
        messageContentType: typeof message?.content,
        messageContentIsArray: Array.isArray(message?.content),
        messageContentPreview: truncateString(
          typeof message?.content === 'string'
            ? message.content
            : JSON.stringify(message?.content),
          500
        ),
        // 检查可能存放图片的其他字段
        hasInlineData: !!(message as any)?.inline_data,
        hasParts: Array.isArray((message as any)?.parts),
        // 检查 CLIProxyAPI 特有的 images 字段
        hasImages: !!messageImages,
        imagesCount: Array.isArray(messageImages) ? messageImages.length : 0,
        // 输出 images 的完整结构（第一个元素）用于调试
        firstImageRaw: Array.isArray(messageImages) && messageImages.length > 0
          ? truncateString(JSON.stringify(messageImages[0]), 1000)
          : undefined,
        firstImageKeys: Array.isArray(messageImages) && messageImages.length > 0 && messageImages[0]
          ? Object.keys(messageImages[0])
          : undefined,
        imagesPreview: Array.isArray(messageImages)
          ? messageImages.map((img: any) => ({
              hasUrl: !!img?.url,
              hasBase64: !!img?.b64_json || !!img?.base64,
              hasData: !!img?.data,
              hasImageUrl: !!(img?.image_url),
              imageUrlKeys: img?.image_url ? Object.keys(img.image_url) : undefined,
              type: img?.type,
              mime: img?.mime_type || img?.mime,
            })).slice(0, 5)
          : undefined,
        partsPreview: Array.isArray((message as any)?.parts)
          ? (message as any).parts.map((p: any) => ({ type: p?.type, hasData: !!p?.data || !!p?.inline_data })).slice(0, 5)
          : undefined,
        // 如果 content 是数组，分析其结构
        contentPartsTypes: Array.isArray(message?.content)
          ? (message.content as any[]).map((p: any) => p?.type).slice(0, 10)
          : undefined,
      })
      
      const parseDataUrl = (value?: string): { mime?: string; base64?: string } | null => {
        if (!value || !value.startsWith('data:')) return null
        const match = /^data:([^;]+);base64,(.*)$/.exec(value)
        if (!match) return null
        return { mime: match[1], base64: match[2] }
      }

      const extractImage = (img: any): GeneratedImage | null => {
        if (!img) return null
        let url = img?.url
        let base64 = img?.b64_json || img?.base64 || img?.data
        let mime = img?.mime_type || img?.mime
        const revisedPrompt = img?.revised_prompt || img?.revisedPrompt

        if (!url && img?.image_url?.url) {
          url = img.image_url.url
        }
        if (!base64 && img?.image_url?.data) {
          base64 = img.image_url.data
        }
        if (!mime && img?.image_url?.mime_type) {
          mime = img.image_url.mime_type
        }
        if (url && !base64) {
          const parsed = parseDataUrl(url)
          if (parsed?.base64) {
            base64 = parsed.base64
            mime = mime || parsed.mime
          }
        }
        if (!url && !base64) return null
        return { url, base64, mime, revisedPrompt }
      }

      const extractedImages: GeneratedImage[] = []
      if (Array.isArray(messageImages)) {
        for (const img of messageImages) {
          const extracted = extractImage(img)
          if (extracted) extractedImages.push(extracted)
        }
      }

      const messageContent = json?.choices?.[0]?.message?.content
      if (Array.isArray(messageContent)) {
        for (const part of messageContent) {
          if (part?.type === 'image_url') {
            const extracted = extractImage(part)
            if (extracted) extractedImages.push(extracted)
          }
        }
      }

      // 处理可能的 multimodal 响应
      let text = ''
      if (params.provider === 'openai_responses') {
        text = extractTextFromResponsesResponse(json)
      } else if (typeof messageContent === 'string') {
        text = messageContent.trim()
      } else if (Array.isArray(messageContent)) {
        // Multimodal 响应：提取文本部分
        const textParts = messageContent
          .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
          .map((part: any) => part.text)
        text = textParts.join('\n').trim()
      }
      
      if (!text && extractedImages.length === 0) return null
      const reasoningText =
        params.provider === 'openai_responses'
          ? extractReasoningFromResponsesResponse(json)
          : (json?.choices?.[0]?.message?.reasoning_content || (json as any)?.message?.thinking || null)
      return {
        text,
        reasoning: reasoningText,
        usage: json?.usage ?? null,
        images: extractedImages.length > 0 ? extractedImages : undefined,
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
