import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { ApiResponse, Actor } from '../types'
import { actorMiddleware } from '../middleware/auth'
import { battleService, BattleService } from '../services/battle/battle-service'
import { prisma } from '../db'

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
  extraPrompt: z.string().max(4000).optional(),
  custom_body: z.record(z.any()).optional(),
  custom_headers: z.array(headerSchema).max(10).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
})

const BATTLE_TEXT_MAX = 128 * 1024
const BATTLE_TEXT_MAX_LABEL = '128K'
const buildTextLimitMessage = (field: string) =>
  `${field} 长度不能超过 ${BATTLE_TEXT_MAX_LABEL}（${BATTLE_TEXT_MAX} 字符）`

const battleStreamSchema = z.object({
  title: z.string().max(200).optional(),
  prompt: z.string().min(1).max(BATTLE_TEXT_MAX, { message: buildTextLimitMessage('prompt') }),
  expectedAnswer: z.string().min(1).max(BATTLE_TEXT_MAX, { message: buildTextLimitMessage('expectedAnswer') }),
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

const attemptActionSchema = z.object({
  modelId: z.string().min(1).optional(),
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
  attemptIndex: z.number().int().min(1),
}).refine((value) => Boolean(value.modelId || (value.connectionId && value.rawId)), {
  message: 'modelId or connectionId+rawId is required',
})

const shareSchema = z.object({
  title: z.string().max(200).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
})

const judgeRetrySchema = z.object({
  resultIds: z.array(z.number().int().positive()).max(200).optional(),
})

const rejudgeSchema = z.object({
  expectedAnswer: z.string().min(1).max(BATTLE_TEXT_MAX, { message: buildTextLimitMessage('expectedAnswer') }),
  resultIds: z.array(z.number().int().positive()).max(200).optional(),
  judge: z.object({
    modelId: z.string().min(1),
    connectionId: z.number().int().positive().optional(),
    rawId: z.string().min(1).optional(),
  }).optional(),
  judgeThreshold: z.number().min(0).max(1).optional(),
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

  const resolveStreamKeepaliveIntervalMs = async () => {
    let raw = process.env.STREAM_KEEPALIVE_INTERVAL_MS || '0'
    try {
      const record = await prisma.systemSetting.findUnique({
        where: { key: 'stream_keepalive_interval_ms' },
        select: { value: true },
      })
      if (record?.value != null && String(record.value).trim() !== '') {
        raw = String(record.value)
      }
    } catch {}
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
    return 0
  }

  router.post('/stream', actorMiddleware, zValidator('json', battleStreamSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const requestSignal = c.req.raw.signal

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
        let lastSentAt = Date.now()
        let runId: number | null = null
        const send = (event: Record<string, unknown>) => {
          try {
            lastSentAt = Date.now()
            if (event?.type === 'run_start') {
              const id = Number((event as any)?.payload?.id)
              if (Number.isFinite(id)) {
                runId = id
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {}
        }

        const keepaliveIntervalMs = await resolveStreamKeepaliveIntervalMs()
        let keepaliveTimer: ReturnType<typeof setInterval> | null = null
        const startHeartbeat = () => {
          if (keepaliveIntervalMs <= 0 || keepaliveTimer) return
          keepaliveTimer = setInterval(() => {
            send({ type: 'keepalive', ts: Date.now() })
          }, keepaliveIntervalMs)
        }
        const stopHeartbeat = () => {
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer)
            keepaliveTimer = null
          }
        }
        const handleAbort = () => {
          if (!runId) return
          const idleMs = Math.max(0, Date.now() - lastSentAt)
          svc.logRunTrace(runId, 'battle:stream_aborted', {
            endpoint: '/battle/stream',
            idleMs,
            reason: String((requestSignal as any)?.reason ?? 'abort'),
          })
        }
        if (requestSignal && requestSignal.aborted) {
          handleAbort()
        } else if (requestSignal) {
          requestSignal.addEventListener('abort', handleAbort, { once: true })
        }

        try {
          startHeartbeat()
          await svc.executeRun(actor, payload, {
            emitEvent: (event) => send(event),
          })
          send({ type: 'complete' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Battle failed'
          send({ type: 'error', error: message })
        } finally {
          if (requestSignal) {
            try {
              requestSignal.removeEventListener('abort', handleAbort)
            } catch {}
          }
          stopHeartbeat()
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

  router.post('/runs/:id/attempts/cancel', actorMiddleware, zValidator('json', attemptActionSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const payload = c.req.valid('json')
      const result = await svc.cancelAttempt(actor, { runId, ...payload })
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: (error as Error)?.message || 'Failed to cancel attempt' }, 400)
    }
  })

  router.post('/runs/:id/attempts/retry', actorMiddleware, zValidator('json', attemptActionSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const payload = c.req.valid('json')
      const result = await svc.retryAttempt(actor, { runId, ...payload })
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: (error as Error)?.message || 'Failed to retry attempt' }, 400)
    }
  })

  router.post('/results/:id/judge/retry', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const resultId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(resultId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid result id' }, 400)
      }
      const result = await svc.retryJudgeForResult(actor, { resultId })
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: (error as Error)?.message || 'Failed to retry judge' }, 400)
    }
  })

  router.post('/runs/:id/judge/retry', actorMiddleware, zValidator('json', judgeRetrySchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const runId = Number.parseInt(c.req.param('id'), 10)
      if (!Number.isFinite(runId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
      }
      const payload = c.req.valid('json')
      const result = await svc.retryJudgeForRun(actor, { runId, resultIds: payload.resultIds ?? null })
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: (error as Error)?.message || 'Failed to retry judge' }, 400)
    }
  })

  router.post('/runs/:id/rejudge', actorMiddleware, zValidator('json', rejudgeSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const runId = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(runId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid run id' }, 400)
    }
    const payload = c.req.valid('json')
    const requestSignal = c.req.raw.signal

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
        let lastSentAt = Date.now()
        const send = (event: unknown) => {
          try {
            lastSentAt = Date.now()
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {}
        }

        const keepaliveIntervalMs = await resolveStreamKeepaliveIntervalMs()
        let keepaliveTimer: ReturnType<typeof setInterval> | null = null
        const startHeartbeat = () => {
          if (keepaliveIntervalMs <= 0 || keepaliveTimer) return
          keepaliveTimer = setInterval(() => {
            send({ type: 'keepalive', ts: Date.now() })
          }, keepaliveIntervalMs)
        }
        const stopHeartbeat = () => {
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer)
            keepaliveTimer = null
          }
        }
        const handleAbort = () => {
          const idleMs = Math.max(0, Date.now() - lastSentAt)
          svc.logRunTrace(runId, 'battle:stream_aborted', {
            endpoint: '/battle/runs/:id/rejudge',
            idleMs,
            reason: String((requestSignal as any)?.reason ?? 'abort'),
          })
        }
        if (requestSignal && requestSignal.aborted) {
          handleAbort()
        } else if (requestSignal) {
          requestSignal.addEventListener('abort', handleAbort, { once: true })
        }

        try {
          startHeartbeat()
          await svc.rejudgeWithNewAnswer(
            actor,
            {
              runId,
              expectedAnswer: payload.expectedAnswer,
              resultIds: payload.resultIds || null,
              judge: payload.judge,
              judgeThreshold: payload.judgeThreshold,
            },
            {
              emitEvent: send,
            },
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Rejudge failed'
          send({ type: 'error', error: message })
        } finally {
          if (requestSignal) {
            try {
              requestSignal.removeEventListener('abort', handleAbort)
            } catch {}
          }
          stopHeartbeat()
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          } catch {}
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders })
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

  router.get('/shares/:token/stream', async (c) => {
    const token = c.req.param('token')
    if (!token) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid token' }, 400)
    }
    const share = await svc.getShareByToken(token)
    if (!share) {
      return c.json<ApiResponse>({ success: false, error: 'Share not found' }, 404)
    }

    const requestSignal = c.req.raw.signal
    const keepaliveIntervalMs = await resolveStreamKeepaliveIntervalMs()
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
        let closed = false
        let keepaliveTimer: ReturnType<typeof setInterval> | null = null
        let unsubscribe: (() => void) | null = null

        const send = (event: Record<string, unknown>) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {}
        }

        const stop = () => {
          if (closed) return
          closed = true
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer)
            keepaliveTimer = null
          }
          if (unsubscribe) {
            try {
              unsubscribe()
            } catch {}
            unsubscribe = null
          }
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          } catch {}
          controller.close()
        }

        const startHeartbeat = () => {
          if (keepaliveIntervalMs <= 0) return
          keepaliveTimer = setInterval(() => {
            send({ type: 'keepalive', ts: Date.now() })
          }, keepaliveIntervalMs)
        }

        const handleAbort = () => {
          stop()
        }

        if (requestSignal && requestSignal.aborted) {
          handleAbort()
          return
        }
        if (requestSignal) {
          requestSignal.addEventListener('abort', handleAbort, { once: true })
        }

        startHeartbeat()
        send({ type: 'share_ready', runId: share.battleRunId, status: share.payload.status })

        if (share.payload.status === 'completed' || share.payload.status === 'cancelled' || share.payload.status === 'error') {
          send({ type: 'share_complete', status: share.payload.status })
          stop()
          return
        }

        unsubscribe = svc.subscribeRunEvents(share.battleRunId, (event) => {
          if (closed) return
          switch (event.type) {
            case 'attempt_start':
            case 'attempt_complete':
            case 'run_complete':
            case 'run_cancelled':
            case 'error':
              send({ type: 'share_update', eventType: event.type })
              break
            case 'attempt_delta':
              send({
                type: 'attempt_delta',
                payload: event.payload ?? {},
              })
              break
            default:
              break
          }
          if (event.type === 'run_complete' || event.type === 'run_cancelled') {
            send({ type: 'share_complete', status: event.type })
            stop()
          }
        })

        if (!unsubscribe) {
          send({ type: 'share_complete', status: 'inactive' })
          stop()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders })
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
