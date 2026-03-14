/**
 * Chat Images Utils - 代理层
 *
 * 委托给 ChatImageService，可由容器显式绑定。
 * 纯函数（验证、URL 解析）保留在此文件中。
 */

import os from 'node:os'
import { Prisma } from '@prisma/client'
import { DEFAULT_CHAT_IMAGE_LIMITS, type ChatImageLimitConfig } from '@aichat/shared/image-limits'
import {
  CHAT_IMAGE_PUBLIC_PATH,
  CHAT_IMAGE_BASE_URL,
} from '../config/storage'
import { prisma } from '../db'
import { ChatImageService } from '../services/attachment/chat-image-service'

type IncomingImage = { data: string; mime: string }
const BYTES_PER_MB = 1024 * 1024
const MAX_SVG_PARSE_BYTES = 128 * 1024

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

const validationError = (message: string): Error => {
  const err = new Error(message)
  err.name = 'ValidationError'
  return err
}

interface ImageDimensions {
  width: number
  height: number
}

const normalizeDimensions = (width: number, height: number): ImageDimensions | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  const normalizedWidth = Math.max(0, Math.floor(Math.abs(width)))
  const normalizedHeight = Math.max(0, Math.floor(Math.abs(height)))
  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null
  }
  return { width: normalizedWidth, height: normalizedHeight }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const readPngDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 24) return null
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return normalizeDimensions(width, height)
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
])

const readJpegDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 4) return null
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1
    }
    if (offset >= buffer.length) return null

    const marker = buffer[offset]
    offset += 1

    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }

    if (offset + 1 >= buffer.length) return null
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2) return null
    offset += 2
    if (offset + segmentLength - 2 > buffer.length) return null

    if (SOF_MARKERS.has(marker)) {
      if (segmentLength < 7 || offset + 4 >= buffer.length) return null
      const height = buffer.readUInt16BE(offset + 1)
      const width = buffer.readUInt16BE(offset + 3)
      return normalizeDimensions(width, height)
    }

    offset += segmentLength - 2
  }

  return null
}

const readGifDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 10) return null
  const magic = buffer.toString('ascii', 0, 6)
  if (magic !== 'GIF87a' && magic !== 'GIF89a') return null
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  return normalizeDimensions(width, height)
}

const readWebpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null

  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16)
    const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16)
    return normalizeDimensions(width, height)
  }

  if (chunk === 'VP8 ') {
    if (buffer.length < 30) return null
    const width = buffer.readUInt16LE(26) & 0x3fff
    const height = buffer.readUInt16LE(28) & 0x3fff
    return normalizeDimensions(width, height)
  }

  if (chunk === 'VP8L') {
    if (buffer.length < 25) return null
    const b0 = buffer[21]
    const b1 = buffer[22]
    const b2 = buffer[23]
    const b3 = buffer[24]
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return normalizeDimensions(width, height)
  }

  return null
}

const readBmpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 26) return null
  if (buffer.toString('ascii', 0, 2) !== 'BM') return null
  const dibHeaderSize = buffer.readUInt32LE(14)

  if (dibHeaderSize === 12) {
    if (buffer.length < 22) return null
    const width = buffer.readUInt16LE(18)
    const height = buffer.readUInt16LE(20)
    return normalizeDimensions(width, height)
  }

  if (dibHeaderSize >= 40) {
    if (buffer.length < 26) return null
    const width = Math.abs(buffer.readInt32LE(18))
    const height = Math.abs(buffer.readInt32LE(22))
    return normalizeDimensions(width, height)
  }

  return null
}

const parseSvgLength = (raw: string | null): number | null => {
  if (!raw) return null
  const match = raw.trim().match(/^([0-9]*\.?[0-9]+)/)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

const readSvgDimensions = (buffer: Buffer): ImageDimensions | null => {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, MAX_SVG_PARSE_BYTES))
  const svgTagMatch = text.match(/<svg\b[^>]*>/i)
  if (!svgTagMatch) return null
  const svgTag = svgTagMatch[0]

  const widthAttr = svgTag.match(/\bwidth\s*=\s*['"]([^'"]+)['"]/i)?.[1] || null
  const heightAttr = svgTag.match(/\bheight\s*=\s*['"]([^'"]+)['"]/i)?.[1] || null
  const width = parseSvgLength(widthAttr)
  const height = parseSvgLength(heightAttr)
  if (width != null && height != null) {
    return normalizeDimensions(width, height)
  }

  const viewBoxMatch = svgTag.match(
    /\bviewBox\s*=\s*['"]\s*[-+]?[0-9]*\.?[0-9]+\s+[-+]?[0-9]*\.?[0-9]+\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s*['"]/i,
  )
  if (!viewBoxMatch) return null
  const viewBoxWidth = Number.parseFloat(viewBoxMatch[1])
  const viewBoxHeight = Number.parseFloat(viewBoxMatch[2])
  return normalizeDimensions(viewBoxWidth, viewBoxHeight)
}

