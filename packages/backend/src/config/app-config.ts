import { loadStorageConfig, type StorageConfig } from './storage'
import path from 'node:path'

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

export interface WorkspaceConfig {
  rootDir: string
  artifactTtlMinutes: number
  idleTtlMinutes: number
  cleanupIntervalMs: number
  maxWorkspaceBytes: number
  maxArtifactBytes: number
  maxArtifactsPerMessage: number
  runTimeoutMs: number
  dockerImage: string
  dockerCpu: string
  dockerMemory: string
  dockerPidsLimit: number
  artifactSigningSecret: string
  listMaxEntries: number
  readMaxChars: number
  gitCloneTimeoutMs: number
  pythonInstallTimeoutMs: number
  runNetworkMode: 'none' | 'default'
}

export interface AppConfig {
  server: ServerConfig
  storage: StorageConfig
  chat: ChatConfig
  retry: RetryConfig
  modelCatalog: ModelCatalogConfig
  workspace: WorkspaceConfig
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

  const appDataRoot = env.APP_DATA_DIR || env.DATA_DIR || path.resolve(process.cwd(), 'data')
  const workspaceRootDir = path.resolve(
    env.WORKSPACE_ROOT_DIR || path.join(appDataRoot, 'workspaces', 'chat'),
  )
  const artifactTtlMinutes = (() => {
    const parsed = parseNumber(env.WORKSPACE_ARTIFACT_TTL_MINUTES, 60)
    return Math.max(1, Math.min(parsed, 7 * 24 * 60))
  })()
  const idleTtlMinutes = (() => {
    const parsed = parseNumber(env.WORKSPACE_IDLE_TTL_MINUTES, 1440)
    return Math.max(5, Math.min(parsed, 30 * 24 * 60))
  })()
  const cleanupIntervalMs = (() => {
    const parsed = parseNumber(env.WORKSPACE_CLEANUP_INTERVAL_MINUTES, 5)
    return Math.max(1, parsed) * 60_000
  })()
  const maxWorkspaceBytes = (() => {
    const parsed = parseNumber(env.WORKSPACE_MAX_BYTES, 1024 * 1024 * 1024)
    return Math.max(1024 * 1024, parsed)
  })()
  const maxArtifactBytes = (() => {
    const parsed = parseNumber(env.WORKSPACE_ARTIFACT_MAX_BYTES, 100 * 1024 * 1024)
    return Math.max(1024 * 1024, parsed)
  })()
  const maxArtifactsPerMessage = (() => {
    const parsed = parseNumber(env.WORKSPACE_MAX_ARTIFACTS_PER_MESSAGE, 20)
    return Math.max(1, Math.min(parsed, 100))
  })()
  const runTimeoutMs = (() => {
    const parsed = parseNumber(env.WORKSPACE_RUN_TIMEOUT_MS, 120_000)
    return Math.max(1000, Math.min(parsed, 10 * 60_000))
  })()
  const dockerImage = (env.WORKSPACE_DOCKER_IMAGE || 'python:3.11-slim').trim()
  const dockerCpu = (env.WORKSPACE_DOCKER_CPUS || '1.0').trim() || '1.0'
  const dockerMemory = (env.WORKSPACE_DOCKER_MEMORY || '1g').trim() || '1g'
  const dockerPidsLimit = (() => {
    const parsed = parseNumber(env.WORKSPACE_DOCKER_PIDS_LIMIT, 256)
    return Math.max(32, Math.min(parsed, 8192))
  })()
  const artifactSigningSecret =
    (env.WORKSPACE_ARTIFACT_SIGNING_SECRET || env.JWT_SECRET || '').trim() ||
    'workspace-artifact-dev-secret-change-me'
  const listMaxEntries = (() => {
    const parsed = parseNumber(env.WORKSPACE_LIST_MAX_ENTRIES, 500)
    return Math.max(10, Math.min(parsed, 5000))
  })()
  const readMaxChars = (() => {
    const parsed = parseNumber(env.WORKSPACE_READ_MAX_CHARS, 120_000)
    return Math.max(1024, Math.min(parsed, 2_000_000))
  })()
  const gitCloneTimeoutMs = (() => {
    const parsed = parseNumber(env.WORKSPACE_GIT_CLONE_TIMEOUT_MS, 120_000)
    return Math.max(5000, Math.min(parsed, 10 * 60_000))
  })()
  const pythonInstallTimeoutMs = (() => {
    const parsed = parseNumber(env.WORKSPACE_PYTHON_INSTALL_TIMEOUT_MS, 300_000)
    return Math.max(10_000, Math.min(parsed, 30 * 60_000))
  })()
  const runNetworkMode = (() => {
    const normalized = (env.WORKSPACE_RUN_NETWORK_MODE || 'none').trim().toLowerCase()
    if (['default', 'bridge', 'on', 'enabled', 'true', '1'].includes(normalized)) {
      return 'default' as const
    }
    return 'none' as const
  })()

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
    workspace: {
      rootDir: workspaceRootDir,
      artifactTtlMinutes,
      idleTtlMinutes,
      cleanupIntervalMs,
      maxWorkspaceBytes,
      maxArtifactBytes,
      maxArtifactsPerMessage,
      runTimeoutMs,
      dockerImage,
      dockerCpu,
      dockerMemory,
      dockerPidsLimit,
      artifactSigningSecret,
      listMaxEntries,
      readMaxChars,
      gitCloneTimeoutMs,
      pythonInstallTimeoutMs,
      runNetworkMode,
    },
  }
}

const defaultConfig = loadAppConfig()

export const getAppConfig = () => defaultConfig
