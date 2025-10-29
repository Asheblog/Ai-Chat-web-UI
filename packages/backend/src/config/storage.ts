import path from 'node:path'

/**
 * 根目录：用于存放聊天图片附件。默认存放在项目根目录下的 storage/chat-images。
 * 支持通过 CHAT_IMAGE_DIR 指定绝对路径或相对路径。
 */
const rawStorageDir = process.env.CHAT_IMAGE_DIR || path.join('storage', 'chat-images')
export const CHAT_IMAGE_STORAGE_ROOT = path.isAbsolute(rawStorageDir)
  ? rawStorageDir
  : path.join(process.cwd(), rawStorageDir)

/**
 * 图片对外访问路径前缀。默认挂载在 /chat-images。
 */
const rawPublicPath = process.env.CHAT_IMAGE_PUBLIC_PATH || '/chat-images'
export const CHAT_IMAGE_PUBLIC_PATH = rawPublicPath.startsWith('/')
  ? rawPublicPath.replace(/\/+$/, '')
  : `/${rawPublicPath.replace(/\/+$/, '')}`

/**
 * 图片保存天数上限，作为系统设置缺省值。
 */
export const CHAT_IMAGE_DEFAULT_RETENTION_DAYS = (() => {
  const raw = process.env.CHAT_IMAGE_RETENTION_DAYS
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30
})()

/**
 * 图片访问基础域名（含协议），可通过系统设置覆盖。
 */
export const CHAT_IMAGE_BASE_URL = (() => {
  const raw = (process.env.CHAT_IMAGE_BASE_URL || '').trim()
  return raw.replace(/\/+$/, '')
})()
