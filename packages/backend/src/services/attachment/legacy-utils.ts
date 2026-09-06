/**
 * Chat Images 兼容代理层。
 *
 * 从 utils/chat-images.ts 迁移至 services 层，避免 utils 依赖 services。
 * 纯函数（验证、URL 解析）仍保留在 utils/chat-images.ts。
 */

import { prisma } from '../../db'
import { validateChatImages } from '../../utils/chat-images'
import { ChatImageService } from './chat-image-service'

type IncomingImage = { data: string; mime: string }

type ChatImageServiceLike = Pick<ChatImageService, 'persistImages' | 'loadImages' | 'cleanupExpired' | 'deleteForSessions'>

interface ChatImagesUtilsDeps {
  chatImageService: ChatImageServiceLike
}

let configuredChatImageService: ChatImageServiceLike | null = null
let fallbackChatImageService: ChatImageService | null = null

const resolveChatImageService = (): ChatImageServiceLike => {
  if (configuredChatImageService) return configuredChatImageService
  if (!fallbackChatImageService) {
    fallbackChatImageService = new ChatImageService({ prisma })
  }
  return fallbackChatImageService
}

export const configureChatImagesUtils = (deps: ChatImagesUtilsDeps): void => {
  configuredChatImageService = deps.chatImageService
}

export async function persistChatImages(
  images: IncomingImage[] | undefined,
  opts: { sessionId: number; messageId: number; userId: number; clientMessageId?: string | null; skipValidation?: boolean },
): Promise<string[]> {
  if (!opts.skipValidation) {
    await validateChatImages(images)
  }
  return resolveChatImageService().persistImages(images, { ...opts, skipValidation: true })
}

export async function loadPersistedChatImages(messageId: number): Promise<IncomingImage[]> {
  return resolveChatImageService().loadImages(messageId)
}

export async function cleanupExpiredChatImages(retentionDays: number): Promise<void> {
  return resolveChatImageService().cleanupExpired(retentionDays)
}

export async function deleteAttachmentsForSessions(sessionIds: number[]): Promise<void> {
  return resolveChatImageService().deleteForSessions(sessionIds)
}
