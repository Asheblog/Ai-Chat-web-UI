import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { ApiResponse } from '../../../types';
import { AuthUtils } from '../../../utils/auth';
import type { ProviderType } from '../../../utils/providers';
import { convertChatCompletionsRequestToResponses } from '../../../utils/openai-responses';

const toContentfulStatus = (status: number): ContentfulStatusCode => {
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return 200 as ContentfulStatusCode;
  }
  if (status < 100 || status > 599) {
    return 500 as ContentfulStatusCode;
  }
  return status as ContentfulStatusCode;
};

export const registerChatControlRoutes = (router: Hono) => {
  router.post('/stop', actorMiddleware, zValidator('json', z.object({
    sessionId: z.number().int().positive(),
  })), async (c) => {
    return c.json<ApiResponse>({
      success: true,
      message: 'Stop request received',
    });
  });

  router.post('/regenerate', actorMiddleware, zValidator('json', z.object({
    sessionId: z.number().int().positive(),
    messageId: z.number().int().positive(),
  })), async (c) => {
    try {
      const user = c.get('user') as { id: number } | undefined;
      if (!user || typeof user.id !== 'number') {
        return c.json<ApiResponse>({ success: false, error: 'User context missing' }, { status: 401 });
      }
      const { sessionId, messageId } = c.req.valid('json');

      const [session, message] = await Promise.all([
        prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: { connection: true },
        }),
        prisma.message.findUnique({
          where: { id: messageId },
        }),
      ]);

      if (!session || session.userId !== user.id) {
        return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
      }

      if (!message || message.sessionId !== sessionId) {
        return c.json<ApiResponse>({ success: false, error: 'Message not found' }, 404);
      }

      if (message.role !== 'assistant') {
        return c.json<ApiResponse>({ success: false, error: 'Can only regenerate assistant messages' }, 400);
      }

      const userMessage = await prisma.message.findFirst({
        where: {
          sessionId,
          role: 'user',
          createdAt: { lt: message.createdAt },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!userMessage) {
        return c.json<ApiResponse>({
          success: false,
          error: 'No corresponding user message found',
        }, 404);
      }

      await prisma.message.delete({ where: { id: messageId } });

      return c.json<ApiResponse>({
        success: true,
        data: {
          userMessageId: userMessage.id,
          prompt: 'Please use the chat stream endpoint to regenerate the response',
        },
        message: 'Original assistant message deleted. Please regenerate using stream endpoint.',
      });
    } catch (error) {
      console.error('Regenerate error:', error);
      return c.json<ApiResponse>({
        success: false,
        error: 'Failed to regenerate response',
      }, 500);
    }
  });

  router.post('/generate', actorMiddleware, zValidator('json', z.object({
    connectionId: z.number().int().positive().optional(),
    modelId: z.string().min(1).optional(),
    prompt: z.string().min(1),
    stream: z.boolean().optional(),
  })), async (c) => {
    try {
      const body = c.req.valid('json') as any;
      let conn: any = null;
      let rawId: string | null = null;

      if (body.connectionId) {
        conn = await prisma.connection.findFirst({
          where: { id: body.connectionId, ownerUserId: null },
        });
        if (!conn) return c.json<ApiResponse>({ success: false, error: 'Connection not found' }, 404);
        rawId = body.modelId || null;
      } else if (body.modelId) {
        const cached = await prisma.modelCatalog.findFirst({ where: { modelId: body.modelId } });
        if (!cached) return c.json<ApiResponse>({ success: false, error: 'Model not found' }, 404);
        conn = await prisma.connection.findUnique({ where: { id: cached.connectionId } });
        rawId = cached.rawId;
      } else {
        return c.json<ApiResponse>({ success: false, error: 'connectionId or modelId required' }, 400);
      }

      const baseUrl = conn.baseUrl.replace(/\/+$/, '');
      const provider = conn.provider as ProviderType;
      const decryptedApiKey = conn.authType === 'bearer' && conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : '';
      const extraHeaders = conn.headersJson ? JSON.parse(conn.headersJson) : {};
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(conn.authType === 'bearer' && decryptedApiKey ? { Authorization: `Bearer ${decryptedApiKey}` } : {}),
        ...extraHeaders,
      };

      if (provider === 'ollama') {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: rawId, prompt: body.prompt, stream: !!body.stream }),
        });
        const text = await res.text();
        return c.text(text, toContentfulStatus(res.status));
      } else if (provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai') {
        const messages = [{ role: 'user', content: body.prompt }];
        let url = '';
        if (provider === 'openai') url = `${baseUrl}/chat/completions`;
        else if (provider === 'openai_responses') url = `${baseUrl}/responses`;
        else {
          const v = conn.azureApiVersion || '2024-02-15-preview';
          url = `${baseUrl}/openai/deployments/${encodeURIComponent(rawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            provider === 'openai_responses'
              ? convertChatCompletionsRequestToResponses({ model: rawId, messages, stream: !!body.stream })
              : { model: rawId, messages, stream: !!body.stream }
          ),
        });
        const json = await res.json();
        return c.json(json, toContentfulStatus(res.status));
      }
      return c.json<ApiResponse>({ success: false, error: 'Unsupported provider' }, 400);
    } catch (e: any) {
      return c.json<ApiResponse>({ success: false, error: e?.message || 'Generate failed' }, 500);
    }
  });
};
