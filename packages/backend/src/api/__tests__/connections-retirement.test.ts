jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (_c: any, next: any) => next(),
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import { createConnectionsApi } from '../connections'
import type { ConnectionService } from '../../services/connections'

describe('connection protocol API validation', () => {
  const retiredPayloads = [
    { provider: 'azure_openai', authType: 'bearer' },
    { provider: 'ollama', authType: 'none' },
    { provider: 'openai', authType: 'microsoft_entra_id' },
  ]

  test.each(retiredPayloads)('rejects $provider/$authType on create, edit, verify and import', async (retired) => {
    const service = {
      createSystemConnection: jest.fn(),
      updateSystemConnection: jest.fn(),
      verifyConnectionConfig: jest.fn(),
      importSystemConnections: jest.fn(),
    }
    const app = createConnectionsApi({ connectionService: service as unknown as ConnectionService })
    const payload = { displayName: 'Retired', baseUrl: 'https://example.com', apiKeys: [{ apiKey: 'test' }], ...retired }
    for (const [method, path] of [['POST', '/'], ['PUT', '/1'], ['POST', '/verify'], ['POST', '/import']]) {
      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(path === '/import' ? { schemaVersion: 2, connections: [payload] } : payload),
      })
      expect(response.status).toBe(400)
    }
    for (const handler of Object.values(service)) expect(handler).not.toHaveBeenCalled()
  })

  test.each(['openai', 'openai_responses', 'anthropic', 'google_genai'])('still accepts %s connections', async (provider) => {
    const createSystemConnection = jest.fn().mockResolvedValue({ id: 1 })
    const app = createConnectionsApi({ connectionService: { createSystemConnection } as unknown as ConnectionService })
    const response = await app.request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Supported', provider, baseUrl: 'https://example.com', apiKeys: [{ apiKey: 'test' }] }),
    })
    expect(response.status).toBe(200)
    expect(createSystemConnection).toHaveBeenCalledTimes(1)
  })

  test('rejects the removed session auth on create, edit and verify but still imports it as a pending row', async () => {
    const service = {
      createSystemConnection: jest.fn().mockResolvedValue({ id: 1 }),
      updateSystemConnection: jest.fn().mockResolvedValue({ id: 1 }),
      verifyConnectionConfig: jest.fn().mockResolvedValue({ results: [] }),
      importSystemConnections: jest.fn().mockResolvedValue({ createdGroups: 1 }),
    }
    const app = createConnectionsApi({ connectionService: service as unknown as ConnectionService })
    const payload = {
      displayName: 'Legacy',
      provider: 'openai',
      baseUrl: 'https://example.com',
      authType: 'session',
      apiKeys: [{ apiKey: 'test' }],
    }
    for (const [method, path] of [['POST', '/'], ['PUT', '/1'], ['POST', '/verify']]) {
      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(response.status).toBe(400)
    }
    const imported = await app.request('http://localhost/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 2, connections: [payload] }),
    })
    expect(imported.status).toBe(200)
    // 旧包里的 session 原样透传，由服务层落库为待配置旧行；不在 API 层归一成 bearer。
    expect(service.importSystemConnections).toHaveBeenCalledWith(
      expect.objectContaining({
        connections: [expect.objectContaining({ authType: 'session' })],
      }),
      expect.anything(),
    )
  })

  test('ignores the retired local/external connection type instead of persisting it', async () => {
    const createSystemConnection = jest.fn().mockResolvedValue({ id: 1 })
    const app = createConnectionsApi({ connectionService: { createSystemConnection } as unknown as ConnectionService })
    const response = await app.request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'External',
        provider: 'openai',
        baseUrl: 'https://example.com',
        connectionType: 'local',
        tags: [{ name: 'prod' }],
        apiKeys: [{ apiKey: 'test' }],
      }),
    })
    expect(response.status).toBe(200)
    const payload = createSystemConnection.mock.calls[0][0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'connectionType')).toBe(false)
    expect(payload.tags).toEqual([{ name: 'prod' }])
  })

})