import { Hono } from 'hono'
import { createAuthMiddleware } from '../auth'
import type { AppConfig } from '../../config/app-config'

const makeConfig = (secure: boolean): AppConfig => ({
  server: {
    port: 3001,
    host: '0.0.0.0',
    displayHost: 'localhost',
    corsEnabled: true,
    corsOrigin: '*',
    cookieSecure: secure,
  },
  storage: {
    root: '/tmp',
    publicPath: '/static',
    defaultRetentionDays: 7,
    baseUrl: '',
  },
  chat: { messageDedupeWindowMs: 1000 },
  retry: { upstream429Ms: 1000, upstream5xxMs: 2000 },
  modelCatalog: { ttlSeconds: 600, refreshIntervalMs: 600000 },
})

const buildAuthContextService = () => ({
  resolveActor: jest.fn().mockResolvedValue({
    actor: { type: 'anonymous', key: 'k', identifier: 'anon:k' },
    anonCookie: { key: 'anon-key', retentionDays: 1 },
  }),
})

describe('auth middleware factory', () => {
  it('sets secure flag from injected config when issuing anon cookie', async () => {
    const authContextService = buildAuthContextService()
    const { actorMiddleware } = createAuthMiddleware({
      config: makeConfig(true),
      authContextService,
    })
    const app = new Hono()
    app.use('*', actorMiddleware)
    app.get('/', (c) => c.text('ok'))

    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    const cookieHeader = res.headers.get('set-cookie') || ''
    expect(cookieHeader).toContain('Secure')
  })

  it('omits secure flag when config disables it', async () => {
    const authContextService = buildAuthContextService()
    const { actorMiddleware } = createAuthMiddleware({
      config: makeConfig(false),
      authContextService,
    })
    const app = new Hono()
    app.use('*', actorMiddleware)
    app.get('/', (c) => c.text('ok'))

    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    const cookieHeader = res.headers.get('set-cookie') || ''
    expect(cookieHeader).not.toContain('Secure')
  })
})
