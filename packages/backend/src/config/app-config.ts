import { loadStorageConfig, type StorageConfig } from './storage'

const parseBool = (value: string | undefined | null, defaultValue: boolean) => {
  if (value == null) return defaultValue
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return defaultValue
}

const parseNumber = (value: string | undefined | null, fallback: number) => {
  const parsed = value ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface ServerConfig {
  port: number
  host: string
  displayHost: string
  corsEnabled: boolean
  corsOrigin: string
  cookieSecure: boolean
}

export interface ChatConfig {
  messageDedupeWindowMs: number
}

export interface RetryConfig {
  upstream429Ms: number
  upstream5xxMs: number
}

export interface ModelCatalogConfig {
  ttlSeconds: number
  refreshIntervalMs: number
}

export interface AppConfig {
  server: ServerConfig
  storage: StorageConfig
  chat: ChatConfig
  retry: RetryConfig
  modelCatalog: ModelCatalogConfig
}

export const loadAppConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const port = parseNumber(env.PORT ?? env.BACKEND_PORT, 8001)
  const host = env.HOST || '0.0.0.0'
  const displayHost = env.HOST || env.HOSTNAME || host
  const corsOrigin = env.CORS_ORIGIN || '*'
  const corsEnabled = parseBool(env.ENABLE_CORS, true)
  const cookieSecure = parseBool(env.COOKIE_SECURE, env.NODE_ENV === 'production')

  const storage = loadStorageConfig(env)

  const messageDedupeWindowMs = parseNumber(env.MESSAGE_DEDUPE_WINDOW_MS, 30_000)

  const ttlSeconds = (() => {
    const parsed = parseNumber(env.MODELS_TTL_S, 600)
    return parsed > 0 ? parsed : 600
  })()
  const refreshIntervalMs = (() => {
    const parsed = parseNumber(env.MODELS_REFRESH_INTERVAL_S, ttlSeconds)
    return (parsed > 0 ? parsed : ttlSeconds) * 1000
  })()

  const retry: RetryConfig = {
    upstream429Ms: 15_000,
    upstream5xxMs: 2_000,
  }

  return {
    server: {
      port,
      host,
      displayHost,
      corsEnabled,
      corsOrigin,
      cookieSecure,
    },
    storage,
    chat: {
      messageDedupeWindowMs,
    },
    retry,
    modelCatalog: {
      ttlSeconds,
      refreshIntervalMs,
    },
  }
}

const defaultConfig = loadAppConfig()

export const getAppConfig = () => defaultConfig
