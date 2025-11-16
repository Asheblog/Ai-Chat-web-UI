import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import {
  CHAT_IMAGE_STORAGE_ROOT,
  CHAT_IMAGE_PUBLIC_PATH,
} from '../config/storage'
import {
  determineChatImageBaseUrl,
  resolveChatImageUrls,
} from './chat-images'

const AVATAR_DIR = 'profiles'
const MAX_AVATAR_BYTES = (() => {
  const raw = process.env.PROFILE_IMAGE_MAX_BYTES
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024
})()

const TARGET_AVATAR_SIZE = (() => {
  const raw = process.env.PROFILE_IMAGE_SIZE
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(parsed) && parsed >= 64 && parsed <= 1024) {
    return parsed
  }
  return 512
})()

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

const normaliseRelative = (value: string) => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '')

const resolveOutputFormat = (mime: string): 'png' | 'jpeg' | 'webp' => {
  const lower = (mime || '').toLowerCase()
  if (lower === 'image/webp') return 'webp'
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'jpeg'
  return 'png'
}

const withinStorageRoot = (target: string) => {
  const root = path.resolve(CHAT_IMAGE_STORAGE_ROOT)
  const resolved = path.resolve(target)
  return resolved.startsWith(root)
}

const processAvatarBuffer = async (buffer: Buffer, mime: string) => {
  const format = resolveOutputFormat(mime)
  const pipeline = sharp(buffer, { failOnError: false })
    .rotate()
    .resize(TARGET_AVATAR_SIZE, TARGET_AVATAR_SIZE, {
      fit: 'cover',
      position: 'attention',
    })

  if (format === 'jpeg') {
    const data = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    return { data, ext: 'jpg' as const }
  }

  if (format === 'webp') {
    const data = await pipeline.webp({ quality: 95 }).toBuffer()
    return { data, ext: 'webp' as const }
  }

  const data = await pipeline.png({ compressionLevel: 9 }).toBuffer()
  return { data, ext: 'png' as const }
}

export type AvatarUploadPayload = {
  data: string
  mime: string
}

export async function persistProfileImage(payload: AvatarUploadPayload): Promise<string> {
  if (!payload?.data || !payload?.mime) {
    throw new Error('头像数据无效')
  }
  const buffer = Buffer.from(payload.data, 'base64')
  if (!buffer.length) {
    throw new Error('头像数据为空')
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error('头像大小超出限制 (≤1MB)')
  }

  const processed = await processAvatarBuffer(buffer, payload.mime)

  const now = new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const fileName = `${now.getTime()}-${crypto.randomUUID()}.${processed.ext}`
  const relative = path.join(AVATAR_DIR, year, month, day, fileName)
  const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, relative)
  await ensureDir(path.dirname(absolute))
  await fs.writeFile(absolute, processed.data)
  return normaliseRelative(relative)
}

export async function deleteProfileImage(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return
  const normalised = normaliseRelative(relativePath)
  if (!normalised) return
  const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, normalised)
  if (!withinStorageRoot(absolute)) return
  try {
    await fs.unlink(absolute)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return
    console.warn('[profile-images] 删除头像失败', error)
  }
}

export const determineProfileImageBaseUrl = determineChatImageBaseUrl

export function resolveProfileImageUrl(relativePath: string | null | undefined, baseUrl: string): string | null {
  if (!relativePath) return null
  const urls = resolveChatImageUrls([relativePath], baseUrl)
  if (urls.length > 0 && urls[0]) {
    return urls[0]
  }
  const sanitized = normaliseRelative(relativePath)
  return `${CHAT_IMAGE_PUBLIC_PATH}/${sanitized}`
}

export async function replaceProfileImage(
  payload: AvatarUploadPayload | null,
  options: { currentPath?: string | null }
): Promise<string | null> {
  if (payload === null) {
    await deleteProfileImage(options.currentPath)
    return null
  }
  const nextPath = await persistProfileImage(payload)
  if (options.currentPath && options.currentPath !== nextPath) {
    await deleteProfileImage(options.currentPath).catch(() => {})
  }
  return nextPath
}
