import type { Message as PrismaMessage, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import type { Actor, UsageQuotaSnapshot } from '../../../types'
import { persistChatImages as defaultPersistChatImages } from '../../../utils/chat-images'
import {
  consumeActorQuota as defaultConsumeActorQuota,
  inspectActorQuota as defaultInspectActorQuota,
} from '../../../utils/quota'
import { MESSAGE_DEDUPE_WINDOW_MS, QuotaExceededError } from '../chat-common'

type IncomingImage = { data: string; mime: string }

export interface MessageServiceDeps {
  prisma: Pick<PrismaClient, '$transaction'>
  persistChatImages: typeof defaultPersistChatImages
  consumeActorQuota: typeof defaultConsumeActorQuota
  inspectActorQuota: typeof defaultInspectActorQuota
}

const baseDeps: MessageServiceDeps = {
  prisma: defaultPrisma,
  persistChatImages: defaultPersistChatImages,
  consumeActorQuota: defaultConsumeActorQuota,
  inspectActorQuota: defaultInspectActorQuota,
}

let deps: MessageServiceDeps = { ...baseDeps }

export const setMessageServiceDeps = (overrides: Partial<MessageServiceDeps>) => {
  const cleaned = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<MessageServiceDeps>
  deps = { ...deps, ...cleaned }
}

export const resetMessageServiceDeps = () => {
  deps = { ...baseDeps }
}

export interface CreateUserMessageOptions {
  actor: Actor
  sessionId: number
  content: string
  clientMessageId?: string | null
  images?: IncomingImage[]
  now?: Date
}

export interface CreateUserMessageResult {
  userMessage: PrismaMessage
  messageWasReused: boolean
  quotaSnapshot: UsageQuotaSnapshot | null
}

const normalizeClientMessageId = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const hasRecentDuplicate = (existing: PrismaMessage | null, now: Date) => {
  if (!existing) return false
  const createdAt = existing.createdAt instanceof Date
    ? existing.createdAt
    : new Date(existing.createdAt as unknown as string)
  return now.getTime() - createdAt.getTime() <= MESSAGE_DEDUPE_WINDOW_MS
}

export const createUserMessageWithQuota = async (
  options: CreateUserMessageOptions,
): Promise<CreateUserMessageResult> => {
  const { actor, sessionId, content, images } = options
  const now = options.now ?? new Date()
  const clientMessageId = normalizeClientMessageId(options.clientMessageId)

  let userMessageRecord: PrismaMessage | null = null
  let messageWasReused = false
  let quotaSnapshot: UsageQuotaSnapshot | null = null

  try {
    await deps.prisma.$transaction(async (tx) => {
      if (clientMessageId) {
        const existing = await tx.message.findUnique({
          where: {
            sessionId_clientMessageId: {
              sessionId,
              clientMessageId,
            },
          },
        })
        if (existing) {
          userMessageRecord = existing
          messageWasReused = true
          quotaSnapshot = await deps.inspectActorQuota(actor, { tx, now })
          return
        }
      } else {
        const existing = await tx.message.findFirst({
          where: { sessionId, role: 'user', content },
          orderBy: { createdAt: 'desc' },
        })
        if (hasRecentDuplicate(existing, now)) {
          userMessageRecord = existing
          messageWasReused = true
          quotaSnapshot = await deps.inspectActorQuota(actor, { tx, now })
          return
        }
      }

      const consumeResult = await deps.consumeActorQuota(actor, { tx, now })
      if (!consumeResult.success) {
        throw new QuotaExceededError(consumeResult.snapshot)
      }
      quotaSnapshot = consumeResult.snapshot

      userMessageRecord = await tx.message.create({
        data: {
          sessionId,
          role: 'user',
          content,
          ...(clientMessageId ? { clientMessageId } : {}),
        },
      })
    })
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      throw error
    }
    throw error
  }

  if (!userMessageRecord) {
    throw new Error('Failed to persist user message')
  }

  if (images && images.length > 0 && !messageWasReused) {
    const userId = actor.type === 'user' ? actor.id : 0
    await deps.persistChatImages(images, {
      sessionId,
      messageId: userMessageRecord.id,
      userId,
      clientMessageId,
    })
  }

  return {
    userMessage: userMessageRecord,
    messageWasReused,
    quotaSnapshot,
  }
}
