/**
 * Chat Images Utils - 代理层
 *
 * 委托给 ChatImageService，无回退实现。
 * 纯函数（验证、URL 解析）保留在此文件中。
 */

import os from 'node:os'
import sharp from 'sharp'
import { Prisma } from '@prisma/client'
import { DEFAULT_CHAT_IMAGE_LIMITS, type ChatImageLimitConfig } from '@aichat/shared/image-limits'
import {
  CHAT_IMAGE_PUBLIC_PATH,
  CHAT_IMAGE_BASE_URL,
} from '../config/storage'
import { getChatImageService } from '../container/service-accessor'

type IncomingImage = { data: string; mime: string }
const BYTES_PER_MB = 1024 * 1024

const validationError = (message: string): Error => {
  const err = new Error(message)
  err.name = 'ValidationError'
  return err
}

// ============================================================================
// 纯函数 (保留在 utils)
// ============================================================================

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

export function determineChatImageBaseUrl(options: { request: Request; siteBaseUrl?: string | null }): string {
  const candidate = sanitizeBaseUrl(options.siteBaseUrl) || sanitizeBaseUrl(CHAT_IMAGE_BASE_URL)
  if (candidate) return candidate

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

// ============================================================================
// 迁移表检测工具 (公开导出)
// ============================================================================

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

// ============================================================================
// 公共 API（代理到 ChatImageService）
// ============================================================================

export async function persistChatImages(
  images: IncomingImage[] | undefined,
  opts: { sessionId: number; messageId: number; userId: number; clientMessageId?: string | null; skipValidation?: boolean },
): Promise<string[]> {
  if (!opts.skipValidation) {
    await validateChatImages(images)
  }
  return getChatImageService().persistImages(images, { ...opts, skipValidation: true })
}

export async function loadPersistedChatImages(messageId: number): Promise<IncomingImage[]> {
  return getChatImageService().loadImages(messageId)
}

export async function cleanupExpiredChatImages(retentionDays: number): Promise<void> {
  return getChatImageService().cleanupExpired(retentionDays)
}

export async function deleteAttachmentsForSessions(sessionIds: number[]): Promise<void> {
  return getChatImageService().deleteForSessions(sessionIds)
}
