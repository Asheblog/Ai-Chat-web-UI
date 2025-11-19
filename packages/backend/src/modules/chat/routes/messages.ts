import type { Hono } from 'hono';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse } from '../../../types';
import {
  determineChatImageBaseUrl,
  resolveChatImageUrls,
} from '../../../utils/chat-images';
import { parseToolLogsJson, type ToolLogEntry } from '../../chat/tool-logs';
import { extendAnonymousSession, sessionOwnershipClause } from '../chat-common';
import { chatService, ChatServiceError } from '../../../services/chat';

const messageSelectFields = {
  id: true,
  sessionId: true,
  role: true,
  content: true,
  parentMessageId: true,
  variantIndex: true,
  attachments: {
    select: {
      relativePath: true,
    },
  },
  clientMessageId: true,
  reasoning: true,
  reasoningDurationSeconds: true,
  toolLogsJson: true,
  createdAt: true,
  updatedAt: true,
  streamStatus: true,
  streamCursor: true,
  streamReasoning: true,
  streamError: true,
} as const;

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

      const [messages, total, siteBaseSetting] = await Promise.all([
        prisma.message.findMany({
          where: { sessionId },
          select: messageSelectFields,
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.message.count({
          where: { sessionId },
        }),
        prisma.systemSetting.findUnique({
          where: { key: 'site_base_url' },
          select: { value: true },
        }),
      ]);

      const baseUrl = determineChatImageBaseUrl({
        request: c.req.raw,
        siteBaseUrl: siteBaseSetting?.value ?? null,
      });
      const normalizedMessages = messages.map((msg) => {
        const { attachments, toolLogsJson, ...rest } = msg as typeof msg & {
          attachments?: Array<{ relativePath: string }>;
          toolLogsJson?: string | null;
        };
        const rel = Array.isArray(attachments) ? attachments.map((att) => att.relativePath) : [];
        return {
          ...rest,
          parentMessageId: rest.parentMessageId,
          variantIndex: rest.variantIndex,
          images: resolveChatImageUrls(rel, baseUrl),
          toolEvents: parseToolLogsJson(toolLogsJson),
        };
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
          messages: normalizedMessages,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
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

      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          sessionId,
          session: sessionOwnershipClause(actor),
        },
        select: messageSelectFields,
      });

      if (!message) {
        return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
      }

      const siteBaseSetting = await prisma.systemSetting.findUnique({
        where: { key: 'site_base_url' },
        select: { value: true },
      });
      const baseUrl = determineChatImageBaseUrl({
        request: c.req.raw,
        siteBaseUrl: siteBaseSetting?.value ?? null,
      });
      const rel = Array.isArray(message.attachments)
        ? message.attachments.map((att) => att.relativePath)
        : [];
      const normalized = {
        ...message,
        attachments: undefined,
        images: resolveChatImageUrls(rel, baseUrl),
        toolEvents: parseToolLogsJson(message.toolLogsJson as string | null | undefined),
      };

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{ message: typeof normalized }>>({
        success: true,
        data: { message: normalized },
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

      const message = await prisma.message.findFirst({
        where: {
          sessionId,
          clientMessageId,
          session: sessionOwnershipClause(actor),
        },
        select: messageSelectFields,
      });

      if (!message) {
        return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
      }

      const siteBaseSetting = await prisma.systemSetting.findUnique({
        where: { key: 'site_base_url' },
        select: { value: true },
      });
      const baseUrl = determineChatImageBaseUrl({
        request: c.req.raw,
        siteBaseUrl: siteBaseSetting?.value ?? null,
      });
      const rel = Array.isArray(message.attachments)
        ? message.attachments.map((att) => att.relativePath)
        : [];
      const normalized = {
        ...message,
        attachments: undefined,
        images: resolveChatImageUrls(rel, baseUrl),
        toolEvents: parseToolLogsJson(message.toolLogsJson as string | null | undefined),
      };

      await extendAnonymousSession(actor, sessionId);

      return c.json<ApiResponse<{ message: typeof normalized }>>({
        success: true,
        data: { message: normalized },
      });
    } catch (error) {
      console.error('Get message by client id error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch message' }, 500);
    }
  });
};