const readImageDimensions = (buffer: Buffer, mime: string): ImageDimensions | null => {
  const mimeType = (mime || '').toLowerCase().split(';')[0].trim()

  const parsersByMime: Record<string, (input: Buffer) => ImageDimensions | null> = {
    'image/png': readPngDimensions,
    'image/jpeg': readJpegDimensions,
    'image/jpg': readJpegDimensions,
    'image/gif': readGifDimensions,
    'image/webp': readWebpDimensions,
    'image/bmp': readBmpDimensions,
    'image/svg+xml': readSvgDimensions,
  }

  const orderedParsers = [
    readPngDimensions,
    readJpegDimensions,
    readGifDimensions,
    readWebpDimensions,
    readBmpDimensions,
    readSvgDimensions,
  ]

  const preferred = parsersByMime[mimeType]
  if (preferred) {
    const preferredResult = preferred(buffer)
    if (preferredResult) return preferredResult
  }

  for (const parser of orderedParsers) {
    if (parser === preferred) continue
    const result = parser(buffer)
    if (result) return result
  }

  return null
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

    const dimensions = readImageDimensions(buffer, mime)
    if (!dimensions) {
      throw validationError('图片读取失败或格式不受支持')
    }
    if (dimensions.width > limits.maxEdge || dimensions.height > limits.maxEdge) {
      throw validationError(`分辨率过大（>${limits.maxEdge}像素）`)
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

const readFirstHeaderValue = (value: string | null) => {
  if (!value) return ''
  return value.split(',')[0]?.trim() || ''
}

const hostHasExplicitPort = (host: string) => {
  if (!host) return false
  if (host.startsWith('[')) {
    return /\]:\d+$/.test(host)
  }
  return /:\d+$/.test(host)
}

const parseHostInfo = (protocol: 'http' | 'https', host: string) => {
  try {
    const parsed = new URL(`${protocol}://${host}`)
    return { hostname: parsed.hostname, port: parsed.port }
  } catch {
    const [hostname = host, port = ''] = host.split(':')
    return { hostname, port }
  }
}

export function determineChatImageBaseUrl(options: { request: Request; siteBaseUrl?: string | null }): string {
  const candidate = sanitizeBaseUrl(options.siteBaseUrl) || sanitizeBaseUrl(CHAT_IMAGE_BASE_URL)
  if (candidate) return candidate

  const req = options.request
  const headers = req.headers
  const url = new URL(req.url)

  const forwardedProto = readFirstHeaderValue(headers.get('x-forwarded-proto'))
  const forwardedHost = readFirstHeaderValue(headers.get('x-forwarded-host'))
  const forwardedPort = readFirstHeaderValue(headers.get('x-forwarded-port'))
  const hostHeader = readFirstHeaderValue(headers.get('host'))

  const fallbackProtocol = url.protocol === 'https:' ? 'https' : 'http'
  const protocol = ensureProtocol(forwardedProto, fallbackProtocol)
  let host = forwardedHost || hostHeader || url.host

  if (host && forwardedPort && !hostHasExplicitPort(host)) {
    const normalizedPort = forwardedPort.replace(/[^0-9]/g, '')
    if (normalizedPort) {
      host = `${host}:${normalizedPort}`
    }
  }

  if (host) {
    const hostInfo = parseHostInfo(protocol, host)
    const bareHost = hostInfo.hostname
    const shouldSwapToLan =
      !bareHost ||
      bareHost === 'localhost' ||
      bareHost === '127.0.0.1' ||
      bareHost === '::1'
    if (shouldSwapToLan) {
      const lan = pickLanIPv4()
      if (lan) {
        const portPart = hostInfo.port || url.port || (protocol === 'https' ? '443' : '80')
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
