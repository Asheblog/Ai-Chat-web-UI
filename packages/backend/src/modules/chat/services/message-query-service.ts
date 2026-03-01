import type { PrismaClient } from '@prisma/client'
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
  messageGroupId: true,
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

type RawMessage = {
  id: number
  sessionId: number
  messageGroupId?: number | null
  role: string
  content: string
  parentMessageId?: number | null
  variantIndex?: number | null
  attachments?: Array<{ relativePath: string }>
  clientMessageId?: string | null
  reasoning?: string | null
  reasoningDurationSeconds?: number | null
  toolLogsJson?: string | null
  createdAt: Date
  updatedAt: Date
  streamStatus?: string | null
  streamCursor?: number | null
  streamReasoning?: string | null
  streamError?: string | null
  usageMetrics?: Array<{
    promptTokens: number
    completionTokens: number
    totalTokens: number
    firstTokenLatencyMs: number | null
    responseTimeMs: number | null
    tokensPerSecond: number | null
    createdAt: Date
  }>
}

export interface CompressedGroupSnapshotItem {
  id: number
  role: string
  content: string
  createdAt: string
}

export interface NormalizedMessage {
  id: number | string
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
  messageGroupId?: number | null
  compressedMessages?: CompressedGroupSnapshotItem[]
  lastMessageId?: number | null
  expanded?: boolean
  metadata?: Record<string, unknown> | null
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

type MessageGroupRecord = {
  id: number
  sessionId: number
  summary: string
  compressedMessagesJson: string
  lastMessageId: number | null
  expanded: boolean
  metadataJson: string | null
  createdAt: Date
  updatedAt: Date
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
    page: number | 'latest'
    limit: number
    request: Request
  }): Promise<ListMessagesResult> {
    const safeLimit = Math.max(1, Math.min(params.limit, 200))
    const baseUrl = await this.resolveImageBaseUrl(params.request)
    const timeline = await this.buildSessionTimeline(params.sessionId, baseUrl)

    const total = timeline.length
    const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 1
    const requestedPage = params.page === 'latest' ? totalPages : params.page
    const page = Math.max(1, Math.min(requestedPage, totalPages))
    const start = (page - 1) * safeLimit
    const end = start + safeLimit

    return {
      messages: timeline.slice(start, end),
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages,
      },
    }
  }

  async getMessageById(params: {
    actor: Actor
    sessionId: number
    messageId: number
    request: Request
  }): Promise<NormalizedMessage | null> {
    const message = (await (this.prisma as any).message.findFirst({
      where: {
        id: params.messageId,
        sessionId: params.sessionId,
        session: sessionOwnershipClause(params.actor),
      },
      select: messageSelectFields,
    })) as RawMessage | null

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
    const message = (await (this.prisma as any).message.findFirst({
      where: {
        sessionId: params.sessionId,
        clientMessageId: params.clientMessageId,
        session: sessionOwnershipClause(params.actor),
      },
      select: messageSelectFields,
    })) as RawMessage | null

    if (!message) return null
    const baseUrl = await this.resolveImageBaseUrl(params.request)
    return this.normalizeMessage(message, baseUrl)
  }

  private async buildSessionTimeline(sessionId: number, baseUrl: string): Promise<NormalizedMessage[]> {
    const [messages, groups] = await Promise.all([
      ((this.prisma as any).message.findMany({
        where: { sessionId },
        select: messageSelectFields,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }) as Promise<RawMessage[]>),
      (this.prisma as any).messageGroup.findMany({
        where: {
          sessionId,
          cancelledAt: null,
        },
        select: {
          id: true,
          sessionId: true,
          summary: true,
          compressedMessagesJson: true,
          lastMessageId: true,
          expanded: true,
          metadataJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }) as Promise<MessageGroupRecord[]>,
    ])

    const groupById = new Map(groups.map((group) => [group.id, group]))
    const groupedMessages = new Map<number, RawMessage[]>()
    const timeline: NormalizedMessage[] = []

    for (const message of messages) {
      const groupIdRaw = (message as any).messageGroupId
      const groupId = typeof groupIdRaw === 'number' ? groupIdRaw : null
      if (groupId != null && groupById.has(groupId)) {
        const list = groupedMessages.get(groupId) ?? []
        list.push(message)
        groupedMessages.set(groupId, list)
        continue
      }
      timeline.push(this.normalizeMessage(message, baseUrl))
    }

    for (const [groupId, rows] of groupedMessages.entries()) {
      const group = groupById.get(groupId)
      if (!group) continue
      const normalized = this.normalizeCompressedGroup(group, rows)
      if (normalized) {
        timeline.push(normalized)
      }
    }

    return timeline.sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return String(a.id).localeCompare(String(b.id))
    })
  }

  private normalizeCompressedGroup(
    group: MessageGroupRecord,
    rows: RawMessage[],
  ): NormalizedMessage | null {
    if (!group.summary || !group.summary.trim()) return null
    const sorted = rows.slice().sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id - b.id
    })
    const fallbackLast = sorted[sorted.length - 1]
    const createdAt = fallbackLast?.createdAt ?? group.createdAt
    const snapshot = this.parseCompressedMessages(group.compressedMessagesJson)
    const metadata = this.parseJsonObject(group.metadataJson)
    return {
      id: `group:${group.id}`,
      sessionId: group.sessionId,
      role: 'compressedGroup',
      content: group.summary,
      parentMessageId: null,
      variantIndex: null,
      clientMessageId: null,
      reasoning: null,
      reasoningDurationSeconds: null,
      createdAt,
      updatedAt: group.updatedAt,
      streamStatus: null,
      streamCursor: null,
      streamReasoning: null,
      streamError: null,
      images: [],
      toolEvents: [],
      metrics: null,
      messageGroupId: group.id,
      compressedMessages: snapshot,
      lastMessageId: group.lastMessageId ?? fallbackLast?.id ?? null,
      expanded: Boolean(group.expanded),
      metadata,
    }
  }

  private parseCompressedMessages(raw: string): CompressedGroupSnapshotItem[] {
    if (!raw || typeof raw !== 'string') return []
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => {
          const id = Number((item as any)?.id)
          const role = String((item as any)?.role || '')
          const content = String((item as any)?.content || '')
          const createdAt = String((item as any)?.createdAt || '')
          if (!Number.isFinite(id) || !role) return null
          return { id, role, content, createdAt }
        })
        .filter((item): item is CompressedGroupSnapshotItem => item != null)
    } catch {
      return []
    }
  }

  private parseJsonObject(raw?: string | null): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'string') return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {}
    return null
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
    const { attachments, toolLogsJson, usageMetrics } = raw as RawMessage & {
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
      id: raw.id,
      sessionId: raw.sessionId,
      role: raw.role,
      content: raw.content,
      parentMessageId: raw.parentMessageId ?? null,
      variantIndex: raw.variantIndex ?? null,
      clientMessageId: raw.clientMessageId ?? null,
      reasoning: raw.reasoning ?? null,
      reasoningDurationSeconds: raw.reasoningDurationSeconds ?? null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      streamStatus: raw.streamStatus ?? null,
      streamCursor: raw.streamCursor ?? null,
      streamReasoning: raw.streamReasoning ?? null,
      streamError: raw.streamError ?? null,
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
      messageGroupId: typeof raw.messageGroupId === 'number' ? raw.messageGroupId : null,
    }
  }
}

let chatMessageQueryService = new ChatMessageQueryService()

export const setChatMessageQueryService = (service: ChatMessageQueryService) => {
  chatMessageQueryService = service
}

export { chatMessageQueryService }

export { messageSelectFields }
