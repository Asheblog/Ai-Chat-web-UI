import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { sessionService, SessionServiceError } from '../services/sessions'
import type { SessionService } from '../services/sessions/session-service'
import { MAX_SYSTEM_PROMPT_LENGTH } from '../constants/prompt'

const createSessionSchema = z.object({
  modelId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
  knowledgeBaseIds: z.array(z.number().int().positive()).max(10).optional(),
})

const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).nullable().optional(),
  knowledgeBaseIds: z.array(z.number().int().positive()).max(10).optional(),
})

const switchModelSchema = z.object({
  modelId: z.string().min(1),
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
})

const parsePagination = (value: string | null, fallback: number) => {
  const parsed = parseInt(value || '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallback
}

const handleServiceError = (
  c: any,
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
) => {
  if (error instanceof SessionServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error(logLabel, error)
  return c.json<ApiResponse>({ success: false, error: fallbackMessage }, 500)
}

export interface SessionsApiDeps {
  sessionService?: SessionService
}

export const createSessionsApi = (deps: SessionsApiDeps = {}) => {
  const svc = deps.sessionService ?? sessionService
  const router = new Hono()

  router.get('/', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const page = parsePagination(c.req.query('page'), 1)
      const limit = parsePagination(c.req.query('limit'), 20)
      const result = await svc.listSessions(actor, { page, limit })
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fetch chat sessions', 'Get sessions error:')
    }
  })

  router.post('/', actorMiddleware, zValidator('json', createSessionSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      const session = await svc.createSession(actor, payload)
      return c.json<ApiResponse<typeof session>>({
        success: true,
        data: session,
        message: 'Chat session created successfully',
      })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create chat session', 'Create session error:')
    }
  })

  router.get('/:id', actorMiddleware, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      const actor = c.get('actor') as Actor
      const session = await svc.getSession(actor, sessionId)
      return c.json<ApiResponse<typeof session>>({ success: true, data: session })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fetch chat session', 'Get session error:')
    }
  })

  router.put('/:id', actorMiddleware, zValidator('json', updateSessionSchema), async (c) => {
    try {
      const sessionId = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      const actor = c.get('actor') as Actor
      const updates = c.req.valid('json')
      const session = await svc.updateSession(actor, sessionId, updates)
      return c.json<ApiResponse<typeof session>>({
        success: true,
        data: session,
        message: 'Session updated successfully',
      })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update session title', 'Update session error:')
    }
  })

  router.put('/:id/model', actorMiddleware, zValidator('json', switchModelSchema), async (c) => {
    try {
      const sessionId = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      const session = await svc.switchSessionModel(actor, sessionId, payload)
      return c.json<ApiResponse<typeof session>>({ success: true, data: session })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to switch session model', 'Switch session model error:')
    }
  })

  router.delete('/:id', actorMiddleware, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      const actor = c.get('actor') as Actor
      await svc.deleteSession(actor, sessionId)
      return c.json<ApiResponse>({ success: true, message: 'Chat session deleted successfully' })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete chat session', 'Delete session error:')
    }
  })

  router.delete('/:id/messages', actorMiddleware, async (c) => {
    try {
      const sessionId = parseInt(c.req.param('id'), 10)
      if (Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      const actor = c.get('actor') as Actor
      await svc.clearSessionMessages(actor, sessionId)
      return c.json<ApiResponse>({ success: true, message: 'Session messages cleared successfully' })
    } catch (error) {
      return handleServiceError(
        c,
        error,
        'Failed to clear session messages',
        'Clear session messages error:',
      )
    }
  })

  return router
}

export default createSessionsApi()
