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
import { proxyChatStreamToExecution } from '../../execution/chat-stream-proxy'
import { chatSessionEventBus } from '../services/chat-session-event-bus'
import { normalizeToolCallEventPayload } from '../tool-call-event'
import type { ExecutionSseEvent } from '@aichat/shared/execution-contract'

export type { ChatStreamRoutesDeps }

export const registerChatStreamRoutes = (router: Hono, deps: ChatStreamRoutesDeps) => {
  const prisma: PrismaClient = deps.prisma
  const handleStream = createChatStreamHandler(deps)

  router.post('/stream', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    const payload = c.req.valid('json') as {
      sessionId?: number
      clientMessageId?: string
    }
    const legacyResponse = await handleStream(c)
    const sessionId =
      typeof payload?.sessionId === 'number' && Number.isFinite(payload.sessionId)
        ? payload.sessionId
        : 0
    const runKey = `chat-run-${sessionId}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const sourceId =
      typeof payload?.clientMessageId === 'string' && payload.clientMessageId.trim()
        ? payload.clientMessageId.trim()
        : String(sessionId)
    const normalizedClientMessageId =
      typeof payload?.clientMessageId === 'string' && payload.clientMessageId.trim()
        ? payload.clientMessageId.trim()
        : null
    return proxyChatStreamToExecution({
      legacyResponse,
      sessionId,
      runKey,
      sourceId,
      onEvent: (event: ExecutionSseEvent) => {
        if (!chatSessionEventBus.hasSubscribers(sessionId)) return

        const streamMeta = normalizedClientMessageId
          ? findStreamMetaByClientMessageId(sessionId, normalizedClientMessageId)
          : null
        const messageId = streamMeta?.assistantMessageId ?? null
        const ts = Date.now()

        if (event.type === 'step_delta') {
          const payload = event.payload as { channel?: string; delta?: string }
          if (payload.channel === 'content' && payload.delta) {
            chatSessionEventBus.publish(sessionId, {
              type: 'content_delta',
              sessionId,
              messageId,
              delta: payload.delta,
              ts,
            })
          } else if (payload.channel === 'reasoning' && payload.delta) {
            chatSessionEventBus.publish(sessionId, {
              type: 'reasoning_delta',
              sessionId,
              messageId,
              delta: payload.delta,
              ts,
            })
          }
        } else if (event.type === 'step_artifact') {
          const payload = event.payload as { kind?: string; data?: Record<string, unknown> }
          if (payload.kind === 'tool_call' && payload.data) {
            const rawToolEvent =
              payload.data.event && typeof payload.data.event === 'object' && !Array.isArray(payload.data.event)
                ? (payload.data.event as Record<string, unknown>)
                : payload.data
            chatSessionEventBus.publish(sessionId, {
              type: 'tool_call',
              sessionId,
              messageId,
              toolEvent: normalizeToolCallEventPayload(rawToolEvent),
              ts,
            })
          }
        } else if (event.type === 'step_complete') {
          const payload = event.payload as { error?: string }
          if (event.status !== 'completed') {
            chatSessionEventBus.publish(sessionId, {
              type: 'stream_error',
              sessionId,
              messageId,
              error: payload.error ?? 'Stream error',
              ts,
            })
            return
          }
          chatSessionEventBus.publish(sessionId, {
            type: 'message_complete',
            sessionId,
            messageId,
            ts,
          })
        } else if (event.type === 'run_error') {
          const payload = event.payload as { message?: string }
          chatSessionEventBus.publish(sessionId, {
            type: 'stream_error',
            sessionId,
            messageId,
            error: payload.message ?? 'Stream error',
            ts,
          })
        }
      },
    })
  })

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
