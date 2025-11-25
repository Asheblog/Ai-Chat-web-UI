import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { DEFAULT_CHAT_IMAGE_LIMITS, type ChatImageLimitConfig } from '@aichat/shared/image-limits'
import { prisma } from '../db'
import {
  CHAT_IMAGE_STORAGE_ROOT,
  CHAT_IMAGE_PUBLIC_PATH,
  CHAT_IMAGE_DEFAULT_RETENTION_DAYS,
  CHAT_IMAGE_BASE_URL,
} from '../config/storage'

type IncomingImage = { data: string; mime: string }
const BYTES_PER_MB = 1024 * 1024

const validationError = (message: string): Error => {
  const err = new Error(message)
  err.name = 'ValidationError'
  return err
}

export async function validateChatImages(
  images: IncomingImage[] | undefined,
  limits: ChatImageLimitConfig = DEFAULT_CHAT_IMAGE_LIMITS,
): Promise<void> {
  if (!images || images.length === 0) return

  if (images.length > limits.maxCount) {
    throw validationError(`图片数量超过限制（>${limits.maxCount}张）`)
  }

  let totalBytes = 0

  for (let index = 0; index < images.length; index += 1) {
    const current = images[index]
    if (!current?.data || !current?.mime) {
      throw validationError('图片内容缺失或格式不正确')
    }

    const mime = current.mime.toLowerCase()
    if (!mime.startsWith('image/')) {
      throw validationError('仅支持图片文件')
    }

    let buffer: Buffer
    try {
      buffer = Buffer.from(current.data, 'base64')
    } catch (error) {
      throw validationError('图片数据无法解析')
    }

    const sizeMb = buffer.byteLength / BYTES_PER_MB
    if (sizeMb > limits.maxMb) {
      throw validationError(`图片大小超过限制（>${limits.maxMb}MB）`)
    }

    totalBytes += buffer.byteLength

    try {
      const metadata = await sharp(buffer).metadata()
      const width = metadata.width ?? 0
      const height = metadata.height ?? 0
      if (width > limits.maxEdge || height > limits.maxEdge) {
        throw validationError(`分辨率过大（>${limits.maxEdge}像素）`)
      }
    } catch (error) {
      if ((error as Error).name === 'ValidationError') {
        throw error
      }
      throw validationError('图片读取失败或格式不受支持')
    }
  }

  const totalMb = totalBytes / BYTES_PER_MB
  if (totalMb > limits.maxTotalMb) {
    throw validationError(`所有图片合计需 ≤ ${limits.maxTotalMb}MB`)
  }
}

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

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
let lastCleanupAt = 0
let messageAttachmentUnavailable = false
let messageAttachmentWarningPrinted = false

const MIGRATION_HINT =
  '请在部署环境内执行 `npx prisma migrate deploy --schema prisma/schema.prisma` 或等效命令，确保 message_attachments 表已创建。'

export const MESSAGE_ATTACHMENT_MIGRATION_HINT = MIGRATION_HINT

export function isMessageAttachmentTableMissing(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2021' &&
    (error.meta?.modelName === 'MessageAttachment' ||
      error.meta?.table === 'main.message_attachments' ||
      error.meta?.table === 'message_attachments')
  )
}

function handleMessageAttachmentTableMissing(context: string, error: unknown): boolean {
  if (!isMessageAttachmentTableMissing(error)) {
    return false
  }
  messageAttachmentUnavailable = true
  if (!messageAttachmentWarningPrinted) {
    console.warn(
      `[${context}] message_attachments 表不存在，已跳过图片元数据操作。${MIGRATION_HINT}`,
    )
    messageAttachmentWarningPrinted = true
  }
  return true
}

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

