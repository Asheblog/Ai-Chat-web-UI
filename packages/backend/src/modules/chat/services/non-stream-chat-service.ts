import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../../config/storage'
import { prisma as defaultPrisma } from '../../../db'
import type { UsageQuotaSnapshot } from '../../../types'
import { cleanupExpiredChatImages as defaultCleanupExpiredChatImages } from '../../../utils/chat-images'
import { resolveCompletionLimit as defaultResolveCompletionLimit, resolveContextLimit as defaultResolveContextLimit } from '../../../utils/context-window'
import { BackendLogger as log } from '../../../utils/logger'
import { AuthUtils as defaultAuthUtils } from '../../../utils/auth'
import { Tokenizer } from '../../../utils/tokenizer'
import { logTraffic as defaultLogTraffic } from '../../../utils/traffic-logger'
import type { ProviderChatCompletionResponse } from '../chat-common'
import { BACKOFF_429_MS, BACKOFF_5XX_MS, sendMessageSchema } from '../chat-common'

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

const parseHeadersJson = (raw?: string | null): Record<string, string> => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    )
  } catch {
    return {}
  }
}

export interface NonStreamChatServiceDeps {
  prisma?: PrismaClient
  tokenizer?: Pick<typeof Tokenizer, 'truncateMessages' | 'countConversationTokens'>
  resolveContextLimit?: typeof defaultResolveContextLimit
  resolveCompletionLimit?: typeof defaultResolveCompletionLimit
  cleanupExpiredChatImages?: typeof defaultCleanupExpiredChatImages
  authUtils?: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  logTraffic?: typeof defaultLogTraffic
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class NonStreamChatService {
  private prisma: PrismaClient
  private tokenizer: Pick<typeof Tokenizer, 'truncateMessages' | 'countConversationTokens'>
  private resolveContextLimit: typeof defaultResolveContextLimit
  private resolveCompletionLimit: typeof defaultResolveCompletionLimit
  private cleanupExpiredChatImages: typeof defaultCleanupExpiredChatImages
  private authUtils: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  private logTraffic: typeof defaultLogTraffic
  private fetchImpl: typeof fetch
  private now: () => Date

  constructor(deps: NonStreamChatServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.tokenizer = deps.tokenizer ?? Tokenizer
    this.resolveContextLimit = deps.resolveContextLimit ?? defaultResolveContextLimit
    this.resolveCompletionLimit = deps.resolveCompletionLimit ?? defaultResolveCompletionLimit
    this.cleanupExpiredChatImages = deps.cleanupExpiredChatImages ?? defaultCleanupExpiredChatImages
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.logTraffic = deps.logTraffic ?? defaultLogTraffic
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.now = deps.now ?? (() => new Date())
  }

  async execute(request: NonStreamChatRequest): Promise<NonStreamChatResult> {
    const { session, payload, content, images = [], quotaSnapshot } = request
    const contextInfo = await this.buildContextMessages({
      sessionId: session.id,
      connectionId: session.connectionId!,
      modelRawId: session.modelRawId!,
      provider: session.connection.provider,
      actorContent: content,
      contextEnabled: payload?.contextEnabled !== false,
    })

    const requestedFeatures = payload?.features || {}
    let preparedMessages = contextInfo.truncatedContext
    if (requestedFeatures.web_search === true) {
      preparedMessages = [
        {
          role: 'system',
          content:
            '仅在需要最新信息时调用 web_search，且 query 必须包含明确关键词（如事件、日期、地点、人物或问题本身）。若无需搜索或无关键词，请直接回答，不要调用工具。',
        },
        ...preparedMessages,
      ]
    }

    const providerRequest = await this.buildProviderRequest({
      session,
      payload,
      content,
      images,
      messages: preparedMessages,
      appliedMaxTokens: contextInfo.appliedMaxTokens,
    })

    const response = await this.performProviderRequest({
      sessionId: session.id,
      provider: providerRequest.providerLabel,
      url: providerRequest.url,
      headers: providerRequest.headers,
      body: providerRequest.body,
      timeoutMs: providerRequest.timeoutMs,
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
        provider: providerRequest.providerLabel,
        url: providerRequest.url,
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
      promptTokens: contextInfo.promptTokens,
      contextLimit: contextInfo.contextLimit,
      contextRemaining: contextInfo.contextRemaining,
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
        providerHost: providerRequest.providerHost,
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

  private async buildContextMessages(params: {
    sessionId: number
    connectionId: number
    modelRawId: string
    provider: string
    actorContent: string
    contextEnabled: boolean
  }): Promise<{
    truncatedContext: Array<{ role: string; content: string }>
    promptTokens: number
    contextLimit: number
    contextRemaining: number
    appliedMaxTokens: number
  }> {
    const contextLimit = await this.resolveContextLimit({
      connectionId: params.connectionId,
      rawModelId: params.modelRawId,
      provider: params.provider,
    })

    let truncated: Array<{ role: string; content: string }>
    if (params.contextEnabled) {
      const recent = await this.prisma.message.findMany({
        where: { sessionId: params.sessionId },
        select: { role: true, content: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const conversation = recent
        .filter((msg) => msg.role !== 'user' || msg.content !== params.actorContent)
        .reverse()

      truncated = await this.tokenizer.truncateMessages(
        conversation.concat([{ role: 'user', content: params.actorContent }]),
        contextLimit,
      )
    } else {
      truncated = [{ role: 'user', content: params.actorContent }]
    }

    const promptTokens = await this.tokenizer.countConversationTokens(truncated)
    const contextRemaining = Math.max(0, contextLimit - promptTokens)
    const completionLimit = await this.resolveCompletionLimit({
      connectionId: params.connectionId,
      rawModelId: params.modelRawId,
      provider: params.provider,
    })
    const appliedMaxTokens = Math.max(
      1,
      Math.min(completionLimit, Math.max(1, contextRemaining)),
    )

    return {
      truncatedContext: truncated,
      promptTokens,
      contextLimit,
      contextRemaining,
      appliedMaxTokens,
    }
  }

  private async buildProviderRequest(params: {
    session: ChatSessionWithConnection
    payload: SendMessagePayload
    messages: Array<{ role: string; content: string }>
    content: string
    images: Array<{ data: string; mime: string }>
    appliedMaxTokens: number
  }) {
    const { session, payload, messages, content, images, appliedMaxTokens } = params
    const provider = session.connection.provider as 'openai' | 'azure_openai' | 'ollama'

    const messagesPayload = this.buildMessagesPayload(messages, content, images, provider)

    const settingsMap = await this.loadSystemSettings()
    this.scheduleImageCleanup(settingsMap)
    const timeoutMs = this.resolveProviderTimeout(settingsMap)

    const reasoningEnabled = this.resolveReasoningEnabled(payload, session, settingsMap)
    const reasoningEffort = this.resolveReasoningEffort(payload, session, settingsMap)
    const ollamaThinkEnabled = this.resolveOllamaThink(payload, session, settingsMap)

    const baseUrl = session.connection.baseUrl.replace(/\/$/, '')
    const providerHost = this.safeResolveHost(baseUrl)
    const extraHeaders = parseHeadersJson(session.connection.headersJson)
    const decryptedApiKey =
      session.connection.authType === 'bearer' && session.connection.apiKey
        ? this.authUtils.decryptApiKey(session.connection.apiKey)
        : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(session.connection.authType === 'bearer' && decryptedApiKey
        ? { Authorization: `Bearer ${decryptedApiKey}` }
        : {}),
      ...extraHeaders,
    }

    let body: any = {
      model: session.modelRawId,
      messages: messagesPayload,
      stream: false,
      temperature: 0.7,
      max_tokens: appliedMaxTokens,
    }

    if (reasoningEnabled) {
      if (reasoningEffort) {
        body.reasoning_effort = reasoningEffort
      }
      if (ollamaThinkEnabled) {
        body.think = true
      }
    } else {
      delete body.reasoning_effort
      delete body.think
    }

    let url = ''
    if (provider === 'openai') {
      url = `${baseUrl}/chat/completions`
    } else if (provider === 'azure_openai') {
      const apiVersion = session.connection.azureApiVersion || '2024-02-15-preview'
      url = `${baseUrl}/openai/deployments/${encodeURIComponent(session.modelRawId!)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    } else if (provider === 'ollama') {
      url = `${baseUrl}/api/chat`
      body = {
        model: session.modelRawId,
        messages: messagesPayload.map((item: any) => ({
          role: item.role,
          content: typeof item.content === 'string'
            ? item.content
            : item.content?.map((part: any) => part.text).filter(Boolean).join('\n'),
        })),
        stream: false,
      }
    }

    return {
      providerLabel: provider,
      providerHost,
      url,
      headers,
      body,
      timeoutMs,
    }
  }

  private buildMessagesPayload(
    context: Array<{ role: string; content: string }>,
    content: string,
    images: Array<{ data: string; mime: string }>,
    provider: string,
  ) {
    const messagesPayload = context.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    if (provider === 'ollama') {
      return messagesPayload
    }

    const parts: any[] = []
    if (content?.trim()) {
      parts.push({ type: 'text', text: content })
    }
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` },
      })
    }

    if (parts.length === 0) {
      return messagesPayload
    }

    const last = messagesPayload[messagesPayload.length - 1]
    if (last && last.role === 'user' && last.content === content) {
      messagesPayload[messagesPayload.length - 1] = { role: 'user', content: parts }
    } else {
      messagesPayload.push({ role: 'user', content: parts })
    }

    return messagesPayload
  }

  private async loadSystemSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({ select: { key: true, value: true } })
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value ?? ''
      return acc
    }, {})
  }

