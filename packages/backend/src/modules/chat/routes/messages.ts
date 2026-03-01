import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse } from '../../../types';
import { prisma } from '../../../db';
import { extendAnonymousSession } from '../chat-common';
import { chatService, ChatServiceError } from '../../../services/chat';
import { chatMessageQueryService } from '../services/message-query-service';
import type { ToolLogEntry } from '../../chat/tool-logs';

export const registerChatMessageRoutes = (router: Hono) => {
  router.get('/sessions/:sessionId/messages', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const sessionId = parseInt(c.req.param('sessionId'));

      if (isNaN(sessionId)) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Invalid session ID',
        }, 400);
      }

      try {
        await chatService.ensureSessionAccess(actor, sessionId)
      } catch (error) {
        if (error instanceof ChatServiceError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
        }
        throw error
      }

      const pageQuery = (c.req.query('page') || '').trim();
      const pageRaw = pageQuery.toLowerCase();
      const pageParsed = parseInt(pageQuery || '0', 10);
      const page: number | 'latest' =
        !pageQuery || pageRaw === 'latest'
          ? 'latest'
          : Number.isFinite(pageParsed) && pageParsed > 0
            ? pageParsed
            : NaN;

      if (page !== 'latest' && Number.isNaN(page)) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Invalid page value',
        }, 400);
      }

      const limitRaw = parseInt(c.req.query('limit') || '50', 10);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.max(1, Math.min(limitRaw, 200))
          : 50;

      const result = await chatMessageQueryService.listMessages({
        actor,
        sessionId,
        page,
        limit,
        request: c.req.raw,
      });

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{
        messages: Array<{ id: number | string; sessionId: number; role: string; content: string; clientMessageId: string | null; createdAt: Date; images?: string[]; toolEvents?: ToolLogEntry[]; metrics?: any }>;
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>>({
        success: true,
        data: {
          messages: result.messages,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      console.error('Get messages error:', error);
      return c.json<ApiResponse>({
        success: false,
        error: 'Failed to fetch messages',
      }, 500);
    }
  });

  router.put(
    '/sessions/:sessionId/messages/:messageId',
    actorMiddleware,
    zValidator(
      'json',
      z.object({
        content: z.string().max(10000),
      }),
    ),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const sessionId = parseInt(c.req.param('sessionId'));
        const messageId = parseInt(c.req.param('messageId'));

        if (Number.isNaN(sessionId) || Number.isNaN(messageId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid identifiers' }, 400);
        }

        try {
          await chatService.ensureSessionAccess(actor, sessionId)
        } catch (error) {
          if (error instanceof ChatServiceError) {
            return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
          }
          throw error
        }

        const body = c.req.valid('json') as { content: string }
        const content = typeof body?.content === 'string' ? body.content.trim() : ''
        if (!content) {
          return c.json<ApiResponse>({ success: false, error: 'Content is required' }, 400);
        }

        const target = await prisma.message.findUnique({
          where: { id: messageId },
        });
        if (!target || target.sessionId !== sessionId) {
          return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
        }
        if (target.role !== 'user') {
          return c.json<ApiResponse>({ success: false, error: 'Only user messages can be edited' }, 400);
        }

        const activeStream = await prisma.message.findFirst({
          where: { sessionId, streamStatus: 'streaming' },
          select: { id: true },
        })
        if (activeStream) {
          return c.json<ApiResponse>({ success: false, error: 'Session is streaming' }, 409);
        }

        const newerUserMessage = await prisma.message.findFirst({
          where: {
            sessionId,
            role: 'user',
            createdAt: { gt: target.createdAt },
          },
          select: { id: true },
        })
        if (newerUserMessage) {
          return c.json<ApiResponse>(
            { success: false, error: 'Only the last user message can be edited' },
            400,
          );
        }

        const assistantVariants = await prisma.message.findMany({
          where: {
            sessionId,
            role: 'assistant',
            parentMessageId: messageId,
          },
          select: { id: true },
        })
        const assistantIds = assistantVariants.map((item) => item.id)

        await prisma.$transaction(async (tx) => {
          await tx.message.update({
            where: { id: messageId },
            data: { content },
          })

          if (assistantIds.length > 0) {
            await tx.usageMetric.deleteMany({ where: { messageId: { in: assistantIds } } })
            await tx.taskTrace.deleteMany({ where: { messageId: { in: assistantIds } } })
            await tx.message.deleteMany({ where: { id: { in: assistantIds } } })
          }
        })

        await extendAnonymousSession(actor, sessionId);

        return c.json<ApiResponse>({
          success: true,
          data: {
            messageId,
            deletedAssistantMessageIds: assistantIds,
          },
        });
      } catch (error) {
        console.error('Update message error:', error);
        return c.json<ApiResponse>({ success: false, error: 'Failed to update message' }, 500);
      }
    },
  )

  router.get('/sessions/:sessionId/messages/:messageId/progress', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const sessionId = parseInt(c.req.param('sessionId'));
      const messageId = parseInt(c.req.param('messageId'));

      if (Number.isNaN(sessionId) || Number.isNaN(messageId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid identifiers' }, 400);
      }

      try {
        await chatService.ensureSessionAccess(actor, sessionId)
      } catch (error) {
        if (error instanceof ChatServiceError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
        }
        throw error
      }

      const message = await chatMessageQueryService.getMessageById({
        actor,
        sessionId,
        messageId,
        request: c.req.raw as Request,
      });

      if (!message) {
        return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
      }

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{ message: typeof message }>>({
        success: true,
        data: { message },
      });
    } catch (error) {
      console.error('Get message progress error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch progress' }, 500);
    }
  });

  router.get('/sessions/:sessionId/messages/by-client/:clientMessageId', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const sessionId = parseInt(c.req.param('sessionId'));
      const clientParam = c.req.param('clientMessageId') || '';
      const clientMessageId = decodeURIComponent(clientParam).trim();

      if (Number.isNaN(sessionId) || !clientMessageId) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid identifiers' }, 400);
      }

      try {
        await chatService.ensureSessionAccess(actor, sessionId);
      } catch (error) {
        if (error instanceof ChatServiceError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
        }
        throw error;
      }

      const message = await chatMessageQueryService.getMessageByClientId({
        actor,
        sessionId,
        clientMessageId,
        request: c.req.raw as Request,
      });

      if (!message) {
        return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
      }

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{ message: typeof message }>>({
        success: true,
        data: { message },
      });
    } catch (error) {
      console.error('Get message by client id error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch message' }, 500);
    }
  });
};
