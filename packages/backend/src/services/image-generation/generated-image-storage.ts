/**
 * GeneratedImageStorage - AI生成图片存储服务
 *
 * 将 AI 生成的图片（base64）保存到本地文件系统，并记录到数据库。
 * 复用现有的 chat-images 存储基础设施。
 */

import type { PrismaClient } from '@prisma/client'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  CHAT_IMAGE_STORAGE_ROOT,
  CHAT_IMAGE_PUBLIC_PATH,
} from '../../config/storage'
import { BackendLogger as log } from '../../utils/logger'
import type { GeneratedImage } from './types'

/** 生成图片存储子目录 */
const GENERATED_IMAGES_SUBDIR = 'generated'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function getExtFromMime(mime: string): string {
  const key = mime.toLowerCase()
  if (MIME_EXT[key]) return MIME_EXT[key]
  if (key.startsWith('image/')) {
    const fallback = key.split('/')[1]
    if (fallback) return fallback.replace(/[^a-z0-9]+/g, '')
  }
  return 'png' // 默认 png
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export interface GeneratedImageStorageDeps {
  prisma: PrismaClient
  storageRoot?: string
}

export interface SaveGeneratedImagesOptions {
  messageId: number
  sessionId: number
}

export interface SavedGeneratedImage extends GeneratedImage {
  /** 本地存储的相对路径 */
  storagePath: string
  /** 可访问的完整 URL 路径（不含域名） */
  publicPath: string
}

export class GeneratedImageStorage {
  private prisma: PrismaClient
  private storageRoot: string

  constructor(deps: GeneratedImageStorageDeps) {
    this.prisma = deps.prisma
    this.storageRoot = deps.storageRoot ?? CHAT_IMAGE_STORAGE_ROOT
  }

  /**
   * 保存生成的图片到本地文件系统，并记录到数据库
   *
   * @param images AI 生成的图片数组（包含 base64 数据）
   * @param opts 保存选项（messageId, sessionId）
   * @returns 保存后的图片数组（包含 storagePath 和 publicPath）
   */
  async saveImages(
    images: GeneratedImage[],
    opts: SaveGeneratedImagesOptions
  ): Promise<SavedGeneratedImage[]> {
    if (!images || images.length === 0) return []

    const generatedDir = path.join(this.storageRoot, GENERATED_IMAGES_SUBDIR)
    await ensureDir(generatedDir)

    const now = new Date()
    const year = now.getUTCFullYear().toString()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const dateDir = path.join(generatedDir, year, month, day)
    await ensureDir(dateDir)

    const savedImages: SavedGeneratedImage[] = []

    for (let index = 0; index < images.length; index++) {
      const img = images[index]

      // 优先使用 base64 数据，如果只有 url 则跳过保存（保持原样）
      if (!img.base64) {
        // 没有 base64 数据，保持原样（可能是外部 URL）
        savedImages.push({
          ...img,
          storagePath: '',
          publicPath: img.url || '',
        })
        continue
      }

      try {
        const mime = img.mime || 'image/png'
        const ext = getExtFromMime(mime)
        const uuid = crypto.randomUUID()
        const fileName = `${opts.sessionId}-${opts.messageId}-${index}-${uuid}.${ext}`

        // 相对路径: generated/2026/01/05/xxx.png
        const relativePath = [GENERATED_IMAGES_SUBDIR, year, month, day, fileName].join('/')

        // 绝对路径
        const absolutePath = path.join(this.storageRoot, relativePath)

        // 解码并保存
        const buffer = Buffer.from(img.base64, 'base64')
        await fs.writeFile(absolutePath, buffer)

        // 公开访问路径: /chat-images/generated/2026/01/05/xxx.png
        const publicPath = `${CHAT_IMAGE_PUBLIC_PATH}/${relativePath}`

        savedImages.push({
          url: img.url,
          base64: undefined, // 不再传递 base64
          mime,
          revisedPrompt: img.revisedPrompt,
          storagePath: relativePath,
          publicPath,
        })

        log.debug('[GeneratedImageStorage] Saved image', {
          messageId: opts.messageId,
          index,
          relativePath,
        })
      } catch (error) {
        log.error('[GeneratedImageStorage] Failed to save image', {
          messageId: opts.messageId,
          index,
          error,
        })
        // 保存失败时，保持原始 base64 数据
        savedImages.push({
          ...img,
          storagePath: '',
          publicPath: '',
        })
      }
    }

    // 写入数据库记录
    if (savedImages.some((img) => img.storagePath)) {
      try {
        await this.prisma.generatedImage.createMany({
          data: savedImages
            .filter((img) => img.storagePath)
            .map((img) => ({
              messageId: opts.messageId,
              storagePath: img.storagePath,
              mime: img.mime || 'image/png',
              revisedPrompt: img.revisedPrompt,
            })),
        })
        log.debug('[GeneratedImageStorage] Saved to database', {
          messageId: opts.messageId,
          count: savedImages.filter((img) => img.storagePath).length,
        })
      } catch (error) {
        log.error('[GeneratedImageStorage] Failed to save to database', {
          messageId: opts.messageId,
          error,
        })
        // 数据库保存失败不影响图片返回
      }
    }

    return savedImages
  }

  /**
   * 根据基础 URL 生成完整的图片访问 URL
   *
   * @param savedImages 保存后的图片数组
   * @param baseUrl 基础 URL（如 https://example.com）
   * @returns 带完整 URL 的图片数组
   */
  resolveImageUrls(
    savedImages: SavedGeneratedImage[],
    baseUrl: string
  ): GeneratedImage[] {
    const origin = baseUrl.replace(/\/+$/, '')

    return savedImages.map((img) => {
      // 如果有 publicPath，生成完整 URL
      if (img.publicPath) {
        return {
          url: `${origin}${img.publicPath}`,
          mime: img.mime,
          revisedPrompt: img.revisedPrompt,
          // 不再返回 base64
        }
      }

      // 否则保持原样（外部 URL 或保存失败的情况）
      return {
        url: img.url,
        base64: img.base64,
        mime: img.mime,
        revisedPrompt: img.revisedPrompt,
      }
    })
  }
}
