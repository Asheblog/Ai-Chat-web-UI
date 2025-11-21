import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse, UsageQuotaSnapshot } from '../../../types';
import { serializeQuotaSnapshot } from '../../../utils/quota';
import { cleanupAnonymousSessions } from '../../../utils/anonymous-cleanup';
import { BackendLogger as log } from '../../../utils/logger';
import { TaskTraceRecorder, shouldEnableTaskTrace, type TaskTraceStatus } from '../../../utils/task-trace';
import { redactHeadersForTrace, summarizeBodyForTrace, summarizeErrorForTrace } from '../../../utils/trace-helpers';
import { truncateString } from '../../../utils/task-trace';
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
    prisma?: PrismaClient
    nonStreamService?: NonStreamChatService
  } = {},
) => {
  const prisma = deps.prisma ?? defaultPrisma
  const nonStreamService = deps.nonStreamService ?? nonStreamChatService
  router.post('/completion', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    let traceRecorder: TaskTraceRecorder | null = null
    let traceStatus: TaskTraceStatus = 'running'
    let traceError: string | null = null
    const traceMetadataExtras: Record<string, unknown> = {}
    try {
      const actor = c.get('actor') as Actor;
      const payload = c.req.valid('json') as any;
      const { sessionId, content, images } = payload;
      const traceToggle = typeof payload?.traceEnabled === 'boolean' ? payload.traceEnabled : undefined;

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

      const traceDecision = await shouldEnableTaskTrace({
        actor,
        requestFlag: traceToggle,
        env: process.env.NODE_ENV,
      })
      traceRecorder = await TaskTraceRecorder.create({
        enabled: traceDecision.enabled,
        sessionId,
        actorIdentifier: actor.identifier,
        traceLevel: traceDecision.traceLevel,
        metadata: {
          provider: session.connection.provider,
          model: session.modelRawId,
          connectionId: session.connectionId,
          mode: 'completion',
        },
        maxEvents: traceDecision.config.maxEvents,
      })
      if (!traceRecorder) {
        throw new Error('Trace recorder not initialized')
      }
      traceRecorder.log('request:init', {
        sessionId,
        clientMessageId,
        hasImages: Boolean(images?.length),
        contentPreview: truncateString(content || '', 200),
      })
      traceRecorder.log('http:client_request', {
        route: '/api/chat/completion',
        direction: 'inbound',
        actor: actor.identifier,
        actorType: actor.type,
        sessionId,
        clientMessageId,
        contentPreview: truncateString(content || '', 200),
        imagesCount: Array.isArray(images) ? images.length : 0,
        traceRequested: traceToggle ?? null,
      })

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
          traceStatus = 'error'
          traceError = 'Daily quota exhausted'
          traceRecorder?.log('http:client_response', {
            route: '/api/chat/completion',
            direction: 'inbound',
            sessionId,
            actor: actor.identifier,
            status: 429,
            quota: serializeQuotaSnapshot(error.snapshot),
            error: 'Daily quota exhausted',
          })
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
          traceRecorder,
        });
      } catch (error) {
        if (error instanceof ChatCompletionServiceError) {
          traceStatus = 'error'
          traceError = error.message
          traceRecorder?.log('http:client_response', {
            route: '/api/chat/completion',
            direction: 'inbound',
            sessionId,
            actor: actor.identifier,
            status: error.statusCode,
            error: error.message,
          })
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
        }
        throw error;
      }

      const serializedQuota = completionResult.quotaSnapshot
        ? serializeQuotaSnapshot(completionResult.quotaSnapshot)
        : null;

      traceRecorder?.log('http:client_response', {
        route: '/api/chat/completion',
        direction: 'inbound',
        sessionId,
        actor: actor.identifier,
        status: 200,
        contentPreview: truncateString(completionResult.content, 200),
        usage: completionResult.usage,
        quota: serializedQuota,
      })
      traceStatus = 'completed'
      traceMetadataExtras.finalUsage = completionResult.usage
      traceMetadataExtras.quota = serializedQuota

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
      traceStatus = 'error'
      traceError = (error as Error)?.message || String(error)
      traceRecorder?.log('http:client_response', {
        route: '/api/chat/completion',
        direction: 'inbound',
        actor: (() => {
          try { return (c.get('actor') as Actor | undefined)?.identifier; }
          catch { return undefined; }
        })(),
        status: 500,
        error: summarizeErrorForTrace(error),
      })
      return c.json<ApiResponse>({ success: false, error: 'Failed to process non-stream completion' }, 500);
    } finally {
      if (traceRecorder?.isEnabled()) {
        const finalStatus = traceStatus === 'running'
          ? (traceError ? 'error' : 'completed')
          : traceStatus
        await traceRecorder.finalize(finalStatus, {
          metadata: traceMetadataExtras,
          error: traceError,
        })
      }
    }
  });
};
