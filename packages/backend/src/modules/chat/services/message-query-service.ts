import type { Prisma, PrismaClient } from '@prisma/client'
import type { Request } from 'undici'
import { prisma as defaultPrisma } from '../../../db'
import type { Actor } from '../../../types'
import {
  determineChatImageBaseUrl as defaultDetermineChatImageBaseUrl,
  resolveChatImageUrls as defaultResolveChatImageUrls,
} from '../../../utils/chat-images'
import { parseToolLogsJson as defaultParseToolLogsJson, type ToolLogEntry } from '../tool-logs'
import { sessionOwnershipClause } from '../chat-common'

const messageSelectFields = {
  id: true,
  sessionId: true,
  role: true,
  content: true,
  parentMessageId: true,
  variantIndex: true,
  attachments: {
    select: {
      relativePath: true,
    },
  },
  clientMessageId: true,
  reasoning: true,
  reasoningDurationSeconds: true,
  toolLogsJson: true,
  createdAt: true,
  updatedAt: true,
  streamStatus: true,
  streamCursor: true,
  streamReasoning: true,
  streamError: true,
  usageMetrics: {
    select: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      firstTokenLatencyMs: true,
      responseTimeMs: true,
      tokensPerSecond: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} as const

type RawMessage = Prisma.MessageGetPayload<{ select: typeof messageSelectFields }>

export interface NormalizedMessage {
  id: number
  sessionId: number
  role: string
  content: any
  parentMessageId: number | null
  variantIndex: number | null
  clientMessageId: string | null
  reasoning: string | null
  reasoningDurationSeconds: number | null
  createdAt: Date
  updatedAt: Date
  streamStatus: string | null
  streamCursor: number | null
  streamReasoning: string | null
  streamError: string | null
  images: string[]
  toolEvents?: ToolLogEntry[]
  metrics?: {
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    firstTokenLatencyMs?: number | null
    responseTimeMs?: number | null
    tokensPerSecond?: number | null
  } | null
}

export interface ListMessagesResult {
  messages: NormalizedMessage[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface ChatMessageQueryServiceDeps {
  prisma?: PrismaClient
  determineChatImageBaseUrl?: typeof defaultDetermineChatImageBaseUrl
  resolveChatImageUrls?: typeof defaultResolveChatImageUrls
  parseToolLogsJson?: typeof defaultParseToolLogsJson
}

export class ChatMessageQueryService {
  private prisma: PrismaClient
  private determineChatImageBaseUrl: typeof defaultDetermineChatImageBaseUrl
  private resolveChatImageUrls: typeof defaultResolveChatImageUrls
  private parseToolLogsJson: typeof defaultParseToolLogsJson

  constructor(deps: ChatMessageQueryServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.determineChatImageBaseUrl =
      deps.determineChatImageBaseUrl ?? defaultDetermineChatImageBaseUrl
    this.resolveChatImageUrls = deps.resolveChatImageUrls ?? defaultResolveChatImageUrls
    this.parseToolLogsJson = deps.parseToolLogsJson ?? defaultParseToolLogsJson
  }

  async listMessages(params: {
    actor: Actor
    sessionId: number
    page: number
    limit: number
    request: Request
  }): Promise<ListMessagesResult> {
    const [messages, total, baseUrl] = await Promise.all([
      this.prisma.message.findMany({
        where: { sessionId: params.sessionId },
        select: messageSelectFields,
        orderBy: { createdAt: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.message.count({
        where: { sessionId: params.sessionId },
      }),
      this.resolveImageBaseUrl(params.request),
    ])

    return {
      messages: messages.map((msg) => this.normalizeMessage(msg, baseUrl)),
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    }
  }

  async getMessageById(params: {
    actor: Actor
    sessionId: number
    messageId: number
    request: Request
  }): Promise<NormalizedMessage | null> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: params.messageId,
        sessionId: params.sessionId,
        session: sessionOwnershipClause(params.actor),
      },
      select: messageSelectFields,
    })

    if (!message) return null
    const baseUrl = await this.resolveImageBaseUrl(params.request)
    return this.normalizeMessage(message, baseUrl)
  }

  async getMessageByClientId(params: {
    actor: Actor
    sessionId: number
    clientMessageId: string
    request: Request
  }): Promise<NormalizedMessage | null> {
    const message = await this.prisma.message.findFirst({
      where: {
        sessionId: params.sessionId,
        clientMessageId: params.clientMessageId,
        session: sessionOwnershipClause(params.actor),
      },
      select: messageSelectFields,
    })

    if (!message) return null
    const baseUrl = await this.resolveImageBaseUrl(params.request)
    return this.normalizeMessage(message, baseUrl)
  }

  private async resolveImageBaseUrl(request: Request): Promise<string> {
    const siteBaseSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'site_base_url' },
      select: { value: true },
    })
    return this.determineChatImageBaseUrl({
      request,
      siteBaseUrl: siteBaseSetting?.value ?? null,
    })
  }

  private normalizeMessage(raw: RawMessage, baseUrl: string): NormalizedMessage {
    const { attachments, toolLogsJson, usageMetrics, ...rest } = raw as RawMessage & {
      attachments?: Array<{ relativePath: string }>
      toolLogsJson?: string | null
      usageMetrics?: Array<{
        promptTokens: number
        completionTokens: number
        totalTokens: number
        firstTokenLatencyMs: number | null
        responseTimeMs: number | null
        tokensPerSecond: number | null
      }>
    }
    const usage = Array.isArray(usageMetrics) && usageMetrics.length > 0 ? usageMetrics[0] : null
    const rel = Array.isArray(attachments) ? attachments.map((att) => att.relativePath) : []
    return {
      ...rest,
      images: this.resolveChatImageUrls(rel, baseUrl),
      toolEvents: this.parseToolLogsJson(toolLogsJson),
      metrics: usage
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            firstTokenLatencyMs: usage.firstTokenLatencyMs,
            responseTimeMs: usage.responseTimeMs,
            tokensPerSecond: usage.tokensPerSecond,
          }
        : null,
    }
  }
}

let chatMessageQueryService = new ChatMessageQueryService()

export const setChatMessageQueryService = (service: ChatMessageQueryService) => {
  chatMessageQueryService = service
}

export { chatMessageQueryService }

export { messageSelectFields }
