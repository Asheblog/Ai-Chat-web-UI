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
  })
})
