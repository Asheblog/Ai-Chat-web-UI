import path from 'node:path'

export interface StorageConfig {
  root: string
  publicPath: string
  defaultRetentionDays: number
  baseUrl: string
}

const normalizePublicPath = (rawPublicPath: string) =>
  rawPublicPath.startsWith('/')
    ? rawPublicPath.replace(/\/+$/, '')
    : `/${rawPublicPath.replace(/\/+$/, '')}`

const parseRetentionDays = (raw?: string | null) => {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30
}

const normalizeBaseUrl = (raw?: string | null) => (raw || '').trim().replace(/\/+$/, '')

export const loadStorageConfig = (env: NodeJS.ProcessEnv = process.env): StorageConfig => {
  /** 根目录：用于存放聊天图片附件。默认存放在项目根目录下的 storage/chat-images。 */
  const rawStorageDir = env.CHAT_IMAGE_DIR || path.join('storage', 'chat-images')
  const root = path.isAbsolute(rawStorageDir) ? rawStorageDir : path.join(process.cwd(), rawStorageDir)

  /** 图片对外访问路径前缀，默认挂载在 /chat-images。 */
  const publicPath = normalizePublicPath(env.CHAT_IMAGE_PUBLIC_PATH || '/chat-images')

  /** 图片保存天数上限，作为系统设置缺省值。 */
  const defaultRetentionDays = parseRetentionDays(env.CHAT_IMAGE_RETENTION_DAYS)

  /** 图片访问基础域名（含协议），可通过系统设置覆盖。 */
  const baseUrl = normalizeBaseUrl(env.CHAT_IMAGE_BASE_URL)

  return { root, publicPath, defaultRetentionDays, baseUrl }
}

// 默认配置，向下兼容原常量用法
const storageConfig = loadStorageConfig()
export const CHAT_IMAGE_STORAGE_ROOT = storageConfig.root
export const CHAT_IMAGE_PUBLIC_PATH = storageConfig.publicPath
export const CHAT_IMAGE_DEFAULT_RETENTION_DAYS = storageConfig.defaultRetentionDays
export const CHAT_IMAGE_BASE_URL = storageConfig.baseUrl
