/**
 * ChatImageService - 聊天图片服务
 *
 * 提供图片持久化、加载和清理功能，使用依赖注入替代直接 prisma 访问。
 */

import type { PrismaClient } from '@prisma/client'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  CHAT_IMAGE_STORAGE_ROOT,
  CHAT_IMAGE_DEFAULT_RETENTION_DAYS,
} from '../../config/storage'
import { BackendLogger as log } from '../../utils/logger'

type IncomingImage = { data: string; mime: string }

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const MIGRATION_HINT =
  '请在部署环境内执行 `npx prisma migrate deploy --schema prisma/schema.prisma` 或等效命令，确保 message_attachments 表已创建。'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]),
) as Record<string, string>

function getExtFromMime(mime: string): string {
  const key = mime.toLowerCase()
  if (MIME_EXT[key]) return MIME_EXT[key]
  if (key.startsWith('image/')) {
    const fallback = key.split('/')[1]
    if (fallback) return fallback.replace(/[^a-z0-9]+/g, '')
  }
  return 'bin'
}

function resolveMimeFromExt(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  if (EXT_MIME[normalized]) return EXT_MIME[normalized]
  if (normalized) return `image/${normalized}`
  return 'application/octet-stream'
}

function normalizeRelativePath(parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/')
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function deleteFileQuietly(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      log.warn('[chat-image-service] failed to delete', filePath, error)
    }
  }
}

function isMessageAttachmentTableMissing(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2021' &&
    (error.meta?.modelName === 'MessageAttachment' ||
      error.meta?.table === 'main.message_attachments' ||
      error.meta?.table === 'message_attachments')
  )
}

export interface ChatImageServiceDeps {
  prisma: PrismaClient
  storageRoot?: string
}

export interface PersistOptions {
  sessionId: number
  messageId: number
  userId: number
  clientMessageId?: string | null
  skipValidation?: boolean
}

export class ChatImageService {
  private prisma: PrismaClient
  private storageRoot: string
  private lastCleanupAt = 0
  private attachmentUnavailable = false
  private warningPrinted = false

  constructor(deps: ChatImageServiceDeps) {
    this.prisma = deps.prisma
    this.storageRoot = deps.storageRoot ?? CHAT_IMAGE_STORAGE_ROOT
  }

  private handleTableMissing(context: string, error: unknown): boolean {
    if (!isMessageAttachmentTableMissing(error)) {
      return false
    }
    this.attachmentUnavailable = true
    if (!this.warningPrinted) {
      console.warn(`[${context}] message_attachments 表不存在，已跳过图片元数据操作。${MIGRATION_HINT}`)
      this.warningPrinted = true
    }
    return true
  }

  async persistImages(
    images: IncomingImage[] | undefined,
    opts: PersistOptions,
  ): Promise<string[]> {
    if (!images || images.length === 0) return []

    await ensureDir(this.storageRoot)

    const now = new Date()
    const year = now.getUTCFullYear().toString()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')

    const relativePaths: string[] = []

    for (let index = 0; index < images.length; index += 1) {
      const { data, mime } = images[index]
      if (!data || !mime) continue

      try {
        const ext = getExtFromMime(mime)
        const uuid = crypto.randomUUID()
        const fileName = `${opts.sessionId}-${opts.messageId}-${uuid}.${ext}`
        const relative = normalizeRelativePath([year, month, day, fileName])
        const absolute = path.join(this.storageRoot, relative)
        await ensureDir(path.dirname(absolute))
        const buffer = Buffer.from(data, 'base64')
        await fs.writeFile(absolute, buffer)
        relativePaths.push(relative)
      } catch (error) {
        log.error('[chat-image-service] failed to persist image', {
          sessionId: opts.sessionId,
          messageId: opts.messageId,
          error,
        })
      }
    }

    if (relativePaths.length > 0) {
      if (this.attachmentUnavailable) {
        return relativePaths
      }

      try {
        await this.prisma.messageAttachment.deleteMany({ where: { messageId: opts.messageId } })
        await this.prisma.messageAttachment.createMany({
          data: relativePaths.map((relative) => ({
            messageId: opts.messageId,
            relativePath: relative,
          })),
        })
      } catch (error) {
        if (!this.handleTableMissing('persistImages', error)) {
          log.error('[chat-image-service] failed to sync metadata', {
            sessionId: opts.sessionId,
            messageId: opts.messageId,
            error,
          })
        }
      }
    }

    return relativePaths
  }

