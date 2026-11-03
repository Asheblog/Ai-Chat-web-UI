jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => { c.set('actor', { type: 'user', id: 1, role: c.req.header('x-role') || 'ADMIN', identifier: 'user:1' }); await next() },
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (c: any, next: any) => c.get('actor').role === 'ADMIN' ? next() : c.json({ success: false }, 403),
}))
jest.mock('../../services/python-runtime', () => ({ PythonRuntimeServiceError: class extends Error {} }))
jest.mock('../../services/settings/settings-facade', () => ({ SettingsServiceError: class extends Error {}, HealthServiceError: class extends Error {} }))

import { createSettingsApi } from '../settings'

describe('DeepSeek system settings HTTP boundary', () => {
  const setup = () => {
    const updateSystemSettings = jest.fn(async () => undefined)
    const app = createSettingsApi({ settingsFacade: { updateSystemSettings } as any, pythonRuntimeService: {} as any, visionProxyService: {} as any })
    return { app, updateSystemSettings }
  }

  test.each(['new-search-key', ''])('forwards explicit key %p, Fetch and fifth engine configuration', async key => {
    const { app, updateSystemSettings } = setup()
    const payload = { web_search_api_key_deepseek: key, web_search_deepseek_fetch_enable: true, web_search_enabled_engines: ['tavily', 'brave', 'metaso', 'exa', 'deepseek'], web_search_parallel_max_engines: 5 }
    const response = await app.request('/system', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    expect(response.status).toBe(200)
    expect(updateSystemSettings).toHaveBeenCalledWith(payload)
  })

  test('does not synthesize an omitted key or accept an internal vault reference', async () => {
    const { app, updateSystemSettings } = setup()
    const response = await app.request('/system', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ web_search_deepseek_fetch_enable: false, web_search_deepseek_secret_id: '99' }) })
    expect(response.status).toBe(200)
    expect(updateSystemSettings).toHaveBeenCalledWith({ web_search_deepseek_fetch_enable: false })
  })

  test('rejects writes by non-admin users', async () => {
    const { app, updateSystemSettings } = setup()
    const response = await app.request('/system', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-role': 'USER' }, body: JSON.stringify({ web_search_api_key_deepseek: 'key' }) })
    expect(response.status).toBe(403)
    expect(updateSystemSettings).not.toHaveBeenCalled()
  })
})
