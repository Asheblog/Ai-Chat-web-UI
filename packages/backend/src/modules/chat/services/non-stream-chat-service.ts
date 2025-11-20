import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { prisma as defaultPrisma } from '../../../db'
import type { UsageQuotaSnapshot } from '../../../types'
import { BackendLogger as log } from '../../../utils/logger'
import { logTraffic as defaultLogTraffic } from '../../../utils/traffic-logger'
import type { ProviderChatCompletionResponse } from '../chat-common'
import { BACKOFF_429_MS, BACKOFF_5XX_MS, sendMessageSchema } from '../chat-common'
import {
  chatRequestBuilder,
  type ChatRequestBuilder,
  type PreparedChatRequest,
} from './chat-request-builder'

type SendMessagePayload = z.infer<typeof sendMessageSchema>

type ChatSessionWithConnection = Prisma.ChatSessionGetPayload<{ include: { connection: true } }>

interface NonStreamChatRequest {
  session: ChatSessionWithConnection
  payload: SendMessagePayload
  content: string
  images?: Array<{ data: string; mime: string }>
  quotaSnapshot: UsageQuotaSnapshot | null
}

export interface NonStreamChatResult {
  content: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_limit: number
    context_remaining: number
  }
  quotaSnapshot: UsageQuotaSnapshot | null
}

export class ChatCompletionServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'ChatCompletionServiceError'
    this.statusCode = statusCode
  }
}

export interface NonStreamChatServiceDeps {
  prisma?: PrismaClient
  logTraffic?: typeof defaultLogTraffic
  fetchImpl?: typeof fetch
  now?: () => Date
  requestBuilder?: ChatRequestBuilder
}

export class NonStreamChatService {
  private prisma: PrismaClient
  private logTraffic: typeof defaultLogTraffic
  private fetchImpl: typeof fetch
  private now: () => Date
  private requestBuilder: ChatRequestBuilder

  constructor(deps: NonStreamChatServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.logTraffic = deps.logTraffic ?? defaultLogTraffic
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.now = deps.now ?? (() => new Date())
    this.requestBuilder = deps.requestBuilder ?? chatRequestBuilder
  }

