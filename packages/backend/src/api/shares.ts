import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { ShareService } from '../services/shares'
import { extendAnonymousSession } from '../modules/chat/chat-common'
import { chatSessionEventBus } from '../modules/chat/services/chat-session-event-bus'
import type { ChatStreamEvent } from '../modules/chat/services/chat-session-event-bus'
import { StreamSettingsService } from '../services/stream'
import { createSseResponse } from '../http/sse'
import { handleRouteError, parsePagination } from '../http/route-utils'

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
  shareService: ShareService
  streamSettingsService?: StreamSettingsService
}

const refreshLocks = new Map<string, Promise<unknown>>()

const parsePositiveInt = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const serializedRefresh = (svc: ShareService, token: string) => {
  const prev = refreshLocks.get(token) ?? Promise.resolve()
  const next = prev.then(() => svc.refreshLiveSharePayload(token)).catch(() => {})
  refreshLocks.set(token, next)
  next.finally(() => {
    if (refreshLocks.get(token) === next) {
      refreshLocks.delete(token)
    }
  })
  return next
}

export const createSharesApi = (deps: SharesApiDeps) => {
  const svc = deps.shareService
  const streamSettings =
    deps.streamSettingsService ?? { resolveKeepaliveIntervalMs: async () => 0 }
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
      return handleRouteError(c, error, 'Failed to fetch share links')
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
      return handleRouteError(c, error, 'Failed to create share link')
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
      return handleRouteError(c, error, 'Failed to fetch share link')
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
      return handleRouteError(c, error, 'Failed to fetch share messages')
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
      return handleRouteError(c, error, 'Failed to update share link')
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
      return handleRouteError(c, error, 'Failed to revoke share link')
    }
  })

  const resolveStreamKeepaliveIntervalMs = () => streamSettings.resolveKeepaliveIntervalMs()

  router.get('/:token/stream', async (c) => {
    const token = (c.req.param('token') || '').trim()
    if (!token) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid share token' }, 400)
    }

    const share = await svc.getShareByToken(token, { includeMessages: false })
    if (!share) {
      return c.json<ApiResponse>({ success: false, error: 'Share link not found' }, 404)
    }

    if (!share.isLive || !share.streamingMessageIds?.length) {
      return c.json<ApiResponse>({ success: false, error: 'Share is not live' }, 400)
    }

    const streamingMessageIds = share.streamingMessageIds

    const requestSignal = c.req.raw.signal
    const keepaliveIntervalMs = await resolveStreamKeepaliveIntervalMs()

    return createSseResponse(
      async (ctx) => {
        const send = (event: Record<string, unknown>) => {
          if (ctx.isClosed()) return
          ctx.send(event)
        }

        ctx.startHeartbeat(
          keepaliveIntervalMs,
          () => `data: ${JSON.stringify({ type: 'keepalive', ts: Date.now() })}\n\n`,
        )

        const streamingMessageSet = new Set(streamingMessageIds)

        const isStreamingMessage = (msgId: number | string | null | undefined): boolean => {
          if (msgId == null) return false
          return streamingMessageSet.has(msgId as number)
        }

        let completedMessageIds = new Set<number>()
        let draining = false
        let initialized = false
        const pendingEvents: ChatStreamEvent[] = []

        const processEvent = async (event: ChatStreamEvent) => {
          const belongsToShare = isStreamingMessage(event.messageId)

          switch (event.type) {
            case 'content_delta':
            case 'reasoning_delta':
            case 'tool_call':
              if (!belongsToShare) return
              send({
                type: event.type,
                messageId: event.messageId,
                delta: event.delta,
                toolEvent: event.toolEvent,
                ts: event.ts,
              })
              break
            case 'message_complete': {
              const mid = typeof event.messageId === 'number' ? event.messageId : null
              if (belongsToShare && mid != null && !completedMessageIds.has(mid)) {
                completedMessageIds.add(mid)
                send({
                  type: 'message_complete',
                  messageId: event.messageId,
                  completed: completedMessageIds.size,
                  total: streamingMessageSet.size,
                  ts: event.ts,
                })
              }
              if (!draining && completedMessageIds.size >= streamingMessageSet.size) {
                draining = true
                try { await serializedRefresh(svc, token) } catch {}
                if (ctx.isClosed()) return
                send({ type: 'share_complete', sessionId: share.sessionId, ts: Date.now() })
                ctx.close()
              }
              break
            }
            case 'stream_error':
              if (!belongsToShare) return
              draining = true
              try { await serializedRefresh(svc, token) } catch {}
              if (ctx.isClosed()) return
              send({
                type: 'stream_error',
                error: event.error ?? 'Stream error',
                ts: event.ts,
              })
              ctx.close()
              break
          }
        }

        // Subscribe first to avoid TOCTOU window
        const unsubscribe = chatSessionEventBus.subscribe(share.sessionId, async (event) => {
          if (ctx.isClosed()) return
          if (!initialized) {
            pendingEvents.push(event)
            return
          }
          if (draining) return
          await processEvent(event)
        })
        ctx.onClose(unsubscribe)

        // Query DB for actual message status to correctly pre-count
        const messageStatuses = await svc.getMessageStreamStatuses(streamingMessageIds)
        if (ctx.isClosed()) return
        for (const m of messageStatuses) {
          if (m.streamStatus !== 'streaming' && m.streamStatus !== 'pending') {
            completedMessageIds.add(m.id)
          }
        }

        send({ type: 'share_ready', sessionId: share.sessionId, streamingMessageIds })
        initialized = true

        // Flush any events that arrived during initialization
        for (const evt of pendingEvents) {
          if (ctx.isClosed()) break
          await processEvent(evt)
        }
        pendingEvents.length = 0

        // If all messages were already complete when we started, close immediately
        if (!ctx.isClosed() && completedMessageIds.size >= streamingMessageSet.size) {
          draining = true
          try { await serializedRefresh(svc, token) } catch {}
          if (!ctx.isClosed()) {
            send({ type: 'share_complete', sessionId: share.sessionId, ts: Date.now(), reason: 'all-complete-at-init' })
            ctx.close()
          }
        }
        await ctx.closed
      },
      {
        signal: requestSignal,
      },
    )
  })

  return router
}
