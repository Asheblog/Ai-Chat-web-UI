import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { PrismaClient } from '@prisma/client'
import { actorMiddleware } from '../../../middleware/auth'
import type { ApiResponse, Actor } from '../../../types'
import { BackendLogger as log } from '../../../utils/logger'
import {
  buildAgentStreamKey,
  clearPendingCancelMarkers,
  findStreamMetaByAssistantClientMessageId,
  findStreamMetaByClientMessageId,
  findStreamMetaByMessageId,
  getStreamMetaByKey,
  registerPendingCancelMarker,
  resolveAssistantClientIdFromRequest,
} from '../../chat/stream-state'
import type { AgentStreamMeta } from '../../chat/stream-state'
import { cancelStreamSchema, sendMessageSchema } from '../chat-common'
import {
  createChatStreamHandler,
  type ChatStreamRoutesDeps,
} from '../use-cases/chat-stream-use-case'

export type { ChatStreamRoutesDeps }

export const registerChatStreamRoutes = (router: Hono, deps: ChatStreamRoutesDeps) => {
  const prisma: PrismaClient = deps.prisma
  const handleStream = createChatStreamHandler(deps)

  router.post('/stream', actorMiddleware, zValidator('json', sendMessageSchema), handleStream)

  router.post('/stream/cancel', actorMiddleware, zValidator('json', cancelStreamSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const { sessionId, clientMessageId, messageId } = payload
    const normalizedClientMessageId =
      typeof clientMessageId === 'string' && clientMessageId.trim().length > 0
        ? clientMessageId.trim()
        : null
    const keyCandidates = [
      buildAgentStreamKey(sessionId, normalizedClientMessageId ?? null),
      typeof messageId === 'number' && Number.isFinite(messageId)
        ? buildAgentStreamKey(sessionId, null, messageId)
        : null,
    ].filter(Boolean) as string[]

    let meta: AgentStreamMeta | null = null
    for (const key of keyCandidates) {
      const candidate = getStreamMetaByKey(key)
      if (candidate) {
        meta = candidate
        break
      }
    }
    if (!meta && typeof messageId === 'number' && Number.isFinite(messageId)) {
      meta = findStreamMetaByMessageId(sessionId, messageId)
    }
    if (!meta && normalizedClientMessageId) {
      meta = findStreamMetaByClientMessageId(sessionId, normalizedClientMessageId)
      if (!meta) {
        meta = findStreamMetaByAssistantClientMessageId(sessionId, normalizedClientMessageId)
      }
    }

    const matchedMeta =
      meta && meta.actorId === actor.identifier && meta.sessionId === sessionId ? meta : null

    if (meta && !matchedMeta) {
      log.warn('Stream cancel: meta found but actor mismatch', {
        sessionId,
        messageId,
        clientMessageId: normalizedClientMessageId,
        metaActorId: meta.actorId,
        requestActorId: actor.identifier,
        metaSessionId: meta.sessionId,
      })
    }

    const assistantClientIdFromRequest = resolveAssistantClientIdFromRequest(normalizedClientMessageId)
    const effectiveAssistantClientId =
      matchedMeta?.assistantClientMessageId ?? assistantClientIdFromRequest ?? normalizedClientMessageId ?? null

    if (matchedMeta) {
      matchedMeta.cancelled = true
      try {
        matchedMeta.controller?.abort()
      } catch {}
      clearPendingCancelMarkers({
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: matchedMeta.assistantClientMessageId ?? effectiveAssistantClientId,
      })
      log.debug('Stream cancel: direct cancellation via streamMeta', {
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        streamKey: matchedMeta.streamKey,
      })
    } else {
      registerPendingCancelMarker({
        sessionId,
        messageId: typeof messageId === 'number' || typeof messageId === 'string' ? messageId : null,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: effectiveAssistantClientId,
      })
      log.debug('Stream cancel: registered pending cancel marker (no active stream found)', {
        sessionId,
        messageId,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: effectiveAssistantClientId,
        metaFound: !!meta,
      })
    }

    const cancellationUpdate = { streamStatus: 'cancelled', streamError: 'Cancelled by user' }
    const updateTasks: Array<Promise<any>> = []

    if (effectiveAssistantClientId) {
      updateTasks.push(
        prisma.message.updateMany({
          where: { sessionId, clientMessageId: effectiveAssistantClientId },
          data: cancellationUpdate,
        }),
      )
    }

    const targetMessageId =
      typeof messageId === 'number' && Number.isFinite(messageId)
        ? messageId
        : typeof matchedMeta?.assistantMessageId === 'number'
          ? (matchedMeta.assistantMessageId as number)
          : null
    if (targetMessageId) {
      updateTasks.push(
        prisma.message.updateMany({
          where: { sessionId, id: targetMessageId },
          data: cancellationUpdate,
        }),
      )
    }

    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks)
    }

    return c.json<ApiResponse>({ success: true })
  })
}
