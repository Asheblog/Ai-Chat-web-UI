import path from 'node:path'
import { loadAppConfig } from '../app-config'

describe('app-config', () => {
  it('uses safe defaults when env is empty', () => {
    const cfg = loadAppConfig({})

    expect(cfg.server.port).toBe(8001)
    expect(cfg.server.host).toBe('0.0.0.0')
    expect(cfg.server.displayHost).toBe('0.0.0.0')
    expect(cfg.server.corsEnabled).toBe(true)
    expect(cfg.server.corsOrigin).toBe('*')
    expect(cfg.server.cookieSecure).toBe(false)

    expect(cfg.chat.messageDedupeWindowMs).toBe(30_000)
    expect(cfg.retry.upstream429Ms).toBe(15_000)
    expect(cfg.retry.upstream5xxMs).toBe(2_000)

    expect(cfg.modelCatalog.ttlSeconds).toBe(600)
    expect(cfg.modelCatalog.refreshIntervalMs).toBe(600_000)

    expect(cfg.storage.root).toBe(path.join(process.cwd(), 'storage', 'chat-images'))
    expect(cfg.storage.publicPath).toBe('/chat-images')
    expect(cfg.storage.defaultRetentionDays).toBe(30)
    expect(cfg.storage.baseUrl).toBe('')

    expect(cfg.workspace.rootDir).toBe(path.join(process.cwd(), 'data', 'workspaces', 'chat'))
    expect(cfg.workspace.artifactTtlMinutes).toBe(60)
    expect(cfg.workspace.idleTtlMinutes).toBe(1440)
    expect(cfg.workspace.cleanupIntervalMs).toBe(5 * 60_000)
    expect(cfg.workspace.maxWorkspaceBytes).toBe(1024 * 1024 * 1024)
    expect(cfg.workspace.maxArtifactBytes).toBe(100 * 1024 * 1024)
    expect(cfg.workspace.maxArtifactsPerMessage).toBe(20)
    expect(cfg.workspace.runTimeoutMs).toBe(120_000)
    expect(cfg.workspace.dockerImage).toBe('python:3.11-slim')
    expect(cfg.workspace.runNetworkMode).toBe('none')
  })

  it('parses overrides from env', () => {
    const env = {
      PORT: '1234',
      HOST: '127.0.0.1',
      HOSTNAME: 'ignored-hostname',
      ENABLE_CORS: 'false',
      CORS_ORIGIN: 'https://example.com',
      COOKIE_SECURE: 'true',
      MESSAGE_DEDUPE_WINDOW_MS: '45000',
      MODELS_TTL_S: '1200',
      MODELS_REFRESH_INTERVAL_S: '30',
      CHAT_IMAGE_DIR: 'custom_images',
      CHAT_IMAGE_PUBLIC_PATH: 'imgs',
      CHAT_IMAGE_RETENTION_DAYS: '10',
      CHAT_IMAGE_BASE_URL: 'https://cdn.test/',
      APP_DATA_DIR: '/tmp/aichat-data',
      WORKSPACE_ARTIFACT_TTL_MINUTES: '30',
      WORKSPACE_IDLE_TTL_MINUTES: '300',
      WORKSPACE_CLEANUP_INTERVAL_MINUTES: '2',
      WORKSPACE_MAX_BYTES: '2097152',
      WORKSPACE_ARTIFACT_MAX_BYTES: '1048576',
      WORKSPACE_MAX_ARTIFACTS_PER_MESSAGE: '8',
      WORKSPACE_RUN_TIMEOUT_MS: '90000',
      WORKSPACE_DOCKER_IMAGE: 'python:3.12-slim',
      WORKSPACE_DOCKER_CPUS: '2.0',
      WORKSPACE_DOCKER_MEMORY: '2g',
      WORKSPACE_DOCKER_PIDS_LIMIT: '512',
      WORKSPACE_ARTIFACT_SIGNING_SECRET: 'test-secret',
      WORKSPACE_LIST_MAX_ENTRIES: '300',
      WORKSPACE_READ_MAX_CHARS: '240000',
      WORKSPACE_GIT_CLONE_TIMEOUT_MS: '60000',
      WORKSPACE_PYTHON_INSTALL_TIMEOUT_MS: '400000',
      WORKSPACE_RUN_NETWORK_MODE: 'default',
    } satisfies NodeJS.ProcessEnv

    const cfg = loadAppConfig(env)

    expect(cfg.server.port).toBe(1234)
    expect(cfg.server.host).toBe('127.0.0.1')
    expect(cfg.server.displayHost).toBe('127.0.0.1')
    expect(cfg.server.corsEnabled).toBe(false)
    expect(cfg.server.corsOrigin).toBe('https://example.com')
    expect(cfg.server.cookieSecure).toBe(true)

    expect(cfg.chat.messageDedupeWindowMs).toBe(45_000)
    expect(cfg.modelCatalog.ttlSeconds).toBe(1200)
    expect(cfg.modelCatalog.refreshIntervalMs).toBe(30_000)

    expect(cfg.storage.root).toBe(path.join(process.cwd(), 'custom_images'))
    expect(cfg.storage.publicPath).toBe('/imgs')
    expect(cfg.storage.defaultRetentionDays).toBe(10)
    expect(cfg.storage.baseUrl).toBe('https://cdn.test')

    expect(cfg.workspace.rootDir).toBe(path.join('/tmp/aichat-data', 'workspaces', 'chat'))
    expect(cfg.workspace.artifactTtlMinutes).toBe(30)
    expect(cfg.workspace.idleTtlMinutes).toBe(300)
    expect(cfg.workspace.cleanupIntervalMs).toBe(2 * 60_000)
    expect(cfg.workspace.maxWorkspaceBytes).toBe(2_097_152)
    expect(cfg.workspace.maxArtifactBytes).toBe(1_048_576)
    expect(cfg.workspace.maxArtifactsPerMessage).toBe(8)
    expect(cfg.workspace.runTimeoutMs).toBe(90_000)
    expect(cfg.workspace.dockerImage).toBe('python:3.12-slim')
    expect(cfg.workspace.dockerCpu).toBe('2.0')
    expect(cfg.workspace.dockerMemory).toBe('2g')
    expect(cfg.workspace.dockerPidsLimit).toBe(512)
    expect(cfg.workspace.artifactSigningSecret).toBe('test-secret')
    expect(cfg.workspace.listMaxEntries).toBe(300)
    expect(cfg.workspace.readMaxChars).toBe(240_000)
    expect(cfg.workspace.gitCloneTimeoutMs).toBe(60_000)
    expect(cfg.workspace.pythonInstallTimeoutMs).toBe(400_000)
    expect(cfg.workspace.runNetworkMode).toBe('default')
  })
})