  private scheduleImageCleanup(settings: Record<string, string>) {
    const retentionRaw =
      settings.chat_image_retention_days ||
      process.env.CHAT_IMAGE_RETENTION_DAYS ||
      `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`
    const retention = Number.parseInt(retentionRaw, 10)
    const value = Number.isFinite(retention) ? retention : CHAT_IMAGE_DEFAULT_RETENTION_DAYS
    this.cleanupExpiredChatImages(value).catch((error) => {
      log.warn('[chat] cleanupExpiredChatImages failed', {
        error: error instanceof Error ? error.message : error,
      })
    })
  }

  private resolveProviderTimeout(settings: Record<string, string>): number {
    const raw = settings.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000'
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000
  }

  private resolveReasoningEnabled(
    payload: SendMessagePayload,
    session: ChatSessionWithConnection,
    settings: Record<string, string>,
  ): boolean {
    if (typeof payload?.reasoningEnabled === 'boolean') {
      return payload.reasoningEnabled
    }
    if (typeof session.reasoningEnabled === 'boolean') {
      return session.reasoningEnabled
    }
    const fallback = settings.reasoning_enabled ?? process.env.REASONING_ENABLED ?? 'true'
    return fallback.toString().toLowerCase() !== 'false'
  }

  private resolveReasoningEffort(
    payload: SendMessagePayload,
    session: ChatSessionWithConnection,
    settings: Record<string, string>,
  ): string {
    return (
      payload?.reasoningEffort ||
      session.reasoningEffort ||
      settings.openai_reasoning_effort ||
      process.env.OPENAI_REASONING_EFFORT ||
      ''
    ).toString()
  }

