import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { ApiResponse, Actor } from '../types'
import { actorMiddleware } from '../middleware/auth'
import { battleService, BattleService } from '../services/battle/battle-service'

export interface BattleApiDeps {
  battleService?: BattleService
}

const headerSchema = z.object({
  name: z.string().transform((v) => v.trim()).refine((v) => v.length > 0 && v.length <= 64),
  value: z.string().transform((v) => v.trim()).refine((v) => v.length <= 2048),
})

const featureSchema = z.object({
  web_search: z.boolean().optional(),
  web_search_scope: z.enum(['webpage', 'document', 'paper', 'image', 'video', 'podcast']).optional(),
  web_search_include_summary: z.boolean().optional(),
  web_search_include_raw: z.boolean().optional(),
  web_search_size: z.number().int().min(1).max(10).optional(),
  python_tool: z.boolean().optional(),
}).optional()

const battleModelSchema = z.object({
  modelId: z.string().min(1),
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
  features: featureSchema,
  custom_body: z.record(z.any()).optional(),
  custom_headers: z.array(headerSchema).max(10).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
})

const battleStreamSchema = z.object({
  title: z.string().max(200).optional(),
  prompt: z.string().min(1).max(10000),
  expectedAnswer: z.string().min(1).max(10000),
  judge: z.object({
    modelId: z.string().min(1),
    connectionId: z.number().int().positive().optional(),
    rawId: z.string().min(1).optional(),
  }),
  judgeThreshold: z.number().min(0).max(1).optional(),
  runsPerModel: z.number().int().min(1).max(3),
  passK: z.number().int().min(1).max(3),
  models: z.array(battleModelSchema).min(1).max(8),
  maxConcurrency: z.number().int().min(1).max(6).optional(),
}).refine((value) => value.passK <= value.runsPerModel, {
  message: 'passK must be <= runsPerModel',
})

const shareSchema = z.object({
  title: z.string().max(200).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
})

const parsePagination = (value: string | null, fallback: number) => {
  const parsed = parseInt(value || '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallback
}

export const createBattleApi = (deps: BattleApiDeps = {}) => {
  const svc = deps.battleService ?? battleService
  const router = new Hono()

  router.post('/stream', actorMiddleware, zValidator('json', battleStreamSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')

    const sseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {}
        }

        try {
          await svc.executeRun(actor, payload, {
            emitEvent: (event) => send(event),
          })
          send({ type: 'complete' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Battle failed'
          send({ type: 'error', error: message })
        } finally {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          } catch {}
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders })
  })

  router.get('/runs', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const page = parsePagination(c.req.query('page'), 1)
      const limit = parsePagination(c.req.query('limit'), 20)
      const result = await svc.listRuns(actor, { page, limit })
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch battle runs' }, 500)
    }
  })

  router.get('/runs/:id', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const detail = await svc.getRun(actor, runId)
      if (!detail) {
        return c.json<ApiResponse>({ success: false, error: 'Battle run not found' }, 404)
      }
      return c.json<ApiResponse<typeof detail>>({ success: true, data: detail })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch battle run' }, 500)
    }
  })

  router.delete('/runs/:id', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const deleted = await svc.deleteRun(actor, runId)
      if (!deleted) {
        return c.json<ApiResponse>({ success: false, error: 'Battle run not found' }, 404)
      }
      return c.json<ApiResponse>({ success: true, message: 'Battle run deleted' })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete battle run' }, 500)
    }
  })

  router.post('/runs/:id/cancel', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const result = await svc.cancelRun(actor, runId)
      if (!result) {
        return c.json<ApiResponse>({ success: false, error: 'Battle run not found' }, 404)
      }
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to cancel battle run' }, 500)
    }
  })

  router.post('/runs/:id/share', actorMiddleware, zValidator('json', shareSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const payload = c.req.valid('json')
      const share = await svc.createShare(actor, {
        runId,
        title: payload.title,
        expiresInHours: payload.expiresInHours ?? null,
      })
      return c.json<ApiResponse<typeof share>>({ success: true, data: share })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create share'
      return c.json<ApiResponse>({ success: false, error: message }, 500)
    }
  })

  router.get('/shares/:token', async (c) => {
    try {
      const token = c.req.param('token')
      if (!token) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid token' }, 400)
      }
      const share = await svc.getShareByToken(token)
      if (!share) {
        return c.json<ApiResponse>({ success: false, error: 'Share not found' }, 404)
      }
      return c.json<ApiResponse<typeof share>>({ success: true, data: share })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch share' }, 500)
    }
  })

  return router
}

export default createBattleApi()
