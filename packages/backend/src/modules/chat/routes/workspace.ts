import type { Hono } from 'hono'
import { actorMiddleware } from '../../../middleware/auth'
import type { Actor, ApiResponse } from '../../../types'
import { chatService, ChatServiceError } from '../../../services/chat'
import { prisma } from '../../../db'
import { extendAnonymousSession } from '../chat-common'
import { artifactService } from '../../../services/workspace/artifact-service'
import { workspaceService } from '../../../services/workspace/workspace-service'
import { WorkspaceServiceError } from '../../../services/workspace/workspace-errors'

const ensureWorkspaceAccess = async (actor: Actor, sessionId: number) => {
  if (actor.type === 'user' && actor.role === 'ADMIN') {
    const exists = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { id: true } })
    if (!exists) {
      throw new ChatServiceError('Chat session not found', 404)
    }
    return
  }
  await chatService.ensureSessionAccess(actor, sessionId)
}

export const registerChatWorkspaceRoutes = (router: Hono) => {
  router.get('/sessions/:sessionId/artifacts', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))
      const messageIdRaw = c.req.query('messageId')
      const messageId = messageIdRaw ? Number(messageIdRaw) : undefined

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      if (typeof messageId !== 'undefined' && (!Number.isFinite(messageId) || messageId <= 0)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid message ID' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId)
      const artifacts = await artifactService.listSessionArtifacts(actor, sessionId, messageId)
      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse<{ artifacts: typeof artifacts }>>({
        success: true,
        data: {
          artifacts,
        },
      })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to list artifacts' }, 500)
    }
  })

  router.delete('/sessions/:sessionId/workspace', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId)
      await artifactService.cleanupArtifactsBySession(sessionId)
      await workspaceService.destroyWorkspace(sessionId)
      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse>({
        success: true,
      })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete workspace' }, 500)
    }
  })
}
