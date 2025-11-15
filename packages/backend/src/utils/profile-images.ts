import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

const normaliseRelative = (value: string) => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '')

const getExtFromMime = (mime: string) => {
  const lower = (mime || '').toLowerCase()
  if (MIME_EXT[lower]) return MIME_EXT[lower]
  if (lower.startsWith('image/')) {
    return lower.split('/')[1]?.replace(/[^a-z0-9]+/g, '') || 'bin'
  }
  return 'bin'
}

const withinStorageRoot = (target: string) => {
  const root = path.resolve(CHAT_IMAGE_STORAGE_ROOT)
  const resolved = path.resolve(target)
  return resolved.startsWith(root)
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

  const now = new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const ext = getExtFromMime(payload.mime)
  const fileName = `${now.getTime()}-${crypto.randomUUID()}.${ext}`
  const relative = path.join(AVATAR_DIR, year, month, day, fileName)
  const absolute = path.join(CHAT_IMAGE_STORAGE_ROOT, relative)
  await ensureDir(path.dirname(absolute))
  await fs.writeFile(absolute, buffer)
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
