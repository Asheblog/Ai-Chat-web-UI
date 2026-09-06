import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import type { Actor, RichMessagePayload } from '../../../types'
import {
  determineChatImageBaseUrl as defaultDetermineChatImageBaseUrl,
  resolveChatImageUrls as defaultResolveChatImageUrls,
} from '../../../utils/chat-images'
import {
  parseToolLogsJson as defaultParseToolLogsJson,
  projectToolEventsForHistoryList,
  type ToolLogEntry,
} from '../tool-logs'
import { buildRichMessagePayload, type GeneratedImageRecord } from '../../../services/chat/rich-payload-builder'
import { sessionOwnershipClause } from '../chat-common'

const generatedImageSelectFields = {
  url: true,
  storagePath: true,
  mime: true,
  width: true,
  height: true,
  revisedPrompt: true,
} as const

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
  generatedImages: {
    select: {
      ...generatedImageSelectFields,
      base64: true,
    },
  },
  clientMessageId: true,
  reasoning: true,
  reasoningDurationSeconds: true,
  toolLogsJson: true,
  imageDescriptionsJson: true,
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

/** 历史列表不选 base64，避免 legacy 大字段进入分页响应。 */
const messageListSelectFields = {
  ...messageSelectFields,
  generatedImages: {
    select: {
      ...generatedImageSelectFields,
    },
  },
} as const

const SITE_BASE_URL_CACHE_TTL_MS = 60_000
let siteBaseUrlCache: { value: string | null; expiresAt: number } | null = null

export const invalidateSiteBaseUrlCache = () => {
  siteBaseUrlCache = null
}

