import type { Message, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { persistChatImages as defaultPersistChatImages } from '../../utils/chat-images'

type IncomingImage = { data: string; mime: string }

export class OpenAICompatMessageServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'OpenAICompatMessageServiceError'
    this.statusCode = statusCode
  }
}

export interface OpenAICompatMessageServiceDeps {
  prisma?: PrismaClient
  persistChatImages?: typeof defaultPersistChatImages
  logger?: Pick<typeof console, 'warn' | 'error'>
}

export class OpenAICompatMessageService {
  private prisma: PrismaClient
  private persistChatImages: typeof defaultPersistChatImages
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: OpenAICompatMessageServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.persistChatImages = deps.persistChatImages ?? defaultPersistChatImages
    this.logger = deps.logger ?? console
  }

  async ensureSessionOwnedByUser(userId: number, sessionId: number): Promise<{ id: number }> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    })
    if (!session) {
      throw new OpenAICompatMessageServiceError('Session not found', 404)
    }
    return session
  }

  async listMessages(params: { sessionId: number; limit?: number }): Promise<Message[]> {
    const { sessionId, limit } = params
    const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    return this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      ...(hasLimit ? { take: Math.floor(limit) } : {}),
    })
  }

  async saveMessage(params: {
    sessionId: number
    role: Message['role']
    content: string
    clientMessageId?: string | null
    reasoning?: string
    reasoningDurationSeconds?: number
    images?: IncomingImage[]
    userId: number
  }): Promise<Message> {
    const {
      sessionId,
      role,
      content,
      clientMessageId,
      reasoning,
      reasoningDurationSeconds,
      images,
      userId,
    } = params

    const createData: Partial<Message> = {
      sessionId,
      role,
      content,
    }
    if (reasoning !== undefined) createData.reasoning = reasoning
    if (reasoningDurationSeconds !== undefined) {
      createData.reasoningDurationSeconds = reasoningDurationSeconds
    }

    let message: Message
    if (clientMessageId) {
      message = await this.prisma.message.upsert({
        where: {
          sessionId_clientMessageId: {
            sessionId,
            clientMessageId,
          },
        },
        update: {
          content,
          role,
          ...(reasoning !== undefined ? { reasoning } : {}),
          ...(reasoningDurationSeconds !== undefined
            ? { reasoningDurationSeconds }
            : {}),
        },
        create: {
          ...createData,
          clientMessageId,
        } as any,
      })
    } else {
      message = await this.prisma.message.create({
        data: createData as any,
      })
    }

    if (images && images.length > 0) {
      try {
        await this.persistChatImages(images, {
          sessionId,
          messageId: message.id,
          userId,
          clientMessageId: clientMessageId ?? undefined,
        })
      } catch (error) {
        this.logger.warn?.('[openai-compatible] persist images failed', {
          sessionId,
          messageId: message.id,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    return message
  }
}

export const openaiCompatMessageService = new OpenAICompatMessageService()
