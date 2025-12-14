/**
 * MessageProcessor - 消息处理器
 *
 * 统一处理用户消息创建/重用逻辑和助手占位符创建。
 */

import type { PrismaClient } from '@prisma/client'
import type { Actor, Message, UsageQuotaSnapshot } from '../../../types'
import { consumeActorQuota } from '../../../utils/quota'
import { loadPersistedChatImages } from '../../../utils/chat-images'
import { createUserMessageWithQuota } from './message-service'
import { QuotaExceededError } from '../chat-common'
import { upsertAssistantMessageByClientId } from '../assistant-message-service'
import { deriveAssistantClientMessageId } from '../stream-state'
import { BackendLogger as log } from '../../../utils/logger'

// 图片类型定义 (与 chat-images.ts 中的 IncomingImage 一致)
export interface ChatImage {
  data: string
  mime: string
}

export interface MessageProcessorParams {
  actor: Actor
  sessionId: number
  content: string
  clientMessageId: string | null
  replyToMessageId: number | null
  replyToClientMessageId: string | null
  images?: ChatImage[]
  now: Date
}

export interface MessageProcessorResult {
  userMessage: Message
  assistantMessageId: number | null
  assistantClientMessageId: string
  messageWasReused: boolean
  quotaSnapshot: UsageQuotaSnapshot | null
  images: ChatImage[] | undefined
  quotaError?: {
    message: string
    snapshot: UsageQuotaSnapshot
    requiredLogin: boolean
  }
}

export interface MessageProcessorDeps {
  prisma: PrismaClient
}

/**
 * 消息处理器类
 */
export class MessageProcessor {
  constructor(private deps: MessageProcessorDeps) {}

  /**
   * 处理消息创建/重用逻辑
   */
  async process(params: MessageProcessorParams): Promise<MessageProcessorResult> {
    const {
      actor,
      sessionId,
      content: inputContent,
      clientMessageId,
      replyToMessageId,
      replyToClientMessageId,
      images: inputImages,
      now,
    } = params

    let content = inputContent
    let images = replyToMessageId || replyToClientMessageId ? undefined : inputImages
    let userMessageRecord: Message | null = null
    let assistantMessageId: number | null = null
    let messageWasReused = false
    let quotaSnapshot: UsageQuotaSnapshot | null = null

    // 重用现有用户消息的辅助函数
    const reuseExistingUserMessage = async (
      message: Message
    ): Promise<{ quotaError: MessageProcessorResult['quotaError'] | null }> => {
      content = message.content
      userMessageRecord = message
      messageWasReused = true
      const quotaResult = await consumeActorQuota(actor, { now })
      if (!quotaResult.success) {
        return {
          quotaError: {
            message: 'Daily quota exhausted',
            snapshot: quotaResult.snapshot,
            requiredLogin: actor.type !== 'user',
          },
        }
      }
      quotaSnapshot = quotaResult.snapshot
      return { quotaError: null }
    }

    // 按 messageId 查找重用
    if (replyToMessageId) {
      const existingUserMessage = await this.deps.prisma.message.findFirst({
        where: { id: replyToMessageId, sessionId, role: 'user' },
      })

      if (!existingUserMessage) {
        // 尝试按 clientMessageId 回退
        let fallbackMessage: Message | null = null
        if (replyToClientMessageId) {
          fallbackMessage = (await this.deps.prisma.message.findFirst({
            where: { sessionId, clientMessageId: replyToClientMessageId, role: 'user' },
          })) as Message | null
          if (fallbackMessage) {
            log.warn('[chat stream] numeric reply message missing, fallback to client id', {
              sessionId,
              replyToMessageId,
              replyToClientMessageId,
              actor: actor.identifier,
            })
          }
        }
        if (!fallbackMessage) {
          throw new MessageNotFoundError(
            'Reference message not found',
            'numeric_id',
            replyToMessageId
          )
        }
        const { quotaError } = await reuseExistingUserMessage(fallbackMessage)
        if (quotaError) {
          return this.buildQuotaErrorResult(quotaError, clientMessageId, replyToMessageId)
        }
      } else {
        const { quotaError } = await reuseExistingUserMessage(existingUserMessage as Message)
        if (quotaError) {
          return this.buildQuotaErrorResult(quotaError, clientMessageId, replyToMessageId)
        }
      }
    } else if (replyToClientMessageId) {
      // 按 clientMessageId 查找重用
      const existingUserMessage = await this.deps.prisma.message.findFirst({
        where: {
          sessionId,
          clientMessageId: replyToClientMessageId,
          role: 'user',
        },
      })

      if (!existingUserMessage) {
        throw new MessageNotFoundError(
          'Reference message not found',
          'client_id',
          replyToClientMessageId
        )
      }
      const { quotaError } = await reuseExistingUserMessage(existingUserMessage as Message)
      if (quotaError) {
        return this.buildQuotaErrorResult(quotaError, clientMessageId, null)
      }
    } else {
      // 创建新消息
      try {
        const result = await createUserMessageWithQuota({
          actor,
          sessionId,
          content,
          clientMessageId,
          images,
          now,
        })
        userMessageRecord = result.userMessage as Message
        messageWasReused = result.messageWasReused
        quotaSnapshot = result.quotaSnapshot
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return this.buildQuotaErrorResult(
            {
              message: 'Daily quota exhausted',
              snapshot: error.snapshot,
              requiredLogin: actor.type !== 'user',
            },
            clientMessageId,
            null
          )
        }
        throw error
      }
    }

