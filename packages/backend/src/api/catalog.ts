import { Hono } from 'hono'
import type { ApiResponse } from '../types'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import { modelCatalogService, ModelCatalogServiceError } from '../services/catalog'
import type { ModelCatalogService } from '../services/catalog/model-catalog-service'

export interface CatalogApiDeps {
  modelCatalogService?: ModelCatalogService
}

export const createCatalogApi = (deps: CatalogApiDeps = {}) => {
  const svc = deps.modelCatalogService ?? modelCatalogService
  const catalog = new Hono()

catalog.use('*', actorMiddleware)

const toPositiveIntOrNull = (value: unknown, field: string): number | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.trim(), 10) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ModelCatalogServiceError(`${field} must be a positive integer or null`)
  }
  return Math.floor(numeric)
}

const normalizeAccessPolicyInput = (
  input: unknown,
): { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' } | null | undefined => {
  if (input === undefined) return undefined
  if (input === null) return null
  if (typeof input !== 'object') {
    throw new ModelCatalogServiceError('access_policy must be an object or null')
  }
  const accepts = (value: any) => value === 'allow' || value === 'deny' || value === 'inherit'
  const payload: Record<string, any> = input as any
  const normalized: Record<string, 'allow' | 'deny' | 'inherit'> = {}
  if (accepts(payload.anonymous)) normalized.anonymous = payload.anonymous
  if (accepts(payload.user)) normalized.user = payload.user
  return Object.keys(normalized).length ? (normalized as any) : null
}

const normalizeTemperatureInput = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 2) {
    throw new ModelCatalogServiceError('temperature must be between 0 and 2')
  }
  return numeric
}

const handleServiceError = (
  c: any,
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
) => {
  if (error instanceof ModelCatalogServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error(logLabel, error)
  return c.json<ApiResponse>({ success: false, error: fallbackMessage }, 500)
}

catalog.get('/models', async (c) => {
  try {
    const list = await svc.listModels(c.get('actor'))
    return c.json<ApiResponse>({ success: true, data: list })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch models', 'List catalog models error:')
  }
})

catalog.post('/models/refresh', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    await svc.refreshAllModels()
    return c.json<ApiResponse>({ success: true, message: 'Refreshed' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to refresh models', 'Manual refresh models error:')
  }
})

catalog.put('/models/tags', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    const connectionId = Number(body.connectionId)
    const rawId = typeof body.rawId === 'string' ? body.rawId : ''
    if (!Number.isFinite(connectionId) || connectionId <= 0) {
      return c.json<ApiResponse>({ success: false, error: 'connectionId/rawId required' }, 400)
    }
    if (!rawId.trim()) {
      return c.json<ApiResponse>({ success: false, error: 'connectionId/rawId required' }, 400)
    }
    const maxOutputTokens = toPositiveIntOrNull(body.max_output_tokens, 'max_output_tokens')
    const contextWindow = toPositiveIntOrNull(body.context_window, 'context_window')
    const temperature = normalizeTemperatureInput(body.temperature)
    const accessPolicy = normalizeAccessPolicyInput(body.access_policy)
    const payload: any = {
      connectionId,
      rawId,
      tagsInput: body.tags,
      capabilitiesInput: body.capabilities,
      maxOutputTokens,
      contextWindow,
      temperature,
    }
    if (accessPolicy !== undefined) {
      payload.accessPolicyInput = accessPolicy
    }
    await svc.saveOverride(payload)
    return c.json<ApiResponse>({ success: true, message: 'Saved' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to save tags', 'Save catalog override error:')
  }
})

catalog.delete('/models/tags', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    let body: any = {}
    try {
      body = await c.req.json()
    } catch {}
    const all = Boolean(body?.all)
    const count = await svc.deleteOverrides({
      all,
      items: body?.items,
    })
    return c.json<ApiResponse>({ success: true, message: `Deleted ${count} overrides` })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to delete overrides', 'Delete catalog overrides error:')
  }
})

catalog.get('/models/overrides', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const data = await svc.exportOverrides()
    return c.json<ApiResponse>({ success: true, data })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to export overrides', 'Export catalog overrides error:')
  }
})

  return catalog
}

export default createCatalogApi()
