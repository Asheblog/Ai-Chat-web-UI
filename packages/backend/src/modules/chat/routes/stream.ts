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
  requestStopTools,
  resolveAssistantClientIdFromRequest,
} from '../../chat/stream-state'
import type { AgentStreamMeta } from '../../chat/stream-state'
import {
  cancelStreamSchema,
  researchPlanRespondSchema,
  sendMessageSchema,
  stopToolsSchema,
} from '../chat-common'
import {
  createChatStreamHandler,
  type ChatStreamRoutesDeps,
} from '../use-cases/chat-stream-use-case'
import { proxyChatStreamToExecution } from '../../execution/chat-stream-proxy'
import { chatSessionEventBus } from '../services/chat-session-event-bus'
import { normalizeToolCallEventPayload } from '../../../agent-runtime/tool-call-event'
import {
  cancelResearchPlanApprovalByMessage,
  respondResearchPlanApproval,
  ResearchPlanApprovalError,
} from '../research-plan-approval'
import type { ExecutionSseEvent } from '@aichat/shared/execution-contract'

export type { ChatStreamRoutesDeps }

/**
 * 解析目标 run 的活动 stream meta。
 * 与 cancel 使用同一目标规则：clientMessageId / messageId / 会话级 key 依次回退。
 */
const resolveActiveStreamMeta = (params: {
  sessionId: number
  clientMessageId: string | null
  messageId: number | null
}): AgentStreamMeta | null => {
  const { sessionId, clientMessageId, messageId } = params
  const keyCandidates = [
    buildAgentStreamKey(sessionId, clientMessageId ?? null),
    messageId != null ? buildAgentStreamKey(sessionId, null, messageId) : null,
  ].filter(Boolean) as string[]

  for (const key of keyCandidates) {
    const candidate = getStreamMetaByKey(key)
    if (candidate) return candidate
  }
  if (messageId != null) {
    const byMessage = findStreamMetaByMessageId(sessionId, messageId)
    if (byMessage) return byMessage
  }
  if (clientMessageId) {
    const byClient = findStreamMetaByClientMessageId(sessionId, clientMessageId)
    if (byClient) return byClient
    return findStreamMetaByAssistantClientMessageId(sessionId, clientMessageId)
  }
  return null
}

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
          const payload = event.payload as {
            error?: string
            result?: Record<string, unknown>
          }
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
          const result = payload.result ?? {}
          const stopReason =
            result.stopReason === 'stop_tools' || result.stopReason === 'budget_exhausted'
              ? result.stopReason
              : undefined
          const finalAnswerGenerated =
            typeof result.finalAnswerGenerated === 'boolean'
              ? result.finalAnswerGenerated
              : undefined
          chatSessionEventBus.publish(sessionId, {
            type: 'message_complete',
            sessionId,
            messageId,
            ...(stopReason ? { stopReason } : {}),
            ...(finalAnswerGenerated !== undefined ? { finalAnswerGenerated } : {}),
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

  router.post(
    '/stream/research-plan/respond',
    actorMiddleware,
    zValidator('json', researchPlanRespondSchema),
    async (c) => {
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      try {
        const result = respondResearchPlanApproval({
          sessionId: payload.sessionId,
          toolCallId: payload.toolCallId,
          actorIdentifier: actor.identifier,
          decision: payload.decision,
          feedback: payload.feedback,
        })
        return c.json<ApiResponse>({ success: true, data: result })
      } catch (error) {
        if (error instanceof ResearchPlanApprovalError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
        }
        log.warn('Research plan approval response failed', {
          sessionId: payload.sessionId,
          toolCallId: payload.toolCallId,
          error: error instanceof Error ? error.message : error,
        })
        return c.json<ApiResponse>({ success: false, error: 'Failed to respond to research plan approval' }, 500)
      }
    },
  )

  router.post('/stream/cancel', actorMiddleware, zValidator('json', cancelStreamSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const { sessionId, clientMessageId, messageId } = payload
    const normalizedClientMessageId =
      typeof clientMessageId === 'string' && clientMessageId.trim().length > 0
        ? clientMessageId.trim()
        : null
    const lookupMessageId =
      typeof messageId === 'number' && Number.isFinite(messageId) ? messageId : null
    const meta: AgentStreamMeta | null = resolveActiveStreamMeta({
      sessionId,
      clientMessageId: normalizedClientMessageId,
      messageId: lookupMessageId,
    })

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
      cancelResearchPlanApprovalByMessage({
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        clientMessageId: matchedMeta.clientMessageId,
        assistantClientMessageId: matchedMeta.assistantClientMessageId,
      })
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

  router.post('/stream/stop-tools', actorMiddleware, zValidator('json', stopToolsSchema), async (c) => {
    const actor = c.get('actor') as Actor
    const payload = c.req.valid('json')
    const { sessionId } = payload
    const clientMessageId =
      typeof payload.clientMessageId === 'string' && payload.clientMessageId.trim().length > 0
        ? payload.clientMessageId.trim()
        : null
    const messageId =
      typeof payload.messageId === 'number' && Number.isFinite(payload.messageId)
        ? payload.messageId
        : null

    const meta = resolveActiveStreamMeta({ sessionId, clientMessageId, messageId })
    const target = {
      sessionId,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(messageId != null ? { messageId } : {}),
      ...(meta ? { streamKey: meta.streamKey, via: 'active' as const } : {}),
    }

    if (!meta) {
      log.debug('Stop tools: no active stream for target', { sessionId, clientMessageId, messageId })
      return c.json<ApiResponse>({
        success: true,
        data: { accepted: false, reason: 'no_active_run', target },
      })
    }

    if (meta.actorId !== actor.identifier || meta.sessionId !== sessionId) {
      log.warn('Stop tools rejected: stream owned by another actor', {
        sessionId,
        metaActorId: meta.actorId,
        requestActorId: actor.identifier,
      })
      return c.json<ApiResponse>({ success: false, error: 'Stream not found' }, 404)
    }

    const outcome = requestStopTools(meta)
    log.debug('Stop tools accepted', {
      sessionId,
      streamKey: meta.streamKey,
      reason: outcome.reason,
    })
    return c.json<ApiResponse>({ success: true, data: { ...outcome, target } })
  })
}
