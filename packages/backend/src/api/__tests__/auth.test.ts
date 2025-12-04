import { createAuthApi } from '../auth'
import type { AppConfig } from '../../config/app-config'
import type { AuthService } from '../../services/auth/auth-service'

const makeConfig = (cookieSecure: boolean): AppConfig => ({
  server: {
    port: 3001,
    host: '0.0.0.0',
    displayHost: 'localhost',
    corsEnabled: true,
    corsOrigin: '*',
    cookieSecure,
  },
  storage: {
    root: '/tmp',
    publicPath: '/static',
    defaultRetentionDays: 30,
    baseUrl: '',
  },
  chat: {
    messageDedupeWindowMs: 1000,
  },
  retry: {
    upstream429Ms: 1000,
    upstream5xxMs: 2000,
  },
  modelCatalog: {
    ttlSeconds: 600,
    refreshIntervalMs: 600000,
  },
})

const createMockAuthService = (): AuthService => {
  const svc: Partial<AuthService> = {
    register: jest.fn(async () => ({
      user: { id: 1, username: 'u', role: 'USER', status: 'ACTIVE', avatarUrl: null, personalPrompt: null },
      token: 't',
    })),
    login: jest.fn(async () => ({
      user: { id: 1, username: 'u', role: 'USER', status: 'ACTIVE', avatarUrl: null, personalPrompt: null },
      token: 't',
    })),
    resolveActorContext: jest.fn(),
    updatePassword: jest.fn(),
  }
  return svc as AuthService
}

describe('auth api', () => {
  it('sets secure cookie when enabled via injected config', async () => {
    const service = createMockAuthService()
    const app = createAuthApi({
      authService: service,
      config: makeConfig(true),
    })

    const res = await app.request('http://localhost/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user1', password: 'password1' }),
    })

    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain('Secure')
  })

  it('omits secure flag when disabled', async () => {
    const service = createMockAuthService()
    const app = createAuthApi({
      authService: service,
      config: makeConfig(false),
    })

    const res = await app.request('http://localhost/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user1', password: 'password1' }),
    })

    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).not.toContain('Secure')
  })
})
