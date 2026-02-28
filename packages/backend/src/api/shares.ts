import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { shareService, ShareService, ShareServiceError } from '../services/shares'
import { extendAnonymousSession } from '../modules/chat/chat-common'

const createShareSchema = z.object({
  sessionId: z.number().int().positive(),
  messageIds: z.array(z.number().int().positive()).min(1),
  title: z.string().max(200).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
})

const updateShareSchema = z.object({
  title: z.string().max(200).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
})

export interface SharesApiDeps {
  shareService?: ShareService
}

const handleError = (c: any, error: unknown, fallback: string) => {
  if (error instanceof ShareServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error('[shares] unexpected error', error)
  return c.json<ApiResponse>({ success: false, error: fallback }, 500)
}

const parsePositiveInt = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const parsePagination = (value: string | null | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return fallback
}

export const createSharesApi = (deps: SharesApiDeps = {}) => {
  const svc = deps.shareService ?? shareService
  const router = new Hono()

  router.get('/', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionIdValue = parsePositiveInt(c.req.query('sessionId'))
      if (c.req.query('sessionId') && typeof sessionIdValue === 'undefined') {
        return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400)
      }
      const page = parsePagination(c.req.query('page'), 1)
      const limit = parsePagination(c.req.query('limit'), 20)
      const status: 'active' | 'all' = c.req.query('status') === 'all' ? 'all' : 'active'
      const data = await svc.listShares(actor, { sessionId: sessionIdValue, status, page, limit })
      return c.json<ApiResponse<typeof data>>({ success: true, data })
    } catch (error) {
      return handleError(c, error, 'Failed to fetch share links')
    }
  })

  router.post('/', actorMiddleware, zValidator('json', createShareSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      const result = await svc.createShare(actor, payload, { request: c.req.raw as Request })
      await extendAnonymousSession(actor, payload.sessionId)
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return handleError(c, error, 'Failed to create share link')
    }
  })

  router.get('/:token', async (c) => {
    try {
      const token = (c.req.param('token') || '').trim()
      if (!token) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid share token' }, 400)
      }
      const includeMessages = c.req.query('includeMessages') !== '0'
      const record = await svc.getShareByToken(token, { includeMessages })
      if (!record) {
        return c.json<ApiResponse>({ success: false, error: 'Share link not found' }, 404)
      }
      return c.json<ApiResponse<typeof record>>({ success: true, data: record })
    } catch (error) {
      return handleError(c, error, 'Failed to fetch share link')
    }
  })

  router.get('/:token/messages', async (c) => {
    try {
      const token = (c.req.param('token') || '').trim()
      if (!token) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid share token' }, 400)
      }
      const page = parsePagination(c.req.query('page'), 1)
      const limit = parsePagination(c.req.query('limit'), 50)
      const result = await svc.listShareMessagesByToken(token, { page, limit })
      if (!result) {
        return c.json<ApiResponse>({ success: false, error: 'Share link not found' }, 404)
      }
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return handleError(c, error, 'Failed to fetch share messages')
    }
  })

  router.patch('/:id', actorMiddleware, zValidator('json', updateShareSchema), async (c) => {
    try {
      const shareId = Number.parseInt(c.req.param('id'), 10)
      if (Number.isNaN(shareId) || shareId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid share id' }, 400)
      }
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      const result = await svc.updateShare(actor, shareId, payload)
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return handleError(c, error, 'Failed to update share link')
    }
  })

  router.post('/:id/revoke', actorMiddleware, async (c) => {
    try {
      const shareId = Number.parseInt(c.req.param('id'), 10)
      if (Number.isNaN(shareId) || shareId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid share id' }, 400)
      }
      const actor = c.get('actor') as Actor
      const result = await svc.revokeShare(actor, shareId)
      return c.json<ApiResponse<typeof result>>({ success: true, data: result })
    } catch (error) {
      return handleError(c, error, 'Failed to revoke share link')
    }
  })

  return router
}

export default createSharesApi()