  async loadImages(messageId: number): Promise<IncomingImage[]> {
    if (this.attachmentUnavailable) return []

    try {
      const attachments = await this.prisma.messageAttachment.findMany({
        where: { messageId },
        select: { relativePath: true },
      })
      if (!attachments.length) return []

      const images: IncomingImage[] = []
      for (const attachment of attachments) {
        const relative = attachment.relativePath
        const absolute = path.join(this.storageRoot, relative)
        try {
          const buffer = await fs.readFile(absolute)
          const mime = resolveMimeFromExt(path.extname(relative))
          images.push({ data: buffer.toString('base64'), mime })
        } catch (error) {
          log.warn('[chat-image-service] failed to read attachment', {
            messageId,
            relativePath: relative,
            error,
          })
        }
      }
      return images
    } catch (error) {
      if (!this.handleTableMissing('loadImages', error)) {
        log.error('[chat-image-service] failed to load attachments', { messageId, error })
      }
    }
    return []
  }

  async cleanupExpired(retentionDays: number): Promise<void> {
    const now = Date.now()
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) return
    this.lastCleanupAt = now

    if (this.attachmentUnavailable) {
      return
    }

    const effectiveDays =
      Number.isFinite(retentionDays) && retentionDays >= 0
        ? retentionDays
        : CHAT_IMAGE_DEFAULT_RETENTION_DAYS
    if (effectiveDays < 0) return

    const cutoff =
      effectiveDays === 0
        ? new Date(now - 1000)
        : new Date(now - effectiveDays * 24 * 60 * 60 * 1000)

    try {
      const expiredAttachments = await this.prisma.messageAttachment.findMany({
        where: {
          message: {
            createdAt: { lt: cutoff },
          },
        },
        select: { id: true, relativePath: true },
      })

      if (expiredAttachments.length === 0) return

      for (const attachment of expiredAttachments) {
        const absolute = path.join(this.storageRoot, attachment.relativePath)
        await deleteFileQuietly(absolute)
      }

      await this.prisma.messageAttachment.deleteMany({
        where: { id: { in: expiredAttachments.map((a) => a.id) } },
      })
    } catch (error) {
      if (!this.handleTableMissing('cleanupExpired', error)) {
        log.warn('[chat-image-service] failed to remove expired metadata', error)
      }
    }
  }

  async deleteForSessions(sessionIds: number[]): Promise<void> {
    if (this.attachmentUnavailable) {
      return
    }
    const uniqueIds = Array.from(new Set(sessionIds.filter((id) => Number.isInteger(id))))
    if (uniqueIds.length === 0) return

    try {
      const attachments = await this.prisma.messageAttachment.findMany({
        where: {
          message: {
            sessionId: { in: uniqueIds },
          },
        },
        select: { id: true, relativePath: true },
      })

      if (attachments.length === 0) return

      for (const attachment of attachments) {
        const absolute = path.join(this.storageRoot, attachment.relativePath)
        await deleteFileQuietly(absolute)
      }

      await this.prisma.messageAttachment.deleteMany({
        where: { id: { in: attachments.map((item) => item.id) } },
      })
    } catch (error) {
      if (!this.handleTableMissing('deleteForSessions', error)) {
        log.warn('[chat-image-service] failed to remove attachments', error)
      }
    }
  }

  /**
   * 重置清理间隔（用于测试）
   */
  resetCleanupInterval(): void {
    this.lastCleanupAt = 0
  }
}
