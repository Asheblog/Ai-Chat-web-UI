import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { prisma } from '../db'
import {
  CHAT_IMAGE_STORAGE_ROOT,
  CHAT_IMAGE_PUBLIC_PATH,
  CHAT_IMAGE_DEFAULT_RETENTION_DAYS,
} from '../config/storage'

type IncomingImage = { data: string; mime: string }

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

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
let lastCleanupAt = 0

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

function normalizeRelativePath(parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/')
}

function getExtFromMime(mime: string): string {
  const key = mime.toLowerCase()
  if (MIME_EXT[key]) return MIME_EXT[key]
  if (key.startsWith('image/')) {
    const fallback = key.split('/')[1]
    if (fallback) return fallback.replace(/[^a-z0-9]+/g, '')
  }
  return 'bin'
}

export async function persistChatImages(
  images: IncomingImage[] | undefined,
  opts: { sessionId: number; messageId: number; userId: number; clientMessageId?: string | null },
): Promise<string[]> {
  if (!images || images.length === 0) return []

  await ensureDir(CHAT_IMAGE_STORAGE_ROOT)

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
      const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, relative)
      await ensureDir(path.dirname(absolute))
      const buffer = Buffer.from(data, 'base64')
      await fs.writeFile(absolute, buffer)
      relativePaths.push(relative)
    } catch (error) {
      console.error('[persistChatImages] failed to persist image', {
        sessionId: opts.sessionId,
        messageId: opts.messageId,
        error,
      })
    }
  }

  if (relativePaths.length > 0) {
    await prisma.messageAttachment.deleteMany({ where: { messageId: opts.messageId } })
    await prisma.messageAttachment.createMany({
      data: relativePaths.map((relative) => ({
        messageId: opts.messageId,
        relativePath: relative,
      })),
    })
  }

  return relativePaths
}

export function resolveChatImageUrls(relativePaths: string[] | null | undefined, origin: string): string[] {
  if (!relativePaths || relativePaths.length === 0) return []
  const prefix = `${origin.replace(/\/+$/, '')}${CHAT_IMAGE_PUBLIC_PATH}`
  return relativePaths.map((rel) => {
    const sanitized = rel.replace(/^\/*/, '').replace(/\\/g, '/')
    return `${prefix}/${sanitized}`
  })
}

async function deleteFileQuietly(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[cleanupExpiredChatImages] failed to delete', filePath, error)
    }
  }
}

export async function cleanupExpiredChatImages(retentionDays: number) {
  const now = Date.now()
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now

  const effectiveDays = Number.isFinite(retentionDays) && retentionDays >= 0
    ? retentionDays
    : CHAT_IMAGE_DEFAULT_RETENTION_DAYS
  if (effectiveDays < 0) return

  const cutoff =
    effectiveDays === 0
      ? new Date(now - 1000)
      : new Date(now - effectiveDays * 24 * 60 * 60 * 1000)

  try {
    const expiredAttachments = await prisma.messageAttachment.findMany({
      where: {
        message: {
          createdAt: { lt: cutoff },
        },
      },
      select: { id: true, relativePath: true },
    })

    if (expiredAttachments.length === 0) return

    for (const attachment of expiredAttachments) {
      const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, attachment.relativePath)
      await deleteFileQuietly(absolute)
    }

    await prisma.messageAttachment.deleteMany({
      where: { id: { in: expiredAttachments.map((a) => a.id) } },
    })
  } catch (error) {
    console.warn('[cleanupExpiredChatImages] failed to remove expired metadata', error)
  }
}

export function resolveRequestOrigin(req: Request): string {
  const headers = req.headers
  const xfProto = headers.get('x-forwarded-proto')
  const xfHost = headers.get('x-forwarded-host')
  const xfPort = headers.get('x-forwarded-port')
  if (xfProto && xfHost) {
    const host = xfPort ? `${xfHost.split(':')[0]}:${xfPort}` : xfHost
    return `${xfProto}://${host}`
  }

  const url = new URL(req.url)
  if (headers.get('host')) {
    const host = headers.get('host')!
    return `${url.protocol}//${host}`
  }
  return `${url.protocol}//${url.host}`
}
