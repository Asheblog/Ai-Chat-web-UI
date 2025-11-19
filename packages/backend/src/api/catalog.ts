import { Hono } from 'hono'
import type { ApiResponse } from '../types'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import { modelCatalogService, ModelCatalogServiceError } from '../services/catalog'

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
    const list = await modelCatalogService.listModels()
    return c.json<ApiResponse>({ success: true, data: list })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch models', 'List catalog models error:')
  }
})

catalog.post('/models/refresh', requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    await modelCatalogService.refreshAllModels()
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
    await modelCatalogService.saveOverride({
      connectionId,
      rawId,
      tagsInput: body.tags,
      capabilitiesInput: body.capabilities,
      maxOutputTokens,
      contextWindow,
    })
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
    const count = await modelCatalogService.deleteOverrides({
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
    const data = await modelCatalogService.exportOverrides()
    return c.json<ApiResponse>({ success: true, data })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to export overrides', 'Export catalog overrides error:')
  }
})

export default catalog
