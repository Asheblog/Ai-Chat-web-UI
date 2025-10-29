import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';

import { authMiddleware } from '../middleware/auth';
import { resolveModelIdForUser } from '../utils/model-resolver';
import { AuthUtils } from '../utils/auth';
import { buildHeaders, convertOpenAIReasoningPayload, type ProviderType } from '../utils/providers';
import { prisma } from '../db';

import type { Connection, Message as MessageEntity } from '@prisma/client';

const BACKOFF_429_MS = 15000;
const BACKOFF_5XX_MS = 2000;
const PROVIDER_TIMEOUT_MS = parseInt(process.env.PROVIDER_TIMEOUT_MS || '300000');

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imageUrlSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string(),
    detail: z.string().optional(),
  }),
});

const messageContentSchema = z.union([
  z.string(),
  z.array(z.union([textPartSchema, imageUrlSchema])),
]);

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool', 'developer']).default('user'),
  content: messageContentSchema,
  name: z.string().optional(),
});

const chatCompletionsSchema = z.object({
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  response_format: z.any().optional(),
  max_tokens: z.number().optional(),
  metadata: z.record(z.any()).optional(),
});

const responseInputSchema = z.union([
  z.string(),
  z.array(
    z.union([
      textPartSchema,
      imageUrlSchema,
      z.object({ type: z.string() }).passthrough(),
    ]),
  ),
]);

const responsesSchema = z.object({
  model: z.string().min(1),
  input: z.union([responseInputSchema, z.array(responseInputSchema)]).optional(),
  messages: z.array(chatMessageSchema).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_output_tokens: z.number().optional(),
  metadata: z.record(z.any()).optional(),
});

const messageCreateSchema = z.object({
  session_id: z.number().int().positive(),
  role: z.enum(['user', 'assistant']),
  content: messageContentSchema,
  client_message_id: z.string().min(1).max(128).optional(),
  reasoning: z.string().optional(),
  reasoning_duration_seconds: z.number().int().nonnegative().optional(),
});

function flattenMessageContent(content: z.infer<typeof messageContentSchema>): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return `[image:${part.image_url.url}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function cloneMessages(messages: z.infer<typeof chatMessageSchema>[]) {
  return messages.map((msg) => ({
    ...msg,
    content:
      typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((part) => ({ ...part })),
  }));
}

interface ProviderRequestOptions {
  connection: Connection;
  rawModelId: string;
  provider: ProviderType;
  body: any;
}

async function buildProviderRequest(opts: ProviderRequestOptions) {
  const baseUrl = opts.connection.baseUrl.replace(/\/$/, '');
  const extraHeaders = opts.connection.headersJson ? JSON.parse(opts.connection.headersJson) : undefined;
  const decryptedKey =
    opts.connection.authType === 'bearer' && opts.connection.apiKey
      ? AuthUtils.decryptApiKey(opts.connection.apiKey)
      : undefined;

  const headers = await buildHeaders(
    opts.provider as any,
    opts.connection.authType as any,
    decryptedKey,
    extraHeaders,
  );

  let url = '';
  let payload = { ...opts.body };

  if (opts.provider === 'openai') {
    url = `${baseUrl}/chat/completions`;
    payload = convertOpenAIReasoningPayload({
      ...payload,
      model: opts.rawModelId,
    });
  } else if (opts.provider === 'azure_openai') {
    const apiVersion = opts.connection.azureApiVersion || '2024-02-15-preview';
    url = `${baseUrl}/openai/deployments/${encodeURIComponent(opts.rawModelId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    payload = convertOpenAIReasoningPayload({
      ...payload,
      model: opts.rawModelId,
    });
  } else if (opts.provider === 'ollama') {
    url = `${baseUrl}/api/chat`;
    payload = {
      model: opts.rawModelId,
      stream: Boolean(opts.body?.stream),
      messages: (opts.body?.messages || []).map((msg: any) => ({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : flattenMessageContent(msg.content),
      })),
    };
  } else if (opts.provider === 'google_genai') {
    const endpoint = Boolean(opts.body?.stream) ? ':streamGenerateContent' : ':generateContent';
    url = `${baseUrl}/models/${encodeURIComponent(opts.rawModelId)}${endpoint}`;
    payload = {
      contents: (opts.body?.messages || []).map((msg: any) => ({
        role: msg.role,
        parts: [
          {
            text:
              typeof msg.content === 'string'
                ? msg.content
                : flattenMessageContent(msg.content),
          },
        ],
      })),
      generationConfig: {
        temperature: opts.body?.temperature,
        topP: opts.body?.top_p,
        maxOutputTokens: opts.body?.max_tokens || opts.body?.max_output_tokens,
      },
    };
  } else {
    throw new Error('Unsupported provider');
  }

  return { url, headers, payload };
}

