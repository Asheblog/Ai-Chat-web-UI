import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import {
  connectionService,
  ConnectionServiceError,
  type ConnectionService,
} from '../services/connections'

const capabilitySchema = z.object({
  vision: z.boolean().optional(),
  file_upload: z.boolean().optional(),
  web_search: z.boolean().optional(),
  image_generation: z.boolean().optional(),
  code_interpreter: z.boolean().optional(),
})

const connectionSchema = z.object({
  provider: z.enum(['openai', 'azure_openai', 'ollama', 'google_genai']),
  baseUrl: z.string().url(),
  enable: z.boolean().optional().default(true),
  authType: z.enum(['bearer', 'none', 'session', 'system_oauth', 'microsoft_entra_id']).optional().default('bearer'),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  azureApiVersion: z.string().optional(),
  prefixId: z.string().optional(),
  tags: z.array(z.object({ name: z.string() })).optional(),
  modelIds: z.array(z.string()).optional(),
  connectionType: z.enum(['external', 'local']).optional(),
  defaultCapabilities: capabilitySchema.partial().optional(),
})

const handleServiceError = (
  c: any,
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
) => {
  if (error instanceof ConnectionServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error(logLabel, error)
  return c.json<ApiResponse>({ success: false, error: fallbackMessage }, 500)
}

export const createConnectionsApi = (deps: { connectionService?: ConnectionService } = {}) => {
  const service = deps.connectionService ?? connectionService
  const router = new Hono()

  router.use('*', actorMiddleware)

  router.get('/', requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const rows = await service.listSystemConnections()
      return c.json<ApiResponse>({ success: true, data: rows })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list connections', 'List connections error:')
    }
  })

  router.post(
    '/',
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', connectionSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        const row = await service.createSystemConnection(payload)
        return c.json<ApiResponse>({ success: true, data: row, message: 'Connection created' })
      } catch (error) {
        return handleServiceError(c, error, 'Failed to create connection', 'Create connection error:')
      }
    },
  )

  router.put(
    '/:id',
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', connectionSchema.partial()),
    async (c) => {
      try {
        const id = parseInt(c.req.param('id'), 10)
        if (Number.isNaN(id)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid connection id' }, 400)
        }
        const payload = c.req.valid('json')
        const row = await service.updateSystemConnection(id, payload)
        return c.json<ApiResponse>({ success: true, data: row, message: 'Connection updated' })
      } catch (error) {
        return handleServiceError(c, error, 'Failed to update connection', 'Update connection error:')
      }
    },
  )

  router.delete('/:id', requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(id)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid connection id' }, 400)
      }
      await service.deleteSystemConnection(id)
      return c.json<ApiResponse>({ success: true, message: 'Connection deleted' })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete connection', 'Delete connection error:')
    }
  })

  router.post('/verify', requireUserActor, zValidator('json', connectionSchema), async (c) => {
    try {
      const payload = c.req.valid('json')
      await service.verifyConnectionConfig(payload)
      return c.json<ApiResponse>({ success: true, message: 'Connection verified' })
    } catch (error) {
      return handleServiceError(c, error, 'Verify failed', 'Verify connection error:')
    }
  })

  return router
}

export default createConnectionsApi()