    // 恢复图片（如果是重新生成且没有提供新图片）
    if (
      (replyToMessageId || replyToClientMessageId) &&
      userMessageRecord &&
      (!images || images.length === 0)
    ) {
      const restoredImages = await loadPersistedChatImages(userMessageRecord.id)
      if (restoredImages.length > 0) {
        images = restoredImages
      }
    }

    // 生成助手 clientMessageId
    const assistantClientMessageId = deriveAssistantClientMessageId(
      replyToMessageId
        ? `${clientMessageId ?? ''}${clientMessageId ? ':' : ''}regen:${replyToMessageId}:${Date.now()}`
        : clientMessageId
    )

    // 创建助手占位符
    try {
      const placeholderId = await upsertAssistantMessageByClientId({
        sessionId,
        clientMessageId: assistantClientMessageId,
        data: {
          content: '',
          streamStatus: 'streaming',
          streamCursor: 0,
          streamReasoning: null,
          parentMessageId: userMessageRecord?.id ?? null,
          variantIndex: null,
        },
      })
      assistantMessageId = placeholderId ?? assistantMessageId
      if (!assistantMessageId) {
        log.warn('Assistant placeholder upsert returned null', {
          sessionId,
          clientMessageId: assistantClientMessageId,
        })
      }
    } catch (error) {
      log.warn('Failed to create assistant placeholder', {
        sessionId,
        error: error instanceof Error ? error.message : error,
      })
    }

    return {
      userMessage: userMessageRecord!,
      assistantMessageId,
      assistantClientMessageId,
      messageWasReused,
      quotaSnapshot,
      images,
    }
  }

  private buildQuotaErrorResult(
    quotaError: NonNullable<MessageProcessorResult['quotaError']>,
    clientMessageId: string | null,
    replyToMessageId: number | null
  ): MessageProcessorResult {
    const assistantClientMessageId = deriveAssistantClientMessageId(
      replyToMessageId
        ? `${clientMessageId ?? ''}${clientMessageId ? ':' : ''}regen:${replyToMessageId}:${Date.now()}`
        : clientMessageId
    )
    return {
      userMessage: null as unknown as Message,
      assistantMessageId: null,
      assistantClientMessageId,
      messageWasReused: false,
      quotaSnapshot: null,
      images: undefined,
      quotaError,
    }
  }
}

/**
 * 消息未找到错误
 */
export class MessageNotFoundError extends Error {
  constructor(
    message: string,
    public readonly idType: 'numeric_id' | 'client_id',
    public readonly id: number | string
  ) {
    super(message)
    this.name = 'MessageNotFoundError'
  }
}

// 默认实例（延迟初始化，需要在容器就绪后使用）
let messageProcessorInstance: MessageProcessor | null = null

export const getMessageProcessor = (deps?: MessageProcessorDeps): MessageProcessor => {
  if (deps) {
    messageProcessorInstance = new MessageProcessor(deps)
  }
  if (!messageProcessorInstance) {
    throw new Error('MessageProcessor not initialized. Call getMessageProcessor(deps) first.')
  }
  return messageProcessorInstance
}

export const setMessageProcessor = (processor: MessageProcessor) => {
  messageProcessorInstance = processor
}

// Re-export QuotaExceededError for convenience
export { QuotaExceededError } from '../chat-common'
