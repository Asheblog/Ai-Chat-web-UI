import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { sessionService, SessionServiceError } from '../services/sessions'

const sessions = new Hono()

const createSessionSchema = z.object({
  modelId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
})

const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
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

sessions.get('/', actorMiddleware, async (c) => {
  try {
    const actor = c.get('actor') as Actor
    const page = parsePagination(c.req.query('page'), 1)
    const limit = parsePagination(c.req.query('limit'), 20)
    const result = await sessionService.listSessions(actor, { page, limit })
    return c.json<ApiResponse<typeof result>>({ success: true, data: result })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch chat sessions', 'Get sessions error:')
  }
})

sessions.post('/', actorMiddleware, zValidator('json', createSessionSchema), async (c) => {
  try {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const session = await sessionService.createSession(actor, payload)
    return c.json<ApiResponse<typeof session>>({
      success: true,
      data: session,
      message: 'Chat session created successfully',
    })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to create chat session', 'Create session error:')
  }
})

sessions.get('/:id', actorMiddleware, async (c) => {
  try {
    const sessionId = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }
    const actor = c.get('actor') as Actor
    const session = await sessionService.getSession(actor, sessionId)
    return c.json<ApiResponse<typeof session>>({ success: true, data: session })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch chat session', 'Get session error:')
  }
})

sessions.put('/:id', actorMiddleware, zValidator('json', updateSessionSchema), async (c) => {
  try {
    const sessionId = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }
    const actor = c.get('actor') as Actor
    const updates = c.req.valid('json')
    const session = await sessionService.updateSession(actor, sessionId, updates)
    return c.json<ApiResponse<typeof session>>({
      success: true,
      data: session,
      message: 'Session updated successfully',
    })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to update session title', 'Update session error:')
  }
})

sessions.put('/:id/model', actorMiddleware, zValidator('json', switchModelSchema), async (c) => {
  try {
    const sessionId = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const session = await sessionService.switchSessionModel(actor, sessionId, payload)
    return c.json<ApiResponse<typeof session>>({ success: true, data: session })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to switch session model', 'Switch session model error:')
  }
})

sessions.delete('/:id', actorMiddleware, async (c) => {
  try {
    const sessionId = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }
    const actor = c.get('actor') as Actor
    await sessionService.deleteSession(actor, sessionId)
    return c.json<ApiResponse>({ success: true, message: 'Chat session deleted successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to delete chat session', 'Delete session error:')
  }
})

sessions.delete('/:id/messages', actorMiddleware, async (c) => {
  try {
    const sessionId = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }
    const actor = c.get('actor') as Actor
    await sessionService.clearSessionMessages(actor, sessionId)
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

export default sessions
