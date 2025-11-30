import crypto from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import {
  determineChatImageBaseUrl as defaultDetermineChatImageBaseUrl,
  resolveChatImageUrls,
} from '../../utils/chat-images'

export class ShareServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ShareServiceError'
    this.statusCode = statusCode
  }
}

const MAX_MESSAGES_PER_SHARE = 50

const buildSessionOwnershipWhere = (actor: Actor): Prisma.ChatSessionWhereInput =>
  actor.type === 'user'
    ? { userId: actor.id }
    : { anonymousKey: actor.key }

export interface ShareMessageSnapshot {
  id: number
  role: 'user' | 'assistant'
  content: string
  reasoning?: string | null
  createdAt: string
  images?: string[]
}

export interface ShareDetail {
  id: number
  sessionId: number
  token: string
  title: string
  sessionTitle: string
  messageCount: number
  messages: ShareMessageSnapshot[]
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface ShareSummary {
  id: number
  sessionId: number
  token: string
  title: string
  sessionTitle: string
  messageCount: number
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface ShareListResult {
  shares: ShareSummary[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

type SharePayload = {
  sessionTitle: string
  messages: ShareMessageSnapshot[]
}

export interface ShareServiceDeps {
  prisma?: PrismaClient
  logger?: Pick<typeof console, 'error' | 'warn'>
  determineChatImageBaseUrl?: typeof defaultDetermineChatImageBaseUrl
}

const messageSelect = {
  id: true,
  sessionId: true,
  role: true,
  content: true,
  reasoning: true,
  createdAt: true,
  attachments: {
    select: {
      relativePath: true,
    },
  },
} satisfies Prisma.MessageSelect

type MessageRecord = Prisma.MessageGetPayload<{ select: typeof messageSelect }>
type ShareRecordWithSession = Prisma.ChatShareGetPayload<{
  include: { session: { select: { title: true } } }
}>

export class ShareService {
  private prisma: PrismaClient
  private logger: Pick<typeof console, 'error' | 'warn'>
  private determineChatImageBaseUrl: typeof defaultDetermineChatImageBaseUrl

  constructor(deps: ShareServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.logger = deps.logger ?? console
    this.determineChatImageBaseUrl =
      deps.determineChatImageBaseUrl ?? defaultDetermineChatImageBaseUrl
  }

  async createShare(
    actor: Actor,
    params: {
      sessionId: number
      messageIds: number[]
      title?: string | null
      expiresInHours?: number | null
    },
    options?: { request?: Request },
  ): Promise<ShareDetail> {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: params.sessionId,
        ...buildSessionOwnershipWhere(actor),
      },
      select: {
        id: true,
        title: true,
      },
    })

    if (!session) {
      throw new ShareServiceError('Chat session not found', 404)
    }

    const normalizedIds = this.normalizeMessageIds(params.messageIds)
    if (normalizedIds.length === 0) {
      throw new ShareServiceError('At least one message must be selected')
    }

    if (normalizedIds.length > MAX_MESSAGES_PER_SHARE) {
      throw new ShareServiceError(`You can share up to ${MAX_MESSAGES_PER_SHARE} messages at once`)
    }

    const messages = await this.prisma.message.findMany({
      where: {
        sessionId: session.id,
        id: { in: normalizedIds },
      },
      select: messageSelect,
    })

    if (messages.length !== normalizedIds.length) {
      throw new ShareServiceError('Some messages were not found in this session')
    }

    const siteBaseSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'site_base_url' },
      select: { value: true },
    })
    const baseUrl = options?.request
      ? this.determineChatImageBaseUrl({
          request: options.request,
          siteBaseUrl: siteBaseSetting?.value ?? null,
        })
      : ''

    const snapshots = this.buildMessageSnapshots(messages, normalizedIds, baseUrl)
    const expiresAt = this.computeExpiry(params.expiresInHours)
    const token = await this.generateToken()
    const resolvedTitle = this.resolveTitle(params.title, session.title)

    const payload: SharePayload = {
      sessionTitle: session.title,
      messages: snapshots,
    }

    const record = await this.prisma.chatShare.create({
      data: {
        sessionId: session.id,
        token,
        title: resolvedTitle,
        messageIdsJson: JSON.stringify(normalizedIds),
        payloadJson: JSON.stringify(payload),
        createdByUserId: actor.type === 'user' ? actor.id : null,
        createdByAnonymousKey: actor.type === 'anonymous' ? actor.key : null,
        expiresAt,
      },
    })

    return {
      id: record.id,
      sessionId: session.id,
      token,
      title: resolvedTitle,
      sessionTitle: session.title,
      messages: snapshots,
      messageCount: snapshots.length,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    }
  }

  async listShares(
    actor: Actor,
    params: {
      sessionId?: number
      status?: 'active' | 'all'
      page?: number
      limit?: number
    } = {},
  ): Promise<ShareListResult> {
    const { page, limit } = this.normalizePagination(params)
    const now = new Date()
    const where: Prisma.ChatShareWhereInput = {
      session: buildSessionOwnershipWhere(actor),
    }
    if (params.sessionId) {
      where.sessionId = params.sessionId
    }
    if (params.status !== 'all') {
      where.revokedAt = null
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }]
    }

    const [records, total] = await Promise.all([
      this.prisma.chatShare.findMany({
        where,
        include: { session: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatShare.count({ where }),
    ])

    return {
      shares: records.map((record) => this.mapShareSummary(record)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async updateShare(
    actor: Actor,
    shareId: number,
    payload: { title?: string; expiresInHours?: number | null },
  ): Promise<ShareSummary> {
    const existing = await this.findShareForActor(actor, shareId)
    const updates: Prisma.ChatShareUpdateInput = {}

    if (typeof payload.title === 'string') {
      updates.title = this.resolveTitle(payload.title, existing.session.title)
    }
    if (payload.hasOwnProperty('expiresInHours')) {
      if (payload.expiresInHours === null) {
        updates.expiresAt = null
      } else {
        const nextExpiry = this.computeExpiry(payload.expiresInHours)
        updates.expiresAt = nextExpiry
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.mapShareSummary(existing)
    }

    const updated = await this.prisma.chatShare.update({
      where: { id: existing.id },
      data: updates,
      include: { session: { select: { title: true } } },
    })

    return this.mapShareSummary(updated)
  }

  async revokeShare(actor: Actor, shareId: number): Promise<ShareSummary> {
    await this.findShareForActor(actor, shareId)
    const updated = await this.prisma.chatShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
      include: { session: { select: { title: true } } },
    })
    return this.mapShareSummary(updated)
  }

  async getShareByToken(token: string): Promise<ShareDetail | null> {
    if (!token || token.trim().length === 0) {
      return null
    }
    const record = await this.prisma.chatShare.findFirst({
      where: {
        token,
      },
    })
    if (!record) return null
    if (record.revokedAt) return null
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      return null
    }
    let payload: SharePayload | null = null
    try {
      payload = JSON.parse(record.payloadJson) as SharePayload
    } catch (error) {
      this.logger.error?.('[ShareService] Failed to parse payloadJson', { id: record.id, error })
      return null
    }
    if (!payload) return null
    return {
      id: record.id,
      sessionId: record.sessionId,
      token: record.token,
      title: record.title,
      sessionTitle: payload.sessionTitle || record.title,
      messages: payload.messages || [],
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    }
  }

  private normalizeMessageIds(messageIds: number[]): number[] {
    const numbers = messageIds
      .map((id) => (typeof id === 'number' ? Math.trunc(id) : Number.NaN))
      .filter((id) => Number.isFinite(id) && id > 0)
    const unique = Array.from(new Set(numbers))
    return unique
  }

  private resolveTitle(customTitle: string | null | undefined, fallback: string): string {
    const source = (customTitle ?? '').trim() || fallback || 'Shared Chat'
    return source.length > 200 ? source.slice(0, 200) : source
  }

  private buildMessageSnapshots(
    messages: MessageRecord[],
    desiredOrder: number[],
    baseUrl: string,
  ): ShareMessageSnapshot[] {
    const orderMap = new Map<number, number>()
    desiredOrder.forEach((id, index) => orderMap.set(id, index))
    const withOrder = messages
      .filter((msg): msg is MessageRecord & { order: number } => {
        const order = orderMap.get(msg.id)
        return typeof order === 'number'
      })
      .map((msg) => ({
        ...msg,
        order: orderMap.get(msg.id) ?? 0,
      }))
      .sort((a, b) => a.order - b.order)

    return withOrder.map((msg) => {
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
      const images = resolveChatImageUrls(
        attachments.map((att) => att.relativePath),
        baseUrl,
      )
      return {
        id: msg.id,
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
        reasoning: msg.reasoning,
        createdAt: msg.createdAt.toISOString(),
        images: images.length > 0 ? images : undefined,
      }
    })
  }

  private computeExpiry(expiresInHours?: number | null): Date | null {
    if (typeof expiresInHours !== 'number' || !Number.isFinite(expiresInHours)) {
      return null
    }
    const clamped = Math.max(1, Math.min(expiresInHours, 24 * 30))
    const now = Date.now()
    return new Date(now + clamped * 60 * 60 * 1000)
  }

  private parseMessageIds(json: string | null): number[] {
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) {
        return parsed
          .map((id) => (typeof id === 'number' ? Math.trunc(id) : Number.NaN))
          .filter((id) => Number.isFinite(id) && id > 0)
      }
    } catch {
      // ignore malformed payloads
    }
    return []
  }

  private mapShareSummary(record: ShareRecordWithSession): ShareSummary {
    const messageIds = this.parseMessageIds(record.messageIdsJson)
    return {
      id: record.id,
      sessionId: record.sessionId,
      token: record.token,
      title: record.title,
      sessionTitle: record.session?.title || '未命名对话',
      messageCount: messageIds.length,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    }
  }

  private async findShareForActor(actor: Actor, shareId: number): Promise<ShareRecordWithSession> {
    const record = await this.prisma.chatShare.findFirst({
      where: {
        id: shareId,
        session: buildSessionOwnershipWhere(actor),
      },
      include: { session: { select: { title: true } } },
    })
    if (!record) {
      throw new ShareServiceError('Share link not found', 404)
    }
    return record
  }

  private normalizePagination(params?: { page?: number; limit?: number }) {
    const page = typeof params?.page === 'number' && params.page > 0 ? Math.trunc(params.page) : 1
    const limit =
      typeof params?.limit === 'number' && params.limit > 0 ? Math.min(Math.trunc(params.limit), 100) : 20
    return { page, limit }
  }

  private async generateToken(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex')
      const existing = await this.prisma.chatShare.findFirst({ where: { token } })
      if (!existing) {
        return token
      }
    }
    throw new ShareServiceError('Failed to generate share token', 500)
  }
}

let shareService = new ShareService()

export const setShareService = (service: ShareService) => {
  shareService = service
}

export { shareService }