  private resolveOllamaThink(
    payload: SendMessagePayload,
    session: ChatSessionWithConnection,
    settings: Record<string, string>,
  ): boolean {
    if (typeof payload?.ollamaThink === 'boolean') {
      return payload.ollamaThink
    }
    if (typeof session.ollamaThink === 'boolean') {
      return session.ollamaThink
    }
    const fallback = settings.ollama_think ?? process.env.OLLAMA_THINK ?? 'false'
    return fallback.toString().toLowerCase() === 'true'
  }

  private shouldSaveReasoning(payload: SendMessagePayload): boolean {
    if (typeof payload?.saveReasoning === 'boolean') {
      return payload.saveReasoning
    }
    return true
  }

  private safeResolveHost(baseUrl: string): string | null {
    try {
      const parsed = new URL(baseUrl)
      return parsed.hostname
    } catch {
      return null
    }
  }

  private async performProviderRequest(params: {
    sessionId: number
    provider: string
    url: string
    headers: Record<string, string>
    body: any
    timeoutMs: number
  }) {
    const { sessionId, provider, url, headers, body, timeoutMs } = params

    const doOnce = async (signal: AbortSignal) => {
      await this.logTraffic({
        category: 'upstream-request',
        route: '/api/chat/completion',
        direction: 'outbound',
        context: {
          sessionId,
          provider,
          url,
        },
        payload: {
          headers,
          body,
        },
      })
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        })
        await this.logTraffic({
          category: 'upstream-response',
          route: '/api/chat/completion',
          direction: 'outbound',
          context: {
            sessionId,
            provider,
            url,
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
            sessionId,
            provider,
            url,
          },
          payload: {
            message: error?.message || String(error),
          },
        })
        throw error
      }
    }

    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(new Error('provider timeout')), timeoutMs)
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
}

export const nonStreamChatService = new NonStreamChatService()