async function requestWithBackoff(
  executor: (signal: AbortSignal) => Promise<Response>,
  timeoutMs = PROVIDER_TIMEOUT_MS,
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(new Error('provider request timeout')), timeoutMs);
  try {
    let response = await executor(abortController.signal);
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_429_MS));
      response = await executor(abortController.signal);
    } else if (response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_5XX_MS));
      response = await executor(abortController.signal);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function convertOllamaChunkToOpenAI(
  chunk: any,
  model: string,
  requestId: string,
  created: number,
) {
  const data = {
    id: requestId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {} as Record<string, any>,
        finish_reason: chunk.done ? 'stop' : null,
      },
    ],
  };

  const message = chunk.message || {};
  if (message.content) {
    data.choices[0].delta.content = message.content;
  }
  if (chunk.done) {
    data.choices[0].delta = {};
  }
  return `data: ${JSON.stringify(data)}\n\n`;
}

function convertOllamaFinalToOpenAI(chunk: any, model: string, requestId: string, created: number) {
  const usage = chunk
    ? {
        prompt_tokens: Number(chunk.prompt_eval_count || chunk.prompt_tokens || 0) || 0,
        completion_tokens: Number(chunk.eval_count || chunk.completion_tokens || 0) || 0,
      }
    : { prompt_tokens: 0, completion_tokens: 0 };

  const total = usage.prompt_tokens + usage.completion_tokens;

  return {
    id: requestId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: chunk?.message?.role || 'assistant',
          content: chunk?.message?.content || '',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: total,
    },
  };
}

function formatMessage(message: MessageEntity) {
  return {
    id: `msg_${message.id}`,
    object: 'thread.message',
    created: Math.floor(message.createdAt.getTime() / 1000),
    role: message.role,
    content: [
      {
        type: 'text',
        text: message.content,
      },
    ],
    metadata: Object.fromEntries(
      Object.entries({
        session_id: message.sessionId,
        client_message_id: message.clientMessageId || undefined,
        reasoning: message.reasoning || undefined,
        reasoning_duration_seconds: message.reasoningDurationSeconds || undefined,
      }).filter(([, value]) => value !== undefined && value !== null),
    ),
  };
}

const openaiCompat = new Hono();

