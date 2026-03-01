import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware } from '../../../middleware/auth'
import type { Actor, ApiResponse } from '../../../types'
import { extendAnonymousSession } from '../chat-common'
import { chatService, ChatServiceError } from '../../../services/chat'
import { conversationCompressionService } from '../services/conversation-compression-service'

const updateCompressionSchema = z.object({
  expanded: z.boolean(),
})

export const registerChatCompressionRoutes = (router: Hono) => {
  router.patch(
    '/sessions/:sessionId/compression/:groupId',
    actorMiddleware,
    zValidator('json', updateCompressionSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const sessionId = Number.parseInt(c.req.param('sessionId'), 10)
        const groupId = Number.parseInt(c.req.param('groupId'), 10)
        if (!Number.isFinite(sessionId) || !Number.isFinite(groupId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid identifiers' }, 400)
        }

        try {
          await chatService.ensureSessionAccess(actor, sessionId)
        } catch (error) {
          if (error instanceof ChatServiceError) {
            return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
          }
          throw error
        }

        const payload = c.req.valid('json')
        const updated = await conversationCompressionService.updateGroupExpanded({
          sessionId,
          groupId,
          expanded: payload.expanded,
        })
        if (!updated) {
          return c.json<ApiResponse>({ success: false, error: 'Compression group not found' }, 404)
        }

        await extendAnonymousSession(actor, sessionId)

        return c.json<ApiResponse<{ groupId: number; expanded: boolean }>>({
          success: true,
          data: {
            groupId,
            expanded: payload.expanded,
          },
        })
      } catch (error) {
        console.error('Update compression group error:', error)
        return c.json<ApiResponse>({ success: false, error: 'Failed to update compression group' }, 500)
      }
    },
  )

  router.post('/sessions/:sessionId/compression/:groupId/cancel', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number.parseInt(c.req.param('sessionId'), 10)
      const groupId = Number.parseInt(c.req.param('groupId'), 10)
      if (!Number.isFinite(sessionId) || !Number.isFinite(groupId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid identifiers' }, 400)
      }

      try {
        await chatService.ensureSessionAccess(actor, sessionId)
      } catch (error) {
        if (error instanceof ChatServiceError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
        }
        throw error
      }

      const result = await conversationCompressionService.cancelGroup({ sessionId, groupId })
      if (!result.cancelled) {
        return c.json<ApiResponse>({ success: false, error: 'Compression group not found' }, 404)
      }

      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse<{ groupId: number; releasedCount: number }>>({
        success: true,
        data: {
          groupId,
          releasedCount: result.releasedCount,
        },
      })
    } catch (error) {
      console.error('Cancel compression group error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to cancel compression group' }, 500)
    }
  })
}
