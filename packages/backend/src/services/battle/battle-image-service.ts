import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CHAT_IMAGE_PUBLIC_PATH, CHAT_IMAGE_STORAGE_ROOT } from '../../config/storage'
import { determineChatImageBaseUrl, resolveChatImageUrls, validateChatImages } from '../../utils/chat-images'
import type { BattleUploadImage } from '@aichat/shared/battle-contract'

const BATTLE_IMAGE_SUBDIR = 'battle'

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

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
}

const normalizeRelativePath = (raw: string) =>
  raw
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')

const getExtFromMime = (mime: string) => {
  const lower = (mime || '').toLowerCase()
  if (MIME_EXT[lower]) return MIME_EXT[lower]
  if (lower.startsWith('image/')) {
    return lower.slice('image/'.length).replace(/[^a-z0-9]+/g, '') || 'bin'
  }
  return 'bin'
}

const resolveMimeByExt = (relativePath: string) => {
  const ext = path.extname(relativePath).replace(/^\./, '').toLowerCase()
  if (ext && EXT_MIME[ext]) {
    return EXT_MIME[ext]
  }
  return ext ? `image/${ext}` : 'application/octet-stream'
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

const isPathWithinRoot = (rootDir: string, targetPath: string) => {
  const root = path.resolve(rootDir)
  const target = path.resolve(targetPath)
  if (target === root) return true
  const relative = path.relative(root, target)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const normalizePublicPrefix = `${CHAT_IMAGE_PUBLIC_PATH.replace(/\/+$/, '')}/`

export interface BattleImageServiceDeps {
  storageRoot?: string
}

export class BattleImageService {
  private storageRoot: string

  constructor(deps: BattleImageServiceDeps = {}) {
    this.storageRoot = deps.storageRoot ?? CHAT_IMAGE_STORAGE_ROOT
  }

  async persistImages(images: BattleUploadImage[] | undefined): Promise<string[]> {
    if (!images || images.length === 0) {
      return []
    }

    await validateChatImages(images)
    await ensureDir(this.storageRoot)

    const now = new Date()
    const year = String(now.getUTCFullYear())
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')

    const relativePaths: string[] = []

    for (const image of images) {
      if (!image?.data || !image?.mime) continue
      const ext = getExtFromMime(image.mime)
      const filename = `${now.getTime()}-${crypto.randomUUID()}.${ext}`
      const relative = normalizeRelativePath(path.join(BATTLE_IMAGE_SUBDIR, year, month, day, filename))
      const absolute = path.join(this.storageRoot, relative)

      await ensureDir(path.dirname(absolute))
      const buffer = Buffer.from(image.data, 'base64')
      await fs.writeFile(absolute, buffer)
      relativePaths.push(relative)
    }

    return relativePaths
  }

  async loadImages(relativePaths: string[] | null | undefined): Promise<BattleUploadImage[]> {
    if (!relativePaths || relativePaths.length === 0) {
      return []
    }

    const loaded: BattleUploadImage[] = []
    for (const rel of relativePaths) {
      const normalized = normalizeRelativePath(rel || '')
      if (!normalized || normalized.includes('..') || !normalized.startsWith(`${BATTLE_IMAGE_SUBDIR}/`)) {
        continue
      }
      const absolute = path.join(this.storageRoot, normalized)
      try {
        const buf = await fs.readFile(absolute)
        loaded.push({
          data: buf.toString('base64'),
          mime: resolveMimeByExt(normalized),
        })
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          console.warn('[battle-image-service] read image failed', {
            relativePath: normalized,
            error: error?.message || error,
          })
        }
      }
    }

    return loaded
  }

  resolveImageUrls(relativePaths: string[] | null | undefined, options?: {
    request?: Request
    siteBaseUrl?: string | null
    baseUrl?: string | null
  }) {
    if (!relativePaths || relativePaths.length === 0) {
      return []
    }

    let baseUrl = (options?.baseUrl || '').trim()
    if (!baseUrl && options?.request) {
      baseUrl = determineChatImageBaseUrl({
        request: options.request,
        siteBaseUrl: options.siteBaseUrl ?? null,
      })
    }

    return resolveChatImageUrls(relativePaths, baseUrl)
  }

  extractRelativePath(urlOrPath: string | null | undefined): string | null {
    if (!urlOrPath) return null
    const raw = String(urlOrPath).trim()
    if (!raw) return null

    let pathname = raw
    if (/^https?:\/\//i.test(raw)) {
      try {
        pathname = new URL(raw).pathname
      } catch {
        return null
      }
    }

    pathname = pathname.split('?')[0]?.split('#')[0] || ''
    pathname = pathname.replace(/\\/g, '/')

    if (pathname.startsWith(normalizePublicPrefix)) {
      pathname = pathname.slice(normalizePublicPrefix.length)
    } else {
      pathname = pathname.replace(/^\/+/, '')
    }

    const normalized = normalizeRelativePath(pathname)
    if (!normalized || !normalized.startsWith(`${BATTLE_IMAGE_SUBDIR}/`)) {
      return null
    }

    if (normalized.includes('..')) {
      return null
    }

    return normalized
  }

  resolveKeptRelativePaths(keepImages: string[] | undefined, existingRelativePaths: string[]) {
    if (!Array.isArray(keepImages) || keepImages.length === 0) {
      return []
    }

    const existingSet = new Set(existingRelativePaths)
    const kept = new Set<string>()
    for (const item of keepImages) {
      const relative = this.extractRelativePath(item)
      if (!relative) continue
      if (existingSet.has(relative)) {
        kept.add(relative)
      }
    }

    return Array.from(kept)
  }

  async deleteImages(relativePaths: string[] | null | undefined): Promise<void> {
    if (!relativePaths || relativePaths.length === 0) {
      return
    }

    for (const rel of relativePaths) {
      const normalized = normalizeRelativePath(rel || '')
      if (!normalized || normalized.includes('..') || !normalized.startsWith(`${BATTLE_IMAGE_SUBDIR}/`)) {
        continue
      }
      const absolute = path.resolve(path.join(this.storageRoot, normalized))
      if (!isPathWithinRoot(this.storageRoot, absolute)) {
        continue
      }
      try {
        await fs.unlink(absolute)
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          console.warn('[battle-image-service] delete image failed', {
            relativePath: normalized,
            error: error?.message || error,
          })
        }
      }
    }
  }
}

let battleImageService = new BattleImageService()

export const setBattleImageService = (service: BattleImageService) => {
  battleImageService = service
}

export { battleImageService }