openaiCompat.post(
  '/chat/completions',
  authMiddleware,
  zValidator('json', chatCompletionsSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const resolved = await resolveModelIdForUser(user.id, body.model);
    if (!resolved) {
      return c.json({ error: 'model_not_found', message: 'Model not found in available connections' }, 404);
    }

    const provider = resolved.connection.provider as ProviderType;

    try {
      const request = await buildProviderRequest({
        connection: resolved.connection,
        rawModelId: resolved.rawModelId,
        provider,
        body: {
          ...body,
          messages: cloneMessages(body.messages),
        },
      });

      const executor = (signal: AbortSignal) =>
        fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.payload),
          signal,
        });

      const response = await requestWithBackoff(executor);

      if (!response.ok && response.status !== 200) {
        const errorPayload = await response.text();
        return c.newResponse(errorPayload, response.status, {
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
        });
      }

      if (body.stream) {
        if (provider === 'ollama') {
          const reader = response.body?.getReader();
          if (!reader) {
            return c.json({ error: 'stream_error', message: 'Stream not supported by provider response' }, 500);
          }

          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const requestId = `chatcmpl-${randomUUID()}`;
          const created = Math.floor(Date.now() / 1000);
          let buffer = '';

          const stream = new ReadableStream({
            async pull(controller) {
              const { value, done } = await reader.read();
              if (done) {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  const payload = convertOllamaChunkToOpenAI(
                    parsed,
                    body.model,
                    requestId,
                    created,
                  );
                  controller.enqueue(encoder.encode(payload));

                  if (parsed.done) {
                    const finalPayload = convertOllamaFinalToOpenAI(parsed, body.model, requestId, created);
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(finalPayload)}\n\n`),
                    );
                  }
                } catch {
                  // Ignore malformed lines
                }
              }
            },
            cancel() {
              reader.cancel().catch(() => {});
            },
          });

          return c.newResponse(stream as any, 200, sseHeaders);
        }

        const headers = new Headers(sseHeaders);
        const providerContentType = response.headers.get('Content-Type');
        if (providerContentType) {
          headers.set('Content-Type', providerContentType);
        }
        return c.newResponse(response.body as any, 200, Object.fromEntries(headers));
      }

      if (provider === 'ollama') {
        const json = await response.json();
        const requestId = `chatcmpl-${randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);
        return c.json(convertOllamaFinalToOpenAI(json, body.model, requestId, created));
      }

      const json = await response.json();
      return c.json(json, response.status);
    } catch (error: any) {
      return c.json(
        {
          error: 'provider_error',
          message: error?.message || 'Failed to call provider',
        },
        500,
      );
    }
  },
);

openaiCompat.post(
  '/responses',
  authMiddleware,
  zValidator('json', responsesSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const resolved = await resolveModelIdForUser(user.id, body.model);
    if (!resolved) {
      return c.json({ error: 'model_not_found', message: 'Model not found in available connections' }, 404);
    }

    const messages =
      body.messages && body.messages.length
        ? body.messages
        : [
            {
              role: 'user',
              content: Array.isArray(body.input)
                ? body.input
                : typeof body.input === 'string'
                ? body.input
                : body.input || '',
            },
          ];

    const chatBody = {
      model: body.model,
      messages,
      stream: body.stream,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_output_tokens,
      metadata: body.metadata,
    };

    const provider = resolved.connection.provider as ProviderType;

    try {
      const request = await buildProviderRequest({
        connection: resolved.connection,
        rawModelId: resolved.rawModelId,
        provider,
        body: {
          ...chatBody,
          messages: cloneMessages(messages),
        },
      });

      const executor = (signal: AbortSignal) =>
        fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.payload),
          signal,
        });

      const response = await requestWithBackoff(executor);

      if (!response.ok && response.status !== 200) {
        const errorPayload = await response.text();
        return c.newResponse(errorPayload, response.status, {
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
        });
      }

      if (body.stream) {
        if (provider === 'ollama') {
          const reader = response.body?.getReader();
          if (!reader) {
            return c.json({ error: 'stream_error', message: 'Stream not supported by provider response' }, 500);
          }

          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const responseId = `resp-${randomUUID()}`;
          const created = Math.floor(Date.now() / 1000);
          let buffer = '';

          const stream = new ReadableStream({
            async pull(controller) {
              const { value, done } = await reader.read();
              if (done) {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  const deltaText = parsed?.message?.content || '';
                  const eventPayload = {
                    id: responseId,
                    object: 'response.delta',
                    created,
                    model: body.model,
                    type: 'response.delta',
                    data: {
                      type: 'output_text.delta',
                      delta: deltaText,
                    },
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventPayload)}\n\n`));
                  if (parsed.done) {
                    const finalPayload = {
                      id: responseId,
                      object: 'response.completed',
                      created,
                      model: body.model,
                      type: 'response.completed',
                      data: null,
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalPayload)}\n\n`));
                  }
                } catch {
                  // ignore errors
                }
              }
            },
            cancel() {
              reader.cancel().catch(() => {});
            },
          });

          return c.newResponse(stream as any, 200, sseHeaders);
        }

        const headers = new Headers(sseHeaders);
        const providerContentType = response.headers.get('Content-Type');
        if (providerContentType) {
          headers.set('Content-Type', providerContentType);
        }
        return c.newResponse(response.body as any, 200, Object.fromEntries(headers));
      }

      if (provider === 'ollama') {
        const json = await response.json();
        const responseId = `resp-${randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);
        const text = json?.message?.content || '';
        const usage = {
          prompt_tokens: Number(json?.prompt_eval_count || 0) || 0,
          completion_tokens: Number(json?.eval_count || 0) || 0,
        };
        const total = usage.prompt_tokens + usage.completion_tokens;
        const payload = {
          id: responseId,
          object: 'response',
          created,
          model: body.model,
          output: [
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text }],
              },
            },
          ],
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: total,
          },
        };
        return c.json(payload);
      }

      const raw = await response.json();
      return c.json(raw);
    } catch (error: any) {
      return c.json(
        {
          error: 'provider_error',
          message: error?.message || 'Failed to call provider',
        },
        500,
      );
    }
  },
);

openaiCompat.get('/messages', authMiddleware, async (c) => {
  const user = c.get('user');
  const rawSessionId = c.req.query('session_id') ?? c.req.query('sessionId');
  const sessionId = Number(rawSessionId);
  if (!sessionId || Number.isNaN(sessionId)) {
    return c.json({ error: 'invalid_request', message: 'session_id is required' }, 400);
  }

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });
  if (!session) {
    return c.json({ error: 'not_found', message: 'Session not found' }, 404);
  }

  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    ...(limit && !Number.isNaN(limit) && limit > 0 ? { take: limit } : {}),
  });

  return c.json({
    object: 'list',
    data: messages.map(formatMessage),
    has_more: false,
  });
});

openaiCompat.post(
  '/messages',
  authMiddleware,
  zValidator('json', messageCreateSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const session = await prisma.chatSession.findFirst({
      where: { id: body.session_id, userId: user.id },
      select: { id: true },
    });
    if (!session) {
      return c.json({ error: 'not_found', message: 'Session not found' }, 404);
    }

    const contentText = flattenMessageContent(body.content);

    const createData: any = {
      sessionId: body.session_id,
      role: body.role,
      content: contentText,
    };
    if (body.reasoning !== undefined) createData.reasoning = body.reasoning;
    if (body.reasoning_duration_seconds !== undefined) {
      createData.reasoningDurationSeconds = body.reasoning_duration_seconds;
    }

    let message: MessageEntity;

    if (body.client_message_id) {
      message = await prisma.message.upsert({
        where: {
          sessionId_clientMessageId: {
            sessionId: body.session_id,
            clientMessageId: body.client_message_id,
          },
        },
        update: {
          content: contentText,
          role: body.role,
          ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
          ...(body.reasoning_duration_seconds !== undefined
            ? { reasoningDurationSeconds: body.reasoning_duration_seconds }
            : {}),
        },
        create: {
          ...createData,
          clientMessageId: body.client_message_id,
        },
      });
    } else {
      message = await prisma.message.create({
        data: createData,
      });
    }

    return c.json(formatMessage(message));
  },
);

export default openaiCompat;
