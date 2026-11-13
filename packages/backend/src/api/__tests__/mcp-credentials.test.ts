jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    const role = (c.req.header('x-role') || 'USER').toUpperCase()
    if (role === 'ANONYMOUS') {
      c.set('actor', { type: 'anonymous', key: 'anon', identifier: 'anonymous:anon' })
    } else {
      c.set('actor', { type: 'user', id: 1, role, status: 'ACTIVE', username: 'tester', identifier: 'user:1' })
    }
    await next()
  },
  requireUserActor: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.type !== 'user') return c.json({ success: false, error: '需要登录' }, 401)
    await next()
  },
  adminOnlyMiddleware: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.role !== 'ADMIN') return c.json({ success: false, error: 'Admin required' }, 403)
    await next()
  },
}))

import { Hono } from 'hono'
import { createMcpApi } from '../mcp'

const buildApp = (options: {
  connection: any
  secretVaultId?: number | null
  secretScope?: { scope: string; scopeId: string }
}) => {
  const svc = {
    listConnections: jest.fn().mockResolvedValue([
      { id: 22, ownerUserId: options.connection.ownerUserId },
    ]),
    getConnection: jest.fn().mockResolvedValue({ ...options.connection, secretVaultId: options.secretVaultId ?? null }),
    updateConnection: jest.fn().mockResolvedValue({}),
  }
  const secretVault = {
    createSecret: jest.fn().mockResolvedValue({ id: 77 }),
    updateSecretValue: jest.fn().mockResolvedValue(undefined),
    getSecretView: jest.fn().mockResolvedValue({
      id: options.secretVaultId ?? 77,
      scope: options.secretScope?.scope ?? 'user',
      scopeId: options.secretScope?.scopeId ?? '1',
    }),
  }
  const app = new Hono()
  app.route('/api/mcp', createMcpApi({ mcpService: svc as any, secretVault: secretVault as any }))
  return { app, svc, secretVault }
}

const post = (app: Hono, body: unknown, role = 'USER') =>
  app.request('/api/mcp/connections/22/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-role': role },
    body: JSON.stringify(body),
  })

describe('POST /api/mcp/connections/:id/credentials', () => {
  it('creates a vault secret and links it to the connection', async () => {
    const { app, svc, secretVault } = buildApp({ connection: { id: 22, name: 'demo', ownerUserId: 1 } })
    const response = await post(app, { env: { GITHUB_TOKEN: 'secret-value' } })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.data.secretVaultId).toBe(77)
    expect(secretVault.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        scopeId: '1',
        kind: 'mcp_credential',
        value: JSON.stringify({ env: { GITHUB_TOKEN: 'secret-value' }, headers: {} }),
        refId: '22',
        refType: 'mcp_connection',
      }),
    )
    expect(svc.updateConnection).toHaveBeenCalledWith(22, { secretVaultId: 77 })
  })

  it('updates the existing secret instead of creating a second one', async () => {
    const { app, svc, secretVault } = buildApp({
      connection: { id: 22, name: 'demo', ownerUserId: 1 },
      secretVaultId: 55,
      secretScope: { scope: 'user', scopeId: '1' },
    })
    const response = await post(app, { env: { TOKEN: 'v2' } })
    expect(response.status).toBe(200)
    expect(secretVault.updateSecretValue).toHaveBeenCalledWith(55, JSON.stringify({ env: { TOKEN: 'v2' }, headers: {} }))
    expect(secretVault.createSecret).not.toHaveBeenCalled()
    expect(svc.updateConnection).not.toHaveBeenCalled()
  })

  it('rejects a system-shared connection for non-admins', async () => {
    const { app, secretVault } = buildApp({ connection: { id: 22, name: 'demo', ownerUserId: null } })
    const response = await post(app, { env: { TOKEN: 'x' } })
    expect(response.status).toBe(403)
    expect(secretVault.createSecret).not.toHaveBeenCalled()
  })

  it('lets admins configure a system-shared connection', async () => {
    const { app, secretVault } = buildApp({ connection: { id: 22, name: 'demo', ownerUserId: null } })
    const response = await post(app, { env: { TOKEN: 'x' } }, 'ADMIN')
    expect(response.status).toBe(200)
    expect(secretVault.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'system', scopeId: 'system' }),
    )
  })

  it('refuses to overwrite a secret owned by someone else', async () => {
    const { app, secretVault } = buildApp({
      connection: { id: 22, name: 'demo', ownerUserId: 1 },
      secretVaultId: 55,
      secretScope: { scope: 'user', scopeId: '999' },
    })
    const response = await post(app, { env: { TOKEN: 'x' } })
    expect(response.status).toBe(403)
    expect(secretVault.updateSecretValue).not.toHaveBeenCalled()
  })

  it('rejects an empty payload', async () => {
    const { app } = buildApp({ connection: { id: 22, name: 'demo', ownerUserId: 1 } })
    const response = await post(app, {})
    expect(response.status).toBe(400)
  })

  it('requires a logged-in actor', async () => {
    const { app } = buildApp({ connection: { id: 22, name: 'demo', ownerUserId: 1 } })
    const response = await post(app, { env: { TOKEN: 'x' } }, 'ANONYMOUS')
    expect(response.status).toBe(401)
  })
})
