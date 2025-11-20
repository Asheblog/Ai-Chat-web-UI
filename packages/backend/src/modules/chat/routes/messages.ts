import type { Hono } from 'hono';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse } from '../../../types';
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

      const page = parseInt(c.req.query('page') || '1');
      const limit = parseInt(c.req.query('limit') || '50');

      const result = await chatMessageQueryService.listMessages({
        actor,
        sessionId,
        page,
        limit,
        request: c.req.raw,
      });

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{
        messages: Array<{ id: number; sessionId: number; role: string; content: string; clientMessageId: string | null; createdAt: Date; images?: string[]; toolEvents?: ToolLogEntry[] }>;
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
