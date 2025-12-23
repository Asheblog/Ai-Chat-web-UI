import { Hono } from 'hono';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';

import { actorMiddleware, requireUserActor } from '../middleware/auth';
import { getModelResolverService, resolveModelForActor } from '../utils/model-resolver';
import { AuthUtils } from '../utils/auth';
import { buildHeaders, convertOpenAIReasoningPayload, type ProviderType } from '../utils/providers';
import { TaskTraceRecorder, shouldEnableTaskTrace, type TaskTraceStatus } from '../utils/task-trace';
import { redactHeadersForTrace, summarizeBodyForTrace, summarizeErrorForTrace } from '../utils/trace-helpers';
import { truncateString } from '../utils/task-trace';
import type { Actor } from '../types';

import type { Connection, Message as MessageEntity } from '@prisma/client';
import {
  openaiCompatMessageService,
  OpenAICompatMessageServiceError,
  OpenAICompatMessageService,
} from '../services/openai-compat/message-service';
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits';

const BACKOFF_429_MS = 15000;
const BACKOFF_5XX_MS = 2000;
const PROVIDER_TIMEOUT_MS = parseInt(process.env.PROVIDER_TIMEOUT_MS || '300000');
const CHAT_IMAGE_MAX_COUNT = DEFAULT_CHAT_IMAGE_LIMITS.maxCount;

export interface OpenAICompatDeps {
  modelResolverService?: ReturnType<typeof getModelResolverService>
  messageService?: OpenAICompatMessageService
  fetchImpl?: typeof fetch
}


const toStatusCode = (status: number): StatusCode => {
  if (status < 100 || status > 599) {
    return 500 as StatusCode;
  }
  return status as StatusCode;
};

const toContentfulStatus = (status: number): ContentfulStatusCode => {
  const resolved = toStatusCode(status);
  if (resolved === 101 || resolved === 204 || resolved === 205 || resolved === 304) {
    return 200 as ContentfulStatusCode;
  }
  return resolved as ContentfulStatusCode;
};

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
  images: z
    .array(z.object({ data: z.string().min(1), mime: z.string().min(1) }))
    .max(CHAT_IMAGE_MAX_COUNT)
    .optional(),
});

const embeddingsSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(z.string())]),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
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
  const baseUrl = opts.connection.baseUrl.replace(/\/+$/, '');
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

interface EmbeddingsRequestOptions {
  connection: Connection;
  rawModelId: string;
  provider: ProviderType;
  body: z.infer<typeof embeddingsSchema>;
}

async function buildEmbeddingsRequest(opts: EmbeddingsRequestOptions) {
  const baseUrl = opts.connection.baseUrl.replace(/\/+$/, '');
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
  let payload: any = {};

  if (opts.provider === 'openai') {
    url = `${baseUrl}/embeddings`;
    payload = {
      model: opts.rawModelId,
      input: opts.body.input,
      encoding_format: opts.body.encoding_format || 'float',
    };
    if (opts.body.dimensions) {
      payload.dimensions = opts.body.dimensions;
    }
  } else if (opts.provider === 'azure_openai') {
    const apiVersion = opts.connection.azureApiVersion || '2024-02-15-preview';
    url = `${baseUrl}/openai/deployments/${encodeURIComponent(opts.rawModelId)}/embeddings?api-version=${encodeURIComponent(apiVersion)}`;
    payload = {
      input: opts.body.input,
      encoding_format: opts.body.encoding_format || 'float',
    };
    if (opts.body.dimensions) {
      payload.dimensions = opts.body.dimensions;
    }
  } else if (opts.provider === 'ollama') {
    url = `${baseUrl}/api/embeddings`;
    // Ollama 使用不同的 API 格式，只支持单个文本
    const input = opts.body.input;
    payload = {
      model: opts.rawModelId,
      prompt: Array.isArray(input) ? input[0] : input,
    };
  } else if (opts.provider === 'google_genai') {
    url = `${baseUrl}/models/${encodeURIComponent(opts.rawModelId)}:embedContent`;
    const text = Array.isArray(opts.body.input) ? opts.body.input[0] : opts.body.input;
    payload = {
      content: { parts: [{ text }] },
    };
  } else {
    throw new Error('Unsupported provider for embeddings');
  }

  return { url, headers, payload };
}

