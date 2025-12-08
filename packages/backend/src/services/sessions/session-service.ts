import type { Prisma, PrismaClient } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import { ensureAnonymousSession as defaultEnsureAnonymousSession } from '../../utils/actor'
import type { ModelResolverService } from '../catalog/model-resolver-service'
import { modelResolverService as defaultModelResolverService } from '../catalog/model-resolver-service'

export class SessionServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'SessionServiceError'
    this.statusCode = statusCode
  }
}

export interface SessionServiceDeps {
  prisma?: PrismaClient
  ensureAnonymousSession?: typeof defaultEnsureAnonymousSession
  modelResolverService?: ModelResolverService
  logger?: Pick<typeof console, 'error' | 'warn'>
}

const sessionSelect = {
  id: true,
  userId: true,
  anonymousKey: true,
  expiresAt: true,
  connectionId: true,
  modelRawId: true,
  title: true,
  createdAt: true,
  pinnedAt: true,
  reasoningEnabled: true,
  reasoningEffort: true,
  ollamaThink: true,
  systemPrompt: true,
  connection: {
    select: { id: true, provider: true, baseUrl: true, prefixId: true },
  },
  _count: {
    select: {
      messages: true,
    },
  },
} satisfies Prisma.ChatSessionSelect

const detailSelect = {
  ...sessionSelect,
  messages: {
    select: {
      id: true,
      sessionId: true,
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ChatSessionSelect

const composeModelLabel = (
  rawId?: string | null,
  prefix?: string | null,
  fallback?: string | null,
): string | null => {
  const cleanRaw = (rawId || '').trim()
  const cleanPrefix = (prefix || '').trim()
  if (cleanRaw && cleanPrefix) return `${cleanPrefix}.${cleanRaw}`
  if (cleanRaw) return cleanRaw
  return fallback || null
}

const normalizeEffort = (value?: string | null) => {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return null
}

const sessionOwnershipClause = (actor: Actor) =>
  actor.type === 'user' ? { userId: actor.id } : { anonymousKey: actor.key }

interface PaginationParams {
  page: number
  limit: number
}

type SessionListItem = Prisma.ChatSessionGetPayload<{ select: typeof sessionSelect }>
type SessionDetail = Prisma.ChatSessionGetPayload<{ select: typeof detailSelect }>

export class SessionService {
  private prisma: PrismaClient
  private ensureAnonymousSession: typeof defaultEnsureAnonymousSession
  private modelResolverService: ModelResolverService
  private logger: Pick<typeof console, 'error' | 'warn'>

  constructor(deps: SessionServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.ensureAnonymousSession = deps.ensureAnonymousSession ?? defaultEnsureAnonymousSession
    this.modelResolverService = deps.modelResolverService ?? defaultModelResolverService
    this.logger = deps.logger ?? console
  }

  async listSessions(actor: Actor, pagination: PaginationParams) {
    const { page, limit } = this.normalizePagination(pagination)
    const where = sessionOwnershipClause(actor)
    const [sessions, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where,
        select: sessionSelect,
        orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatSession.count({ where }),
    ])

    return {
      sessions: sessions.map((s) => ({
        ...s,
        reasoningEffort: normalizeEffort(s.reasoningEffort),
        modelLabel: composeModelLabel(s.modelRawId, s.connection?.prefixId || null) || undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async createSession(
    actor: Actor,
    payload: {
      modelId: string
      title?: string
      connectionId?: number
      rawId?: string
      reasoningEnabled?: boolean
      reasoningEffort?: string
      ollamaThink?: boolean
      systemPrompt?: string | null
    },
  ) {
    const resolution = await this.resolveModelSelection(actor, payload)

    const anonymousContext =
      actor.type === 'anonymous' ? await this.ensureAnonymousSession(actor) : null

    const session = await this.prisma.chatSession.create({
      data: {
        ...(actor.type === 'user' ? { userId: actor.id } : {}),
        ...(actor.type === 'anonymous'
          ? {
              anonymousKey: anonymousContext?.anonymousKey ?? actor.key,
              expiresAt: anonymousContext?.expiresAt ?? null,
            }
          : {}),
        connectionId: resolution.connection.id,
        modelRawId: resolution.rawModelId,
        title: payload.title || 'New Chat',
        reasoningEnabled: payload.reasoningEnabled,
        reasoningEffort: payload.reasoningEffort,
        ollamaThink: payload.ollamaThink,
        systemPrompt: payload.systemPrompt,
      },
      select: sessionSelect,
    })

    if (actor.type === 'user') {
      await this.persistPreferredModel(actor.id, payload.modelId, resolution).catch((error) => {
        this.logger.warn?.('Failed to persist preferred model on session create', {
          userId: actor.id,
          error,
        })
      })
    }

    return {
      ...session,
      modelLabel:
        payload.modelId || composeModelLabel(session.modelRawId, session.connection?.prefixId || null),
    }
  }

  async getSession(actor: Actor, sessionId: number) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, ...sessionOwnershipClause(actor) },
      select: detailSelect,
    })

    if (!session) {
      throw new SessionServiceError('Chat session not found', 404)
    }

    return {
      ...session,
      modelLabel: composeModelLabel(session.modelRawId, session.connection?.prefixId || null),
    }
  }

  async updateSession(
    actor: Actor,
    sessionId: number,
    updates: {
      title?: string
      pinned?: boolean
      reasoningEnabled?: boolean
      reasoningEffort?: string
      ollamaThink?: boolean
      systemPrompt?: string | null
    },
  ) {
    const existing = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, ...sessionOwnershipClause(actor) },
    })

    if (!existing) {
      throw new SessionServiceError('Chat session not found', 404)
    }

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(typeof updates.title === 'string' ? { title: updates.title } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'pinned')
          ? { pinnedAt: updates.pinned ? new Date() : null }
          : {}),
        ...(typeof updates.reasoningEnabled === 'boolean'
          ? { reasoningEnabled: updates.reasoningEnabled }
          : {}),
        ...(typeof updates.reasoningEffort === 'string'
          ? { reasoningEffort: updates.reasoningEffort }
          : {}),
        ...(typeof updates.ollamaThink === 'boolean' ? { ollamaThink: updates.ollamaThink } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'systemPrompt')
          ? { systemPrompt: updates.systemPrompt ?? null }
          : {}),
      },
      select: sessionSelect,
    })

    return updated
  }

  async switchSessionModel(
    actor: Actor,
    sessionId: number,
    payload: { modelId: string; connectionId?: number; rawId?: string },
  ) {
    const existing = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, ...sessionOwnershipClause(actor) },
    })

    if (!existing) {
      throw new SessionServiceError('Chat session not found', 404)
    }

    const resolution = await this.resolveModelSelection(actor, payload)

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        connectionId: resolution.connection.id,
        modelRawId: resolution.rawModelId,
      },
      select: sessionSelect,
    })

    if (actor.type === 'user') {
      await this.persistPreferredModel(actor.id, payload.modelId, resolution).catch((error) => {
        this.logger.warn?.('Failed to persist preferred model on switch', {
          userId: actor.id,
          error,
        })
      })
    }

    return {
      ...updated,
      modelLabel: payload.modelId,
    }
  }

  async deleteSession(actor: Actor, sessionId: number) {
    const existing = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, ...sessionOwnershipClause(actor) },
    })
    if (!existing) {
      throw new SessionServiceError('Chat session not found', 404)
    }
    await this.prisma.chatSession.delete({ where: { id: sessionId } })
  }

  async clearSessionMessages(actor: Actor, sessionId: number) {
    const existing = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, ...sessionOwnershipClause(actor) },
    })
    if (!existing) {
      throw new SessionServiceError('Chat session not found', 404)
    }
    await this.prisma.message.deleteMany({ where: { sessionId } })
  }

  private normalizePagination(pagination: PaginationParams): PaginationParams {
    const page = Number.isFinite(pagination.page) && pagination.page > 0 ? Math.floor(pagination.page) : 1
    const limit =
      Number.isFinite(pagination.limit) && pagination.limit > 0 ? Math.min(Math.floor(pagination.limit), 200) : 20
    return { page, limit }
  }

  private async persistPreferredModel(
    userId: number,
    modelId: string,
    resolution: { connection: Prisma.ConnectionGetPayload<true>; rawModelId: string },
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferredModelId: modelId,
        preferredConnectionId: resolution.connection.id,
        preferredModelRawId: resolution.rawModelId,
      },
    })
  }

  private async resolveModelSelection(
    actor: Actor,
    payload: {
      modelId: string
      connectionId?: number
      rawId?: string
    },
  ): Promise<{ connection: Prisma.ConnectionGetPayload<true>; rawModelId: string }> {
    const resolution = await this.modelResolverService.resolveModelForRequest({
      actor,
      userId: actor.type === 'user' ? actor.id : null,
      modelId: payload.modelId,
      connectionId: payload.connectionId,
      rawId: payload.rawId,
    })

    if (!resolution) {
      if (payload.connectionId) {
        throw new SessionServiceError('Invalid connectionId for current user', 400)
      }
      throw new SessionServiceError('Model not found in connections', 400)
    }

    return resolution
  }
}

let sessionService = new SessionService()

export const setSessionService = (service: SessionService) => {
  sessionService = service
}

export { sessionService }
