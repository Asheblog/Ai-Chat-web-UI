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

  it('writes the renewed token cookie returned by the context service', async () => {
    const authContextService = {
      resolveActor: jest.fn().mockResolvedValue({
        actor: {
          type: 'user',
          id: 7,
          username: 'alice',
          role: 'USER',
          status: 'ACTIVE',
          identifier: 'user:7',
          preferredModel: null,
          avatarPath: null,
          personalPrompt: null,
        },
        authCookie: { token: 'renewed-token', maxAge: 30 * 24 * 60 * 60 },
      }),
    }
    const { actorMiddleware } = createAuthMiddleware({
      config: makeConfig(true),
      authContextService: authContextService as any,
    })
    const app = new Hono()
    app.use('*', actorMiddleware)
    app.get('/', (c) => c.text('ok'))

    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    const cookieHeader = res.headers.get('set-cookie') || ''
    expect(cookieHeader).toContain('token=renewed-token')
    expect(cookieHeader).toMatch(/max-age=2592000/i)
    expect(cookieHeader).toContain('HttpOnly')
    expect(cookieHeader).toContain('Secure')
  })

  it('leaves the token cookie untouched when no renewal is needed', async () => {
    const authContextService = {
      resolveActor: jest.fn().mockResolvedValue({
        actor: {
          type: 'user',
          id: 7,
          username: 'alice',
          role: 'USER',
          status: 'ACTIVE',
          identifier: 'user:7',
          preferredModel: null,
          avatarPath: null,
          personalPrompt: null,
        },
        authCookie: null,
      }),
    }
    const { actorMiddleware } = createAuthMiddleware({
      config: makeConfig(false),
      authContextService: authContextService as any,
    })
    const app = new Hono()
    app.use('*', actorMiddleware)
    app.get('/', (c) => c.text('ok'))

    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
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