type RawMessage = {
  id: number
  sessionId: number
  messageGroupId?: number | null
  role: string
  content: string
  parentMessageId?: number | null
  variantIndex?: number | null
  attachments?: Array<{ relativePath: string }>
  generatedImages?: GeneratedImageRecord[]
  clientMessageId?: string | null
  reasoning?: string | null
  reasoningDurationSeconds?: number | null
  toolLogsJson?: string | null
  imageDescriptionsJson?: string | null
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
  imageDescriptions?: Array<{ description: string; modelRawId: string }> | null
  richPayload?: RichMessagePayload | null
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

    // summary 过滤放在内存：Prisma SQLite 对 NOT [{ summary: null }, { summary: "" }] 会校验失败
    const [ungroupedCount, groups] = await Promise.all([
      (this.prisma as any).message.count({
        where: {
          sessionId: params.sessionId,
          messageGroupId: null,
        },
      }) as Promise<number>,
      (this.prisma as any).messageGroup.findMany({
        where: {
          sessionId: params.sessionId,
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

    const validGroups = groups.filter((group) => Boolean(group.summary?.trim()))
    const total = Number(ungroupedCount || 0) + validGroups.length
    const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 1
    const requestedPage = params.page === 'latest' ? totalPages : params.page
    const page = Math.max(1, Math.min(requestedPage, totalPages))
    const start = (page - 1) * safeLimit
    const end = Math.min(start + safeLimit, total)

    if (total === 0 || start >= total) {
      return {
        messages: [],
        pagination: {
          page,
          limit: safeLimit,
          total,
          totalPages,
        },
      }
    }

    const timeline = await this.buildPagedSessionTimeline({
      sessionId: params.sessionId,
      baseUrl,
      start,
      end,
      total,
      groups: validGroups,
    })

    return {
      messages: timeline,
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

  /**
   * 分页构建时间线：不解压组内消息全量；只按未分组消息做 orderBy+take，
   * 再与全部压缩组合并切片。保证长会话不再全表 load 消息进内存。
   *
   * 不变量：完整时间线 = 未分组消息 + 有效压缩组（各组 1 项）。
   * 取最新/最旧窗口时，取对应方向的 N 条未分组消息 ∪ 全部组，足以覆盖该页。
   */
  private async buildPagedSessionTimeline(params: {
    sessionId: number
    baseUrl: string
    start: number
    end: number
    total: number
    groups: MessageGroupRecord[]
  }): Promise<NormalizedMessage[]> {
    const pageSize = Math.max(0, params.end - params.start)
    if (pageSize === 0) return []

    const fromStartDistance = params.end
    const fromEndDistance = params.total - params.start
    const useFromEnd = fromEndDistance <= fromStartDistance
    const windowSize = useFromEnd ? fromEndDistance : fromStartDistance

    const ungroupedMessages = (await (this.prisma as any).message.findMany({
      where: {
        sessionId: params.sessionId,
        messageGroupId: null,
      },
      select: messageListSelectFields,
      orderBy: useFromEnd
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'asc' }, { id: 'asc' }],
      take: windowSize,
    })) as RawMessage[]

    if (useFromEnd) {
      ungroupedMessages.reverse()
    }

    const groupItems = params.groups
      .map((group) => this.normalizeCompressedGroup(group))
      .filter((item): item is NormalizedMessage => item != null)

    const messageItems = ungroupedMessages.map((message) =>
      this.projectMessageForHistoryList(
        this.normalizeMessage(message, params.baseUrl, { toolLogsMode: 'history-list' }),
      ),
    )

    const merged = [...messageItems, ...groupItems].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return String(a.id).localeCompare(String(b.id))
    })

    if (useFromEnd) {
      // merged 含「最近 windowSize 条未分组 + 全部组」，取末尾 windowSize 即为该尾部窗口
      const window = merged.slice(-windowSize)
      // 窗口对应 full timeline [total-windowSize, total)；页在其中的偏移为 start - (total-windowSize)
      const offsetInWindow = params.start - (params.total - windowSize)
      return window.slice(offsetInWindow, offsetInWindow + pageSize)
    }

    // 从头窗口：取前 windowSize(=end) 项后切 [start, end)
    return merged.slice(0, windowSize).slice(params.start, params.end)
  }

  private normalizeCompressedGroup(
    group: MessageGroupRecord,
  ): NormalizedMessage | null {
    if (!group.summary || !group.summary.trim()) return null
    const snapshot = this.parseCompressedMessages(group.compressedMessagesJson)
    const lastSnapshot = snapshot.length > 0 ? snapshot[snapshot.length - 1] : null
    const createdAtFromSnapshot =
      lastSnapshot?.createdAt && !Number.isNaN(Date.parse(lastSnapshot.createdAt))
        ? new Date(lastSnapshot.createdAt)
        : null
    const createdAt = createdAtFromSnapshot ?? group.createdAt
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
      lastMessageId: group.lastMessageId ?? lastSnapshot?.id ?? null,
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
    const now = Date.now()
    let siteBaseUrl: string | null
    if (siteBaseUrlCache && siteBaseUrlCache.expiresAt > now) {
      siteBaseUrl = siteBaseUrlCache.value
    } else {
      const siteBaseSetting = await this.prisma.systemSetting.findUnique({
        where: { key: 'site_base_url' },
        select: { value: true },
      })
      siteBaseUrl = siteBaseSetting?.value ?? null
      siteBaseUrlCache = {
        value: siteBaseUrl,
        expiresAt: now + SITE_BASE_URL_CACHE_TTL_MS,
      }
    }
    return this.determineChatImageBaseUrl({
      request,
      siteBaseUrl,
    })
  }

  /** 列表页投影：richPayload 已由附件/生图构建，再瘦身 toolEvents。 */
  private projectMessageForHistoryList(message: NormalizedMessage): NormalizedMessage {
    if (!Array.isArray(message.toolEvents) || message.toolEvents.length === 0) {
      return message
    }
    return {
      ...message,
      toolEvents: projectToolEventsForHistoryList(message.toolEvents),
    }
  }

  private normalizeMessage(
    raw: RawMessage,
    baseUrl: string,
    options?: { toolLogsMode?: 'full' | 'history-list' },
  ): NormalizedMessage {
    const { attachments, toolLogsJson, usageMetrics, imageDescriptionsJson } = raw as RawMessage & {
      attachments?: Array<{ relativePath: string }>
      generatedImages?: GeneratedImageRecord[]
      toolLogsJson?: string | null
      usageMetrics?: Array<{
        promptTokens: number
        completionTokens: number
        totalTokens: number
        firstTokenLatencyMs: number | null
        responseTimeMs: number | null
        tokensPerSecond: number | null
      }>
      imageDescriptionsJson?: string | null
    }
    const usage = Array.isArray(usageMetrics) && usageMetrics.length > 0 ? usageMetrics[0] : null
    const rel = Array.isArray(attachments) ? attachments.map((att) => att.relativePath) : []
    const toolEvents = this.parseToolLogsJson(toolLogsJson, {
      mode: options?.toolLogsMode === 'history-list' ? 'history-list' : 'full',
    })
    const richPayload = buildRichMessagePayload({
      content: raw.content,
      attachmentRelativePaths: rel,
      generatedImages: Array.isArray(raw.generatedImages) ? raw.generatedImages : [],
      baseUrl,
      resolveChatImageUrls: this.resolveChatImageUrls,
    })
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
      imageDescriptions: (() => {
        if (!imageDescriptionsJson) return null
        try {
          const parsed = JSON.parse(imageDescriptionsJson)
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
        } catch {
          return null
        }
      })(),
      richPayload,
      toolEvents,
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

export { messageSelectFields, messageListSelectFields }
