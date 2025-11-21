import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse, UsageQuotaSnapshot } from '../../../types';
import { serializeQuotaSnapshot } from '../../../utils/quota';
import { cleanupAnonymousSessions } from '../../../utils/anonymous-cleanup';
import { BackendLogger as log } from '../../../utils/logger';
import { logTraffic as defaultLogTraffic } from '../../../utils/traffic-logger';
import {
  QuotaExceededError,
  extendAnonymousSession,
  sendMessageSchema,
  sessionOwnershipClause,
} from '../chat-common';
import { createUserMessageWithQuota } from '../services/message-service';
import {
  ChatCompletionServiceError,
  nonStreamChatService,
  type NonStreamChatService,
} from '../services/non-stream-chat-service';

export const registerChatCompletionRoutes = (
  router: Hono,
  deps: {
    logTraffic?: typeof defaultLogTraffic
    prisma?: PrismaClient
    nonStreamService?: NonStreamChatService
  } = {},
) => {
  const logTraffic = deps.logTraffic ?? defaultLogTraffic
  const prisma = deps.prisma ?? defaultPrisma
  const nonStreamService = deps.nonStreamService ?? nonStreamChatService
  router.post('/completion', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const payload = c.req.valid('json') as any;
      const { sessionId, content, images } = payload;

      await logTraffic({
        category: 'client-request',
        route: '/api/chat/completion',
        direction: 'inbound',
        context: {
          sessionId,
          actor: actor.identifier,
          actorType: actor.type,
        },
        payload: {
          sessionId,
          content,
          images,
        },
      });

      const session = await prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          ...sessionOwnershipClause(actor),
        },
        include: { connection: true },
      });
      if (!session) {
        return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
      }
      if (!session.connectionId || !session.connection || !session.modelRawId) {
        return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400);
      }

      await extendAnonymousSession(actor, sessionId);

      const clientMessageIdInput = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : '';
      const clientMessageId = clientMessageIdInput || null;
      const now = new Date();

      let quotaSnapshot: UsageQuotaSnapshot | null = null;

      try {
        const result = await createUserMessageWithQuota({
          actor,
          sessionId,
          content,
          clientMessageId,
          images,
          now,
        });
        quotaSnapshot = result.quotaSnapshot;
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return c.json({
            success: false,
            error: 'Daily quota exhausted',
            quota: serializeQuotaSnapshot(error.snapshot),
            requiredLogin: actor.type !== 'user',
          }, 429);
        }
        throw error;
      }

      if (actor.type === 'anonymous') {
        cleanupAnonymousSessions({ activeSessionId: sessionId }).catch((error) => {
          log.debug('Anonymous cleanup error', error);
        });
      }

      let completionResult;
      try {
        completionResult = await nonStreamService.execute({
          session,
          payload,
          content,
          images,
          quotaSnapshot,
        });
      } catch (error) {
        if (error instanceof ChatCompletionServiceError) {
          await logTraffic({
            category: 'client-response',
            route: '/api/chat/completion',
            direction: 'inbound',
            context: {
              sessionId,
              actor: actor.identifier,
            },
            payload: {
              status: error.statusCode,
              error: error.message,
            },
          });
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
        }
        throw error;
      }

      const serializedQuota = completionResult.quotaSnapshot
        ? serializeQuotaSnapshot(completionResult.quotaSnapshot)
        : null;

      await logTraffic({
        category: 'client-response',
        route: '/api/chat/completion',
        direction: 'inbound',
        context: {
          sessionId,
          actor: actor.identifier,
        },
        payload: {
          status: 200,
          contentPreview: completionResult.content,
          usage: completionResult.usage,
          quota: serializedQuota,
        },
      });

      return c.json<ApiResponse<{ content: string; usage: typeof completionResult.usage; quota?: ReturnType<typeof serializeQuotaSnapshot> | null }>>({
        success: true,
        data: {
          content: completionResult.content,
          usage: completionResult.usage,
          quota: serializedQuota,
        },
      });
    } catch (error) {
      console.error('Chat completion error:', error);
      await logTraffic({
        category: 'client-response',
        route: '/api/chat/completion',
        direction: 'inbound',
        context: {
          actor: (() => {
            try { return (c.get('actor') as Actor | undefined)?.identifier; }
            catch { return undefined; }
          })(),
        },
        payload: {
          status: 500,
          error: (error as Error)?.message || String(error),
        },
      });
      return c.json<ApiResponse>({ success: false, error: 'Failed to process non-stream completion' }, 500);
    }
  });
};
