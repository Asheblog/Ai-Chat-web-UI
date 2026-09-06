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

  test.each(['openai', 'openai_responses', 'google_genai'])('still accepts %s connections', async (provider) => {
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
})
