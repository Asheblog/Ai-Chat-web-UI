import type { Prisma, PrismaClient } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'

export class ChatServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ChatServiceError'
    this.statusCode = statusCode
  }
}

export interface ChatServiceDeps {
  prisma?: PrismaClient
  logger?: Pick<typeof console, 'warn' | 'error'>
}

type SessionWithConnection = Prisma.ChatSessionGetPayload<{ include: { connection: true } }>

const buildSessionOwnershipWhere = (actor: Actor): Prisma.ChatSessionWhereInput =>
  actor.type === 'user'
    ? { userId: actor.id }
    : { anonymousKey: actor.key }

export class ChatService {
  private prisma: PrismaClient
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: ChatServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.logger = deps.logger ?? console
  }

  async findSessionWithConnection(actor: Actor, sessionId: number): Promise<SessionWithConnection | null> {
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      this.logger.warn?.('[ChatService] Invalid session id provided', { sessionId })
      return null
    }
    return this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...buildSessionOwnershipWhere(actor),
      },
      include: {
        connection: true,
      },
    })
  }

  async getSessionWithConnection(actor: Actor, sessionId: number): Promise<SessionWithConnection> {
    const session = await this.findSessionWithConnection(actor, sessionId)
    if (!session) {
      throw new ChatServiceError('Chat session not found', 404)
    }
    if (!session.connectionId || !session.connection || !session.modelRawId) {
      throw new ChatServiceError('Session model not selected', 400)
    }
    return session
  }

  async ensureSessionAccess(actor: Actor, sessionId: number): Promise<{ id: number }> {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...buildSessionOwnershipWhere(actor),
      },
      select: {
        id: true,
      },
    })
    if (!session) {
      throw new ChatServiceError('Chat session not found', 404)
    }
    return session
  }
}

let chatService = new ChatService()

export const setChatService = (service: ChatService) => {
  chatService = service
}

export { chatService }
