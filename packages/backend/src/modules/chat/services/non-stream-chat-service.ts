import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { prisma as defaultPrisma } from '../../../db'
import type { UsageQuotaSnapshot } from '../../../types'
import { BackendLogger as log } from '../../../utils/logger'
import type { TaskTraceRecorder } from '../../../utils/task-trace'
import { redactHeadersForTrace, summarizeBodyForTrace } from '../../../utils/trace-helpers'
import { truncateString } from '../../../utils/task-trace'
import type { ProviderChatCompletionResponse } from '../chat-common'
import { sendMessageSchema } from '../chat-common'
import {
  chatRequestBuilder,
  type ChatRequestBuilder,
  type PreparedChatRequest,
} from './chat-request-builder'
import { providerRequester, type ProviderRequester } from './provider-requester'

type SendMessagePayload = z.infer<typeof sendMessageSchema>

type ChatSessionWithConnection = Prisma.ChatSessionGetPayload<{ include: { connection: true } }>

interface NonStreamChatRequest {
  session: ChatSessionWithConnection
  payload: SendMessagePayload
  content: string
  images?: Array<{ data: string; mime: string }>
  quotaSnapshot: UsageQuotaSnapshot | null
  traceRecorder?: TaskTraceRecorder | null
  personalPrompt?: string | null
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
  now?: () => Date
  requestBuilder?: ChatRequestBuilder
  requester?: ProviderRequester
}

export class NonStreamChatService {
  private prisma: PrismaClient
  private now: () => Date
  private requestBuilder: ChatRequestBuilder
  private requester: ProviderRequester

  constructor(deps: NonStreamChatServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.now = deps.now ?? (() => new Date())
    this.requestBuilder = deps.requestBuilder ?? chatRequestBuilder
    this.requester = deps.requester ?? providerRequester
  }

  async execute(request: NonStreamChatRequest): Promise<NonStreamChatResult> {
    const { session, payload, content, images = [], quotaSnapshot, traceRecorder, personalPrompt } = request
    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content,
      images,
      mode: 'completion',
      personalPrompt,
    })

    const response = await this.performProviderRequest({
      sessionId: session.id,
      providerRequest: prepared.providerRequest,
      traceRecorder,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      traceRecorder?.log('http:provider_error_body', {
        route: '/api/chat/completion',
        provider: prepared.providerRequest.providerLabel,
        sessionId: session.id,
        status: response.status,
        statusText: response.statusText,
        headers: redactHeadersForTrace(response.headers),
        bodyPreview: truncateString(errorText, 500),
      })
      throw new ChatCompletionServiceError(
        `AI API request failed: ${response.status} ${response.statusText}`,
        502,
      )
    }

    const json = (await response.json()) as ProviderChatCompletionResponse

    traceRecorder?.log('http:provider_response_parsed', {
      route: '/api/chat/completion',
      provider: prepared.providerRequest.providerLabel,
      sessionId: session.id,
      url: prepared.providerRequest.url,
      status: response.status,
      body: summarizeBodyForTrace(json),
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
    traceRecorder?: TaskTraceRecorder | null
  }) {
    return this.requester.requestWithBackoff({
      request: {
        url: params.providerRequest.url,
        headers: params.providerRequest.headers,
        body: params.providerRequest.body,
      },
      context: {
        sessionId: params.sessionId,
        provider: params.providerRequest.providerLabel,
        route: '/api/chat/completion',
        timeoutMs: params.providerRequest.timeoutMs,
      },
      traceRecorder: params.traceRecorder,
      traceContext: {
        route: '/api/chat/completion',
        provider: params.providerRequest.providerLabel,
        sessionId: params.sessionId,
      },
    })
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

let nonStreamChatService = new NonStreamChatService()

export const setNonStreamChatService = (service: NonStreamChatService) => {
  nonStreamChatService = service
}

export { nonStreamChatService }
