jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (_c: any, next: any) => next(),
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import { createCatalogApi } from '../catalog'
import type { ModelCatalogService } from '../../services/catalog/model-catalog-service'

const buildApp = () => {
  const service = {
    saveOverride: jest.fn().mockResolvedValue(undefined),
    deleteOverrides: jest.fn().mockResolvedValue(1),
    listModels: jest.fn(),
    exportOverrides: jest.fn(),
    refreshAllModels: jest.fn(),
  }
  return {
    service,
    app: createCatalogApi({ modelCatalogService: service as unknown as ModelCatalogService }),
  }
}

describe('catalog override API contract', () => {
  test('forwards the requested override scopes on delete instead of always clearing the row', async () => {
    const { app, service } = buildApp()
    const response = await app.request('http://localhost/models/tags', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ connectionId: 3, rawId: 'gpt-4o', fields: ['parameters'] }],
      }),
    })
    expect(response.status).toBe(200)
    expect(service.deleteOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ connectionId: 3, rawId: 'gpt-4o', fields: ['parameters'] }],
      }),
    )
  })

  test('saves capability, parameter and access overrides independently and ignores retired tag writes', async () => {
    const { app, service } = buildApp()
    const response = await app.request('http://localhost/models/tags', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 3,
        rawId: 'gpt-4o',
        capabilities: { vision: true },
        context_window: 128000,
        access_policy: { user: 'allow' },
        tags: [{ name: 'vision' }],
      }),
    })
    expect(response.status).toBe(200)
    const payload = service.saveOverride.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        connectionId: 3,
        rawId: 'gpt-4o',
        capabilitiesInput: { vision: true },
        contextWindow: 128000,
        accessPolicyInput: { user: 'allow' },
      }),
    )
    expect(Object.prototype.hasOwnProperty.call(payload, 'tagsInput')).toBe(false)
  })
})