  async execute(request: NonStreamChatRequest): Promise<NonStreamChatResult> {
    const { session, payload, content, images = [], quotaSnapshot } = request
    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content,
      images,
      mode: 'completion',
    })

    const response = await this.performProviderRequest({
      sessionId: session.id,
      providerRequest: prepared.providerRequest,
    })

    if (!response.ok) {
      throw new ChatCompletionServiceError(
        `AI API request failed: ${response.status} ${response.statusText}`,
        502,
      )
    }

    const json = (await response.json()) as ProviderChatCompletionResponse

    await this.logTraffic({
      category: 'upstream-response',
      route: '/api/chat/completion',
      direction: 'outbound',
      context: {
        sessionId: session.id,
        provider: prepared.providerRequest.providerLabel,
        url: prepared.providerRequest.url,
        stage: 'parsed',
      },
      payload: {
        status: response.status,
        body: json,
      },
    })

    const text = json?.choices?.[0]?.message?.content || ''
    const fallbackReasoning =
      json?.choices?.[0]?.message?.reasoning_content || json?.message?.thinking || undefined

    const usage = this.buildUsage(json, {
      promptTokens: prepared.promptTokens,
      contextLimit: prepared.contextLimit,
      contextRemaining: prepared.contextRemaining,
    })

    const sessionStillExists = await this.sessionExists(session.id)
    let assistantId: number | null = null
    if (text && sessionStillExists) {
      assistantId = await this.persistAssistantMessage({
        sessionId: session.id,
        content: text,
        reasoning: fallbackReasoning,
        saveReasoning: this.shouldSaveReasoning(payload),
      })
    } else if (text && !sessionStillExists) {
      log.warn('Skip persisting assistant message because session no longer exists', {
        sessionId: session.id,
      })
    }

    if (sessionStillExists) {
      await this.persistUsageMetric({
        session,
        assistantMessageId: assistantId,
        usage,
        providerHost: prepared.providerRequest.providerHost,
      })
    } else {
      log.warn('Skip persisting usage metric because session no longer exists', {
        sessionId: session.id,
      })
    }

    return {
      content: text,
      usage,
      quotaSnapshot,
    }
  }

  private async performProviderRequest(params: {
    sessionId: number
    providerRequest: PreparedChatRequest['providerRequest']
  }) {
    const serializeBody = () => JSON.stringify(params.providerRequest.body)
    const doOnce = async (signal: AbortSignal) => {
      await this.logTraffic({
        category: 'upstream-request',
        route: '/api/chat/completion',
        direction: 'outbound',
        context: {
          sessionId: params.sessionId,
          provider: params.providerRequest.providerLabel,
          url: params.providerRequest.url,
        },
        payload: {
          headers: params.providerRequest.headers,
          body: params.providerRequest.body,
        },
      })
      try {
        const response = await this.fetchImpl(params.providerRequest.url, {
          method: 'POST',
          headers: params.providerRequest.headers,
          body: serializeBody(),
          signal,
        })
        await this.logTraffic({
          category: 'upstream-response',
          route: '/api/chat/completion',
          direction: 'outbound',
          context: {
            sessionId: params.sessionId,
            provider: params.providerRequest.providerLabel,
            url: params.providerRequest.url,
          },
          payload: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
          },
        })
        return response
      } catch (error: any) {
        await this.logTraffic({
          category: 'upstream-error',
          route: '/api/chat/completion',
          direction: 'outbound',
          context: {
            sessionId: params.sessionId,
            provider: params.providerRequest.providerLabel,
            url: params.providerRequest.url,
          },
          payload: {
            message: error?.message || String(error),
          },
        })
        throw error
      }
    }

    const abortController = new AbortController()
    const timer = setTimeout(
      () => abortController.abort(new Error('provider timeout')),
      params.providerRequest.timeoutMs,
    )
    try {
      let response = await doOnce(abortController.signal)
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_429_MS))
        response = await doOnce(abortController.signal)
      } else if (response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_5XX_MS))
        response = await doOnce(abortController.signal)
      }
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  private buildUsage(
    json: ProviderChatCompletionResponse,
    context: { promptTokens: number; contextLimit: number; contextRemaining: number },
  ) {
    const u = json?.usage || {}
    const promptTokens =
      Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? context.promptTokens) ||
      context.promptTokens
    const completionTokens =
      Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
    const totalTokens =
      Number(u?.total_tokens ?? 0) || promptTokens + (Number(u?.completion_tokens ?? 0) || 0)

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      context_limit: context.contextLimit,
      context_remaining: context.contextRemaining,
    }
  }

  private async persistAssistantMessage(params: {
    sessionId: number
    content: string
    reasoning?: string
    saveReasoning: boolean
  }): Promise<number | null> {
    try {
      const saved = await this.prisma.message.create({
        data: {
          sessionId: params.sessionId,
          role: 'assistant',
          content: params.content,
          ...(params.reasoning && params.saveReasoning ? { reasoning: String(params.reasoning) } : {}),
        },
      })
      return saved.id
    } catch (error) {
      log.warn('Persist assistant message failed', {
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : error,
      })
      return null
    }
  }

  private async persistUsageMetric(params: {
    session: ChatSessionWithConnection
    assistantMessageId: number | null
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; context_limit: number }
    providerHost: string | null
  }) {
    try {
      await (this.prisma as any).usageMetric.create({
        data: {
          sessionId: params.session.id,
          messageId: params.assistantMessageId ?? undefined,
          model: params.session.modelRawId || 'unknown',
          provider: params.providerHost ?? undefined,
          promptTokens: params.usage.prompt_tokens,
          completionTokens: params.usage.completion_tokens,
          totalTokens: params.usage.total_tokens,
          contextLimit: params.usage.context_limit,
        },
      })
    } catch (error) {
      log.warn('Persist usage metric failed', {
        sessionId: params.session.id,
        error: error instanceof Error ? error.message : error,
      })
    }
  }

  private async sessionExists(sessionId: number): Promise<boolean> {
    const count = await this.prisma.chatSession.count({ where: { id: sessionId } })
    return count > 0
  }

  private shouldSaveReasoning(payload: SendMessagePayload): boolean {
    if (typeof payload?.saveReasoning === 'boolean') {
      return payload.saveReasoning
    }
    return true
  }
}

export const nonStreamChatService = new NonStreamChatService()