const sanitizeBaseUrl = (value: string | null | undefined): string => {
  if (!value) return ''
  let raw = value.trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`
  }
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

const pickLanIPv4 = (): string | null => {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    const entries = nets[name] || []
    for (const entry of entries) {
      if (entry && entry.family === 'IPv4' && !entry.internal && entry.address) {
        return entry.address
      }
    }
  }
  return null
}

const ensureProtocol = (proto: string | null | undefined, fallback: 'http' | 'https'): 'http' | 'https' => {
  if (!proto) return fallback
  const lower = proto.toLowerCase()
  return lower === 'https' ? 'https' : 'http'
}

export async function persistChatImages(
  images: IncomingImage[] | undefined,
  opts: { sessionId: number; messageId: number; userId: number; clientMessageId?: string | null; skipValidation?: boolean },
): Promise<string[]> {
  if (!images || images.length === 0) return []

  if (!opts.skipValidation) {
    await validateChatImages(images)
  }

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
    if (messageAttachmentUnavailable) {
      return relativePaths
    }

    try {
      await prisma.messageAttachment.deleteMany({ where: { messageId: opts.messageId } })
      await prisma.messageAttachment.createMany({
        data: relativePaths.map((relative) => ({
          messageId: opts.messageId,
          relativePath: relative,
        })),
      })
    } catch (error) {
      if (!handleMessageAttachmentTableMissing('persistChatImages', error)) {
        console.error('[persistChatImages] failed to sync metadata', {
          sessionId: opts.sessionId,
          messageId: opts.messageId,
          error,
        })
      }
    }
  }

  return relativePaths
}

const resolveMimeFromExt = (ext: string): string => {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  if (EXT_MIME[normalized]) return EXT_MIME[normalized]
  if (normalized) return `image/${normalized}`
  return 'application/octet-stream'
}

export async function loadPersistedChatImages(messageId: number): Promise<IncomingImage[]> {
  if (messageAttachmentUnavailable) return []

  try {
    const attachments = await prisma.messageAttachment.findMany({
      where: { messageId },
      select: { relativePath: true },
    })
    if (!attachments.length) return []

    const images: IncomingImage[] = []
    for (const attachment of attachments) {
      const relative = attachment.relativePath
      const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, relative)
      try {
        const buffer = await fs.readFile(absolute)
        const mime = resolveMimeFromExt(path.extname(relative))
        images.push({ data: buffer.toString('base64'), mime })
      } catch (error) {
        console.warn('[loadPersistedChatImages] failed to read attachment', {
          messageId,
          relativePath: relative,
          error,
        })
      }
    }
    return images
  } catch (error) {
    if (!handleMessageAttachmentTableMissing('loadPersistedChatImages', error)) {
      console.error('[loadPersistedChatImages] failed to load attachments', { messageId, error })
    }
  }
  return []
}

export function determineChatImageBaseUrl(options: { request: Request; siteBaseUrl?: string | null }): string {
  const candidate = sanitizeBaseUrl(options.siteBaseUrl) || sanitizeBaseUrl(CHAT_IMAGE_BASE_URL)
  if (candidate) return candidate

  // 若请求来源已有公网/局域网 IP 访问后端端口，则优先使用当前监听端口
  const req = options.request
  const headers = req.headers
  const url = new URL(req.url)

  const hostHeader = headers.get('host')
  if (hostHeader) {
    const protoFromUrl = url.protocol === 'https:' ? 'https' : 'http'
    return `${protoFromUrl}://${hostHeader}`.replace(/\/+/g, '/').replace(/\/+$/, '')
  }

  const forwardedProto = headers.get('x-forwarded-proto')
  const forwardedHost = headers.get('x-forwarded-host')
  const forwardedPort = headers.get('x-forwarded-port')

  let protocol = ensureProtocol(forwardedProto, url.protocol === 'https:' ? 'https' : 'http')
  let host = forwardedHost || url.host

  if (forwardedPort) {
    const bareHost = host ? host.split(':')[0] : ''
    host = bareHost ? `${bareHost}:${forwardedPort}` : host
  }

  if (host) {
    const bareHost = host.split(':')[0]
    const shouldSwapToLan =
      !bareHost ||
      bareHost === 'localhost' ||
      bareHost === '127.0.0.1' ||
      bareHost === '::1'
    if (shouldSwapToLan) {
      const lan = pickLanIPv4()
      if (lan) {
        const portPart =
          (host.includes(':') ? host.split(':')[1] : url.port) ||
          (protocol === 'https' ? '443' : '80')
        host = portPart ? `${lan}:${portPart}` : lan
      }
    }
    return `${protocol}://${host}`.replace(/\/+$/, '')
  }

  const lan = pickLanIPv4()
  if (lan) {
    const fallbackProtocol = url.protocol === 'https:' ? 'https' : 'http'
    const port = url.port || (fallbackProtocol === 'https' ? '443' : '80')
    const hostWithPort = port ? `${lan}:${port}` : lan
    return `${fallbackProtocol}://${hostWithPort}`.replace(/\/+$/, '')
  }

  const finalProtocol = url.protocol === 'https:' ? 'https' : 'http'
  return `${finalProtocol}://${url.host}`.replace(/\/+$/, '')
}

export function resolveChatImageUrls(relativePaths: string[] | null | undefined, baseUrl: string): string[] {
  if (!relativePaths || relativePaths.length === 0) return []
  const origin = baseUrl && baseUrl.trim().length > 0 ? baseUrl.replace(/\/+$/, '') : ''
  const prefix = `${origin}${CHAT_IMAGE_PUBLIC_PATH}`
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

  if (messageAttachmentUnavailable) {
    return
  }

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
    if (!handleMessageAttachmentTableMissing('cleanupExpiredChatImages', error)) {
      console.warn('[cleanupExpiredChatImages] failed to remove expired metadata', error)
    }
  }
}

export async function deleteAttachmentsForSessions(sessionIds: number[]) {
  if (messageAttachmentUnavailable) {
    return
  }
  const uniqueIds = Array.from(new Set(sessionIds.filter((id) => Number.isInteger(id))))
  if (uniqueIds.length === 0) return

  try {
    const attachments = await prisma.messageAttachment.findMany({
      where: {
        message: {
          sessionId: { in: uniqueIds },
        },
      },
      select: { id: true, relativePath: true },
    })

    if (attachments.length === 0) return

    for (const attachment of attachments) {
      const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, attachment.relativePath)
      await deleteFileQuietly(absolute)
    }

    await prisma.messageAttachment.deleteMany({
      where: { id: { in: attachments.map((item) => item.id) } },
    })
  } catch (error) {
    if (!handleMessageAttachmentTableMissing('deleteAttachmentsForSessions', error)) {
      console.warn('[deleteAttachmentsForSessions] failed to remove attachments', error)
    }
  }
}