async function requestWithBackoff(
  executor: (signal: AbortSignal) => Promise<Response>,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  trace?: { recorder?: TaskTraceRecorder | null; context?: Record<string, unknown> },
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(new Error('provider request timeout')), timeoutMs);
  const logTrace = (eventType: string, payload: Record<string, unknown>) =>
    trace?.recorder?.log(eventType, { ...(trace?.context || {}), ...payload });
  try {
    let attempt = 1;
    let response = await executor(abortController.signal);
    if (response.status === 429) {
      logTrace('http:provider_retry', { attempt, status: response.status, backoffMs: BACKOFF_429_MS })
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_429_MS));
      attempt += 1;
      response = await executor(abortController.signal);
    } else if (response.status >= 500) {
      logTrace('http:provider_retry', { attempt, status: response.status, backoffMs: BACKOFF_5XX_MS })
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_5XX_MS));
      attempt += 1;
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

export const createOpenAICompatApi = (deps: OpenAICompatDeps = {}) => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const messageService = deps.messageService ?? openaiCompatMessageService;

  const openaiCompat = new Hono();

  openaiCompat.post(
    '/chat/completions',
    actorMiddleware,
    requireUserActor,
    zValidator('json', chatCompletionsSchema),
    async (c) => {
      const user = c.get('user')!; // requireUserActor 已确保 user 存在
      const actor = c.get('actor') as Actor;
      const body = c.req.valid('json');
      let traceRecorder: TaskTraceRecorder | null = null;
      let traceStatus: TaskTraceStatus = 'running';
      let traceError: string | null = null;
      const traceMetadataExtras: Record<string, unknown> = {};

      try {
        const traceDecision = await shouldEnableTaskTrace({
          actor,
          env: process.env.NODE_ENV,
        })
        traceRecorder = await TaskTraceRecorder.create({
          enabled: traceDecision.enabled,
          actorIdentifier: actor.identifier,
          traceLevel: traceDecision.traceLevel,
          metadata: {
            route: '/v1/chat/completions',
            model: body.model,
            stream: Boolean(body.stream),
          },
          maxEvents: traceDecision.config.maxEvents,
        })
        if (!traceRecorder) {
          throw new Error('Trace recorder not initialized')
        }
        traceRecorder.log('request:init', {
          userId: user.id,
          model: body.model,
          stream: Boolean(body.stream),
        })
        traceRecorder.log('http:client_request', {
          route: '/v1/chat/completions',
          direction: 'inbound',
          actor: actor.identifier,
          userId: user.id,
          model: body.model,
          stream: Boolean(body.stream),
          temperature: body.temperature,
          top_p: body.top_p,
          messages: summarizeBodyForTrace(body.messages),
          metadataKeys: body.metadata ? Object.keys(body.metadata) : undefined,
        })

        const resolved = deps.modelResolverService
          ? await deps.modelResolverService.resolveModelForRequest({ actor, userId: user.id, modelId: body.model })
          : await resolveModelForActor({ actor, modelId: body.model });
        if (!resolved) {
          traceStatus = 'error'
          traceError = 'model_not_found'
          traceRecorder.log('http:client_response', {
            route: '/v1/chat/completions',
            direction: 'inbound',
            userId: user.id,
            actor: actor.identifier,
            status: 404,
            error: 'model_not_found',
          })
          return c.json({ error: 'model_not_found', message: 'Model not found in available connections' }, 404);
        }

        const provider = resolved.connection.provider as ProviderType;

        const request = await buildProviderRequest({
          connection: resolved.connection,
          rawModelId: resolved.rawModelId,
          provider,
          body: {
            ...body,
            messages: cloneMessages(body.messages),
          },
        });

        traceRecorder.log('model:resolved', {
          provider,
          connectionId: resolved.connection.id,
          baseUrl: resolved.connection.baseUrl,
          modelRawId: resolved.rawModelId,
        })

        traceRecorder.log('http:provider_request', {
          route: '/v1/chat/completions',
          provider,
          userId: user.id,
          url: request.url,
          stream: Boolean(body.stream),
          headers: redactHeadersForTrace(request.headers),
          body: summarizeBodyForTrace(request.payload),
          timeoutMs: PROVIDER_TIMEOUT_MS,
        })

        const executor = (signal: AbortSignal) =>
          fetchImpl(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.payload),
            signal,
          });

        const response = await requestWithBackoff(executor, PROVIDER_TIMEOUT_MS, {
          recorder: traceRecorder,
          context: {
            route: '/v1/chat/completions',
            provider,
            userId: user.id,
            url: request.url,
            stream: Boolean(body.stream),
          },
        });
        traceRecorder.log('http:provider_response', {
          route: '/v1/chat/completions',
          provider,
          userId: user.id,
          url: request.url,
          stream: Boolean(body.stream),
          status: response.status,
          statusText: response.statusText,
          headers: redactHeadersForTrace(response.headers),
        })

        if (!response.ok && response.status !== 200) {
          const errorPayload = await response.text();
          traceStatus = 'error'
          traceError = `provider_error_${response.status}`
          traceRecorder.log('http:provider_error_body', {
            route: '/v1/chat/completions',
            provider,
            userId: user.id,
            url: request.url,
            status: response.status,
            statusText: response.statusText,
            bodyPreview: truncateString(errorPayload, 500),
          })
          traceRecorder.log('http:client_response', {
            route: '/v1/chat/completions',
            direction: 'inbound',
            userId: user.id,
            actor: actor.identifier,
            stream: Boolean(body.stream),
            status: response.status,
            statusText: response.statusText,
          })
          return c.newResponse(errorPayload, toStatusCode(response.status), {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
          });
        }

        if (body.stream) {
          if (provider === 'ollama') {
            const reader = response.body?.getReader();
            if (!reader) {
              traceStatus = 'error'
              traceError = 'Stream not supported by provider response'
              traceRecorder.log('http:client_response', {
                route: '/v1/chat/completions',
                direction: 'inbound',
                userId: user.id,
                actor: actor.identifier,
                stream: true,
                provider,
                status: 500,
                error: 'Stream not supported by provider response',
              })
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

            traceRecorder.log('http:client_response', {
              route: '/v1/chat/completions',
              direction: 'inbound',
              userId: user.id,
              actor: actor.identifier,
              stream: true,
              provider,
              status: 200,
              mode: 'ollama-stream',
            })
            traceStatus = 'completed'
            return c.newResponse(stream as any, 200, sseHeaders);
          }

          const headers = new Headers(sseHeaders);
          const providerContentType = response.headers.get('Content-Type');
          if (providerContentType) {
            headers.set('Content-Type', providerContentType);
          }
          traceRecorder.log('http:client_response', {
            route: '/v1/chat/completions',
            direction: 'inbound',
            userId: user.id,
            actor: actor.identifier,
            stream: true,
            provider,
            status: 200,
            mode: 'proxy-stream',
          })
          traceStatus = 'completed'
          return c.newResponse(response.body as any, 200, Object.fromEntries(headers));
        }

        if (provider === 'ollama') {
          const json = await response.json() as {
            message?: { content?: string | null };
            prompt_eval_count?: number | null;
            eval_count?: number | null;
            [key: string]: unknown;
          };
          const requestId = `chatcmpl-${randomUUID()}`;
          const created = Math.floor(Date.now() / 1000);
          const result = convertOllamaFinalToOpenAI(json, body.model, requestId, created)
          traceRecorder.log('http:client_response', {
            route: '/v1/chat/completions',
            direction: 'inbound',
            userId: user.id,
            actor: actor.identifier,
            stream: false,
            provider,
            status: 200,
            body: summarizeBodyForTrace(result),
          })
          traceStatus = 'completed'
          return c.json(result);
        }

        const json = await response.json();
        traceRecorder.log('http:client_response', {
          route: '/v1/chat/completions',
          direction: 'inbound',
          userId: user.id,
          actor: actor.identifier,
          stream: false,
          provider,
          status: response.status,
          body: summarizeBodyForTrace(json),
        })
        traceStatus = 'completed'
        return c.json(json, toContentfulStatus(response.status));
      } catch (error: any) {
        traceStatus = 'error'
        traceError = error?.message || String(error)
        traceRecorder?.log('http:client_response', {
          route: '/v1/chat/completions',
          direction: 'inbound',
          actor: actor.identifier,
          userId: user.id,
          stream: Boolean(body.stream),
          status: 500,
          error: summarizeErrorForTrace(error),
        })
        return c.json(
          {
            error: 'provider_error',
            message: error?.message || 'Failed to call provider',
          },
          500,
        );
      } finally {
        if (traceRecorder?.isEnabled()) {
          const finalStatus =
            traceStatus === 'running' ? (traceError ? 'error' : 'completed') : traceStatus
          await traceRecorder.finalize(finalStatus, {
            metadata: traceMetadataExtras,
            error: traceError,
          })
        }
      }
    },
  );

  openaiCompat.post(
    '/responses',
    actorMiddleware,
    requireUserActor,
    zValidator('json', responsesSchema),
    async (c) => {
      const user = c.get('user')!; // requireUserActor 已确保 user 存在
      const body = c.req.valid('json');

      const resolved = await resolveModel(user.id, body.model);
      if (!resolved) {
        return c.json({ error: 'model_not_found', message: 'Model not found in available connections' }, 404);
      }

      const messages = (
        body.messages && body.messages.length
          ? cloneMessages(body.messages)
          : [
              {
                role: 'user',
                content: Array.isArray(body.input)
                  ? body.input
                  : typeof body.input === 'string'
                  ? body.input
                  : body.input ?? '',
              },
            ]
      ) as z.infer<typeof chatMessageSchema>[];

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
          fetchImpl(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.payload),
            signal,
          });

        const response = await requestWithBackoff(executor);

        if (!response.ok && response.status !== 200) {
          const errorPayload = await response.text();
          return c.newResponse(errorPayload, toStatusCode(response.status), {
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
          const json = await response.json() as {
            message?: { content?: string | null };
            prompt_eval_count?: number | null;
            eval_count?: number | null;
            [key: string]: unknown;
          };
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

  openaiCompat.get('/messages', actorMiddleware, requireUserActor, async (c) => {
    const user = c.get('user')!; // requireUserActor 已确保 user 存在
    const rawSessionId = c.req.query('session_id') ?? c.req.query('sessionId');
    const sessionId = Number(rawSessionId);
    if (!sessionId || Number.isNaN(sessionId)) {
      return c.json({ error: 'invalid_request', message: 'session_id is required' }, 400);
    }

    try {
      await messageService.ensureSessionOwnedByUser(user.id, sessionId);
    } catch (error) {
      if (error instanceof OpenAICompatMessageServiceError) {
        return c.json({ error: 'not_found', message: error.message }, error.statusCode);
      }
      throw error;
    }

    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const messages = await messageService.listMessages({
      sessionId,
      limit,
    });

    return c.json({
      object: 'list',
      data: messages.map(formatMessage),
      has_more: false,
    });
  });

  openaiCompat.post(
    '/messages',
    actorMiddleware,
    requireUserActor,
    zValidator('json', messageCreateSchema),
    async (c) => {
      const user = c.get('user')!; // requireUserActor 已确保 user 存在
      const body = c.req.valid('json');

      try {
        await messageService.ensureSessionOwnedByUser(user.id, body.session_id);
      } catch (error) {
        if (error instanceof OpenAICompatMessageServiceError) {
          return c.json({ error: 'not_found', message: error.message }, error.statusCode);
        }
        throw error;
      }

      const contentText = flattenMessageContent(body.content);

      const message = await messageService.saveMessage({
        sessionId: body.session_id,
        role: body.role,
        content: contentText,
        clientMessageId: body.client_message_id,
        reasoning: body.reasoning,
        reasoningDurationSeconds: body.reasoning_duration_seconds,
        images: body.images,
        userId: user.id,
      });

      return c.json(formatMessage(message));
    },
  );

  // Embeddings API - 用于 RAG 文档向量化
  openaiCompat.post(
    '/embeddings',
    actorMiddleware,
    requireUserActor,
    zValidator('json', embeddingsSchema),
    async (c) => {
      const user = c.get('user')!;
      const actor = c.get('actor') as Actor;
      const body = c.req.valid('json');

      try {
        const resolved = deps.modelResolverService
          ? await deps.modelResolverService.resolveModelForRequest({ actor, userId: user.id, modelId: body.model })
          : await resolveModelForActor({ actor, modelId: body.model });

        if (!resolved) {
          return c.json({ error: 'model_not_found', message: 'Model not found in available connections' }, 404);
        }

        const provider = resolved.connection.provider as ProviderType;

        const request = await buildEmbeddingsRequest({
          connection: resolved.connection,
          rawModelId: resolved.rawModelId,
          provider,
          body,
        });

        const executor = (signal: AbortSignal) =>
          fetchImpl(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.payload),
            signal,
          });

        const response = await requestWithBackoff(executor);

        if (!response.ok && response.status !== 200) {
          const errorPayload = await response.text();
          return c.newResponse(errorPayload, toStatusCode(response.status), {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
          });
        }

        // 转换 Ollama 响应为 OpenAI 格式
        if (provider === 'ollama') {
          const json = (await response.json()) as { embedding: number[] };
          return c.json({
            object: 'list',
            data: [
              {
                object: 'embedding',
                embedding: json.embedding || [],
                index: 0,
              },
            ],
            model: body.model,
            usage: { prompt_tokens: 0, total_tokens: 0 },
          });
        }

        // 转换 Google Generative AI 响应为 OpenAI 格式
        if (provider === 'google_genai') {
          const json = (await response.json()) as { embedding?: { values?: number[] } };
          return c.json({
            object: 'list',
            data: [
              {
                object: 'embedding',
                embedding: json.embedding?.values || [],
                index: 0,
              },
            ],
            model: body.model,
            usage: { prompt_tokens: 0, total_tokens: 0 },
          });
        }

        // OpenAI / Azure 直接返回
        const json = await response.json();
        return c.json(json);
      } catch (error: any) {
        return c.json(
          {
            error: 'provider_error',
            message: error?.message || 'Failed to call embeddings provider',
          },
          500,
        );
      }
    },
  );

  return openaiCompat;
};

export default createOpenAICompatApi();
