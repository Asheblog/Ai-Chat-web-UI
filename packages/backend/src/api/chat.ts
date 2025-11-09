import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { convertOpenAIReasoningPayload } from '../utils/providers'
import { Tokenizer } from '../utils/tokenizer';
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse, Message, Actor, UsageQuotaSnapshot } from '../types';
import { ensureAnonymousSession } from '../utils/actor';
import { BackendLogger as log } from '../utils/logger';
import { logTraffic } from '../utils/traffic-logger';
import { createReasoningState, DEFAULT_REASONING_TAGS, extractByTags } from '../utils/reasoning-tags';
import {
  cleanupExpiredChatImages,
  persistChatImages,
  resolveChatImageUrls,
  determineChatImageBaseUrl,
  isMessageAttachmentTableMissing,
  MESSAGE_ATTACHMENT_MIGRATION_HINT,
} from '../utils/chat-images';
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../config/storage';
import { consumeActorQuota, inspectActorQuota, serializeQuotaSnapshot } from '../utils/quota';
import { cleanupAnonymousSessions } from '../utils/anonymous-cleanup';
import { resolveContextLimit } from '../utils/context-window';
import { formatHitsForModel, runWebSearch, type WebSearchHit } from '../utils/web-search';

type ProviderChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } | null }>;
  message?: { thinking?: string };
  usage?: {
    prompt_tokens?: number;
    prompt_eval_count?: number;
    input_tokens?: number;
    completion_tokens?: number;
    eval_count?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

const chat = new Hono();

const toContentfulStatus = (status: number): ContentfulStatusCode => {
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return 200 as ContentfulStatusCode;
  }
  if (status < 100 || status > 599) {
    return 500 as ContentfulStatusCode;
  }
  return status as ContentfulStatusCode;
};

const sessionOwnershipClause = (actor: Actor) =>
  actor.type === 'user'
    ? { userId: actor.id }
    : { anonymousKey: actor.key };

const extendAnonymousSession = async (actor: Actor, sessionId: number | null) => {
  if (actor.type !== 'anonymous' || !sessionId) return;
  const context = await ensureAnonymousSession(actor);
  await prisma.chatSession.updateMany({
    where: {
      id: sessionId,
      anonymousKey: actor.key,
    },
    data: {
      expiresAt: context?.expiresAt ?? null,
    },
  });
};

type AgentResponseParams = {
  session: typeof prisma.chatSession.$inferSelect;
  requestData: Record<string, any>;
  messagesPayload: any[];
  promptTokens: number;
  contextLimit: number;
  contextRemaining: number;
  quotaSnapshot: UsageQuotaSnapshot | null;
  userMessageRecord: any;
  sseHeaders: Record<string, string>;
  agentConfig: AgentWebSearchConfig;
  provider: string;
  baseUrl: string;
  authHeader: Record<string, string>;
  extraHeaders: Record<string, string>;
  reasoningEnabled: boolean;
  reasoningSaveToDb: boolean;
  clientMessageId?: string | null;
  actorIdentifier: string;
  requestSignal?: AbortSignal;
};

type ToolLogStage = 'start' | 'result' | 'error';
type ToolLogEntry = {
  id: string;
  tool: string;
  stage: ToolLogStage;
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  createdAt: number;
};

type AgentStreamMeta = {
  sessionId: number;
  actorId: string;
  controller: AbortController | null;
  cancelled: boolean;
};

const agentStreamControllers = new Map<string, AgentStreamMeta>();

const buildAgentStreamKey = (
  sessionId: number,
  clientMessageId?: string | null,
  messageId?: number | string | null,
) => {
  if (clientMessageId && clientMessageId.trim()) {
    return `client:${clientMessageId.trim()}`;
  }
  if (typeof messageId === 'number' || typeof messageId === 'string') {
    return `session:${sessionId}:${messageId}`;
  }
  return `session:${sessionId}`;
};

const extractReasoningText = (reasoning: any): string => {
  if (!reasoning) return '';
  if (typeof reasoning === 'string') return reasoning;
  if (Array.isArray(reasoning)) {
    return reasoning
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk;
        if (chunk && typeof chunk === 'object') {
          if (typeof chunk.text === 'string') return chunk.text;
          if (typeof chunk.content === 'string') return chunk.content;
        }
        return '';
      })
      .join('');
  }
  if (typeof reasoning === 'object') {
    if (typeof reasoning.text === 'string') return reasoning.text;
    if (typeof reasoning.content === 'string') return reasoning.content;
  }
  try {
    return JSON.stringify(reasoning);
  } catch {
    return '';
  }
};

const parseToolLogsJson = (raw?: string | null): ToolLogEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const legacyPending = new Map<string, Array<{ id: string; createdAt: number }>>();
    let legacyCounter = 0;
    const LEGACY_WINDOW = 15_000;

    const legacyKey = (tool: string, query?: string) =>
      `${tool}::${(query || '').trim().toLowerCase()}`;

    const allocateLegacyId = (
      key: string,
      stage: ToolLogStage,
      createdAt: number,
    ): string => {
      if (stage === 'start') {
        const id = `legacy:${key}:${legacyCounter++}`;
        const queue = legacyPending.get(key) ?? [];
        queue.push({ id, createdAt });
        legacyPending.set(key, queue);
        return id;
      }
      const queue = legacyPending.get(key);
      if (queue && queue.length > 0) {
        while (queue.length > 0 && createdAt - queue[0].createdAt > LEGACY_WINDOW) {
          queue.shift();
        }
        if (queue.length > 0) {
          const match = queue.shift()!;
          if (queue.length === 0) {
            legacyPending.delete(key);
          } else {
            legacyPending.set(key, queue);
          }
          return match.id;
        }
      }
      return `legacy:${key}:${legacyCounter++}`;
    };

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const stage = entry.stage;
        if (stage !== 'start' && stage !== 'result' && stage !== 'error') return null;
        const tool = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool : 'unknown';
        const createdAtRaw =
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : Date.now();
        const query = typeof entry.query === 'string' ? entry.query : undefined;
        const id =
          typeof entry.id === 'string' && entry.id.trim()
            ? entry.id.trim()
            : allocateLegacyId(legacyKey(tool, query), stage, createdAtRaw);
        const log: ToolLogEntry = {
          id,
          tool,
          stage,
          query,
          createdAt: createdAtRaw,
        };
        if (Array.isArray(entry.hits)) {
          log.hits = entry.hits
            .map((hit: any) => {
              if (!hit || typeof hit !== 'object') return null;
              const title = typeof hit.title === 'string' ? hit.title : '';
              const url = typeof hit.url === 'string' ? hit.url : '';
              if (!title && !url) return null;
              const normalized: WebSearchHit = {
                title,
                url,
              };
              if (typeof hit.snippet === 'string') normalized.snippet = hit.snippet;
              if (typeof hit.content === 'string') normalized.content = hit.content;
              return normalized;
            })
            .filter((hit): hit is WebSearchHit => Boolean(hit));
        }
        if (typeof entry.error === 'string' && entry.error.trim()) {
          log.error = entry.error;
        }
        return log;
      })
      .filter((entry): entry is ToolLogEntry => Boolean(entry));
  } catch {
    return [];
  }
};

const createAgentWebSearchResponse = async (params: AgentResponseParams): Promise<Response> => {
  const {
    session,
    sessionId,
    requestData,
    messagesPayload,
    promptTokens,
    contextLimit,
    contextRemaining,
    quotaSnapshot,
    userMessageRecord,
    sseHeaders,
    agentConfig,
    provider,
    baseUrl,
    authHeader,
    extraHeaders,
    reasoningEnabled,
    reasoningSaveToDb,
    clientMessageId,
    actorIdentifier,
    requestSignal,
  } = params;

  const resolvedClientMessageId =
    clientMessageId ??
    userMessageRecord?.clientMessageId ??
    requestData?.client_message_id ??
    requestData?.clientMessageId ??
    null;
  const streamKey = buildAgentStreamKey(
    sessionId,
    resolvedClientMessageId,
    userMessageRecord?.id ?? null,
  );

  let streamMeta: AgentStreamMeta | null = null;
  if (streamKey) {
    streamMeta =
      agentStreamControllers.get(streamKey) ?? {
        sessionId,
        actorId: actorIdentifier,
        controller: null,
        cancelled: false,
      };
    streamMeta.sessionId = sessionId;
    streamMeta.actorId = actorIdentifier;
    streamMeta.controller = null;
    streamMeta.cancelled = false;
    agentStreamControllers.set(streamKey, streamMeta);
  }

  const setStreamController = (controller: AbortController | null) => {
    if (!streamMeta || !streamKey) return;
    streamMeta.controller = controller;
    agentStreamControllers.set(streamKey, streamMeta);
  };

  const releaseStreamMeta = () => {
    if (streamKey) {
      agentStreamControllers.delete(streamKey);
    }
    if (streamMeta) {
      streamMeta.controller = null;
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let downstreamClosed = false;

      const safeEnqueue = (payload: Record<string, unknown>) => {
        if (!downstreamClosed && requestSignal?.aborted) {
          downstreamClosed = true;
        }
        if (downstreamClosed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          return true;
        } catch {
          downstreamClosed = true;
          return false;
        }
      };

      const toolLogs: ToolLogEntry[] = [];
      let toolLogSequence = 0;

      const ensureToolLogId = (payload: Record<string, unknown>) => {
        if (typeof payload.id === 'string' && payload.id.trim()) {
          return (payload.id as string).trim();
        }
        if (typeof payload.callId === 'string' && payload.callId.trim()) {
          return (payload.callId as string).trim();
        }
        toolLogSequence += 1;
        return `session:${sessionId}:tool:${toolLogSequence}`;
      };

      const recordToolLog = (payload: Record<string, unknown>) => {
        const stage = payload.stage;
        if (stage !== 'start' && stage !== 'result' && stage !== 'error') return;
        const tool = typeof payload.tool === 'string' && payload.tool.trim() ? payload.tool : null;
        if (!tool) return;
        const entry: ToolLogEntry = {
          id: ensureToolLogId(payload),
          tool,
          stage,
          query: typeof payload.query === 'string' ? payload.query : undefined,
          createdAt: Date.now(),
        };
        if (Array.isArray(payload.hits)) {
          entry.hits = (payload.hits as WebSearchHit[]).slice(0, 10);
        }
        if (typeof payload.error === 'string' && payload.error.trim()) {
          entry.error = payload.error;
        }
        const existingIndex = toolLogs.findIndex((log) => log.id === entry.id);
        if (existingIndex === -1) {
          toolLogs.push(entry);
          return;
        }
        const existing = toolLogs[existingIndex];
        toolLogs[existingIndex] = {
          ...existing,
          stage: entry.stage,
          query: entry.query ?? existing.query,
          hits: entry.hits ?? existing.hits,
          error: entry.error ?? existing.error,
          createdAt: existing.createdAt,
        };
      };

      const sendToolEvent = (payload: Record<string, unknown>) => {
        safeEnqueue({ type: 'tool', ...payload });
        recordToolLog(payload);
      };

      const emitReasoning = (content: string, meta?: Record<string, unknown>) => {
        const text = (content || '').trim();
        if (!text) return;
        const payload: Record<string, unknown> = { type: 'reasoning', content: text };
        if (meta && Object.keys(meta).length > 0) {
          payload.meta = meta;
        }
        safeEnqueue(payload);
      };

      safeEnqueue({ type: 'start', messageId: userMessageRecord?.id ?? null });
      if (quotaSnapshot) {
        safeEnqueue({ type: 'quota', quota: serializeQuotaSnapshot(quotaSnapshot) });
      }
      safeEnqueue({
        type: 'usage',
        usage: {
          prompt_tokens: promptTokens,
          total_tokens: promptTokens,
          context_limit: contextLimit,
          context_remaining: contextRemaining,
        },
      });

      const workingMessages = JSON.parse(JSON.stringify(messagesPayload));
      const maxIterations = 4;
      let currentProviderController: AbortController | null = null;

      const callProvider = async (messages: any[]) => {
        const body = convertOpenAIReasoningPayload({
          ...requestData,
          stream: true,
          messages,
          tools: [
            {
              type: 'function',
              function: {
                name: 'web_search',
                description:
                  'Use this tool to search the live web for up-to-date information before responding. Return queries in the same language as the conversation.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Search query describing the missing information',
                    },
                    num_results: {
                      type: 'integer',
                      minimum: 1,
                      maximum: agentConfig.resultLimit,
                      description: 'Desired number of results',
                    },
                  },
                  required: ['query'],
                },
              },
            },
          ],
          tool_choice: 'auto',
        });

        let url = '';
        if (provider === 'openai') {
          url = `${baseUrl}/chat/completions`;
        } else if (provider === 'azure_openai') {
          const v = session.connection?.azureApiVersion || '2024-02-15-preview';
          url = `${baseUrl}/openai/deployments/${encodeURIComponent(
            session.modelRawId!,
          )}/chat/completions?api-version=${encodeURIComponent(v)}`;
        } else {
          throw new Error(`Provider ${provider} does not support agent web search`);
        }

        const headers = {
          'Content-Type': 'application/json',
          ...authHeader,
          ...extraHeaders,
        };

        currentProviderController = new AbortController();
        setStreamController(currentProviderController);

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: currentProviderController.signal,
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`AI provider request failed (${response.status}): ${text}`);
          }
          return response;
        } catch (error) {
          setStreamController(null);
          currentProviderController = null;
          throw error;
        }
      };

      const reasoningChunks: string[] = [];
      let reasoningText = '';
      let reasoningStartedAt: number | null = null;
      let reasoningDurationSeconds = 0;
      let finalUsageSnapshot: any = null;
      let finalContent = '';
      let providerUsageSeen = false;

      try {
        let iterations = 0;
        while (iterations < maxIterations) {
          iterations += 1;
          const response = await callProvider(workingMessages);
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('AI provider returned no response body');
          }
          const decoder = new TextDecoder();
          let buffer = '';
          let finishReason: string | null = null;
          let providerUsage: any = null;
          let iterationContent = '';
          let iterationReasoning = '';
          let iterationReasoningStartedAt: number | null = null;
          const toolCallBuffers = new Map<
            number,
            { id?: string; type?: string; function: { name?: string; arguments: string } }
          >();

          const aggregateToolCalls = () =>
            Array.from(toolCallBuffers.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([_, entry]) => ({
                id: entry.id || randomUUID(),
                type: entry.type || 'function',
                function: {
                  name: entry.function.name || 'web_search',
                  arguments: entry.function.arguments || '{}',
                },
              }));

          let streamFinished = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const normalized = line.replace(/\r$/, '');
              if (!normalized.startsWith('data: ')) continue;
              const data = normalized.slice(6);
              if (data === '[DONE]') {
                buffer = '';
                streamFinished = true;
                break;
              }
              let parsed: any;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              const choice = parsed.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta ?? {};
              if (delta.reasoning_content) {
                if (!reasoningStartedAt) reasoningStartedAt = Date.now();
                if (!iterationReasoningStartedAt) iterationReasoningStartedAt = Date.now();
                iterationReasoning += delta.reasoning_content;
                emitReasoning(delta.reasoning_content, { kind: 'model', stage: 'stream' });
              }
              if (delta.content) {
                iterationContent += delta.content;
                safeEnqueue({ type: 'content', content: delta.content });
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const toolDelta of delta.tool_calls) {
                  const idx = typeof toolDelta.index === 'number' ? toolDelta.index : 0;
                  const existing =
                    toolCallBuffers.get(idx) || { function: { name: undefined, arguments: '' } };
                  if (toolDelta.id) existing.id = toolDelta.id;
                  if (toolDelta.type) existing.type = toolDelta.type;
                  if (toolDelta.function?.name) existing.function.name = toolDelta.function.name;
                  if (toolDelta.function?.arguments) {
                    existing.function.arguments = `${existing.function.arguments || ''}${
                      toolDelta.function.arguments
                    }`;
                  }
                  toolCallBuffers.set(idx, existing);
                }
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
              if (parsed.usage) {
                providerUsage = parsed.usage;
                providerUsageSeen = true;
                safeEnqueue({ type: 'usage', usage: parsed.usage });
              }
            }
            if (streamFinished) break;
          }
          await reader.cancel().catch(() => {});
          currentProviderController = null;
          setStreamController(null);

          const aggregatedToolCalls = aggregateToolCalls();

          if (iterationReasoning.trim()) {
            reasoningChunks.push(iterationReasoning.trim());
          }

          if (finishReason === 'tool_calls' && aggregatedToolCalls.length > 0) {
            workingMessages.push({
              role: 'assistant',
              content: iterationContent,
              tool_calls: aggregatedToolCalls,
            });

            for (const toolCall of aggregatedToolCalls) {
              if (toolCall?.function?.name !== 'web_search') {
                sendToolEvent({
                  id: toolCall.id || randomUUID(),
                  tool: toolCall?.function?.name ?? 'unknown',
                  stage: 'error',
                  error: 'Unsupported tool requested by the model',
                });
                continue;
              }
              let args: { query?: string; num_results?: number } = {};
              try {
                args = JSON.parse(toolCall.function?.arguments ?? '{}');
              } catch {
                args = {};
              }
              const query = (args?.query || '').trim();
              const callId = toolCall.id || randomUUID();
              const reasoningMetaBase = { kind: 'tool', tool: 'web_search', query, callId };
              if (!query) {
                emitReasoning('模型请求了空的联网搜索参数，已忽略。', {
                  ...reasoningMetaBase,
                  stage: 'error',
                });
                sendToolEvent({
                  id: callId,
                  tool: 'web_search',
                  stage: 'error',
                  query: '',
                  error: 'Model requested web_search without a query',
                });
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  name: 'web_search',
                  content: JSON.stringify({ error: 'Missing query parameter' }),
                });
                continue;
              }

              emitReasoning(`联网搜索：${query}`, { ...reasoningMetaBase, stage: 'start' });
              sendToolEvent({ id: callId, tool: 'web_search', stage: 'start', query });
              try {
                const hits = await runWebSearch(query, {
                  engine: agentConfig.engine,
                  apiKey: agentConfig.apiKey,
                  limit: args?.num_results || agentConfig.resultLimit,
                  domains: agentConfig.domains,
                  endpoint: agentConfig.endpoint,
                });
                emitReasoning(`获得 ${hits.length} 条结果，准备综合。`, {
                  ...reasoningMetaBase,
                  stage: 'result',
                  hits: hits.length,
                });
                sendToolEvent({
                  id: callId,
                  tool: 'web_search',
                  stage: 'result',
                  query,
                  hits,
                });
                const summary = formatHitsForModel(query, hits);
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  name: 'web_search',
                  content: JSON.stringify({ query, hits, summary }),
                });
              } catch (searchError: any) {
                const message = searchError?.message || 'Web search failed';
                emitReasoning(`联网搜索失败：${message}`, {
                  ...reasoningMetaBase,
                  stage: 'error',
                });
                sendToolEvent({
                  id: callId,
                  tool: 'web_search',
                  stage: 'error',
                  query,
                  error: message,
                });
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  name: 'web_search',
                  content: JSON.stringify({ query, error: message }),
                });
              }
            }

            continue;
          }

          finalContent = iterationContent.trim();
          if (!finalContent) {
            throw new Error('Model finished without producing a final answer');
          }

          if (iterationReasoningStartedAt && reasoningStartedAt) {
            reasoningDurationSeconds = Math.max(0, Math.round((Date.now() - reasoningStartedAt) / 1000));
          }

          finalUsageSnapshot = providerUsage;
          break;
        }

        if (streamMeta?.cancelled) {
          log.debug('Agent stream cancelled by client', {
            sessionId,
            streamKey,
          });
          return;
        }

        if (!finalContent) {
          throw new Error('AI provider did not return a response');
        }

        reasoningText = reasoningChunks.join('\n\n').trim();
        if (reasoningText) {
          safeEnqueue({
            type: 'reasoning',
            done: true,
            duration: reasoningDurationSeconds,
            meta: { kind: 'model', stage: 'final' },
          });
        }

        const completionTokensFallback = await Tokenizer.countTokens(finalContent);
        const toUsageNumbers = (usage: any) => {
          const prompt =
            Number(
              usage?.prompt_tokens ?? usage?.prompt_eval_count ?? usage?.input_tokens ?? 0
            ) || 0;
          const completion =
            Number(usage?.completion_tokens ?? usage?.eval_count ?? usage?.output_tokens ?? 0) ||
            0;
          const total =
            Number(usage?.total_tokens ?? (prompt + completion)) || prompt + completion;
          return { prompt, completion, total };
        };
        const providerUsageNumbers =
          providerUsageSeen && finalUsageSnapshot ? toUsageNumbers(finalUsageSnapshot) : null;
        const providerUsageValid =
          providerUsageNumbers != null &&
          (providerUsageNumbers.prompt > 0 ||
            providerUsageNumbers.completion > 0 ||
            providerUsageNumbers.total > 0);
        const fallbackUsageNumbers = {
          prompt: promptTokens,
          completion: completionTokensFallback,
          total: promptTokens + completionTokensFallback,
        };
        const finalUsageNumbers = providerUsageValid ? providerUsageNumbers : fallbackUsageNumbers;
        const finalUsagePayload = {
          prompt_tokens: finalUsageNumbers.prompt,
          completion_tokens: finalUsageNumbers.completion,
          total_tokens: finalUsageNumbers.total,
          context_limit: contextLimit,
          context_remaining: Math.max(0, contextLimit - promptTokens),
        };

        if (!providerUsageSeen || !providerUsageValid) {
          safeEnqueue({ type: 'usage', usage: finalUsagePayload });
        }
        safeEnqueue({ type: 'complete' });

        try {
          const sessionStillExists = async () => {
            const count = await prisma.chatSession.count({ where: { id: sessionId } });
            return count > 0;
          };

          let assistantMessageId: number | null = null;
          if (finalContent && (await sessionStillExists())) {
            const data: any = {
              sessionId,
              role: 'assistant',
              content: finalContent,
            };
            if (reasoningEnabled && reasoningSaveToDb && reasoningText.trim()) {
              data.reasoning = reasoningText.trim();
              data.reasoningDurationSeconds = reasoningDurationSeconds;
            }
            if (toolLogs.length > 0) {
              data.toolLogsJson = JSON.stringify(toolLogs);
            }
            const saved = await prisma.message.create({ data });
            assistantMessageId = saved?.id ?? null;
          } else if (!finalContent) {
            log.warn('Agent response empty, skip persistence');
          } else {
            log.debug('Session missing when persisting agent response, skip insert', { sessionId });
          }

          const providerHost = (() => {
            try {
              const u = new URL(baseUrl);
              return u.hostname;
            } catch {
              return null;
            }
          })();

          if (await sessionStillExists()) {
            await (prisma as any).usageMetric.create({
              data: {
                sessionId,
                messageId: assistantMessageId ?? undefined,
                model: session.modelRawId || 'unknown',
                provider: providerHost ?? undefined,
                promptTokens: finalUsageNumbers.prompt,
                completionTokens: finalUsageNumbers.completion,
                totalTokens: finalUsageNumbers.total,
                contextLimit: contextLimit,
              },
            });
          } else {
            log.debug('Session missing when persisting usage metric, skip insert', { sessionId });
          }
        } catch (persistErr) {
          console.warn('Persist agent response failed', persistErr);
        }
      } catch (error: any) {
        if (streamMeta?.cancelled) {
          log.debug('Agent stream aborted after client cancellation', {
            sessionId,
            streamKey,
          });
          return;
        }
        log.error('Agent web search failed', error);
        safeEnqueue({
          type: 'error',
          error: error?.message || 'Web search agent failed',
        });
        const agentError =
          error instanceof Error ? error : new Error(error?.message || 'Web search agent failed');
        (agentError as any).handled = 'agent_error';
        (agentError as any).status = error?.status ?? 500;
        throw agentError;
      } finally {
        try {
          controller.close();
        } catch {}
        setStreamController(null);
        releaseStreamMeta();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
// 429 退避（毫秒）与 5xx/超时 退避（毫秒）
const BACKOFF_429_MS = 15000;
const BACKOFF_5XX_MS = 2000;
// 前端出现失败重试/降级时，避免同一条用户消息被重复写入数据库
const MESSAGE_DEDUPE_WINDOW_MS = parseInt(process.env.MESSAGE_DEDUPE_WINDOW_MS || '30000');

interface AgentWebSearchConfig {
  enabled: boolean;
  engine: string;
  apiKey?: string;
  resultLimit: number;
  domains: string[];
  endpoint?: string;
}

const truthyValues = new Set(['true', '1', 'yes', 'y', 'on']);
const falsyValues = new Set(['false', '0', 'no', 'n', 'off']);

const parseBooleanSetting = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === null) return fallback;
  const normalized = value.toString().trim().toLowerCase();
  if (truthyValues.has(normalized)) return true;
  if (falsyValues.has(normalized)) return false;
  return fallback;
};

const parseDomainListSetting = (raw?: string | null): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean);
    }
  } catch {
    // ignore json parse error
  }
  return trimmed
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
};

const buildAgentWebSearchConfig = (sysMap: Record<string, string>): AgentWebSearchConfig => {
  const enabled = parseBooleanSetting(
    sysMap.web_search_agent_enable ?? process.env.WEB_SEARCH_AGENT_ENABLE,
    false,
  );
  const engine = (
    sysMap.web_search_default_engine ||
    process.env.WEB_SEARCH_DEFAULT_ENGINE ||
    'tavily'
  ).toLowerCase();
  const apiKey = sysMap.web_search_api_key || process.env.WEB_SEARCH_API_KEY || '';
  const limitRaw = sysMap.web_search_result_limit ?? process.env.WEB_SEARCH_RESULT_LIMIT ?? '4';
  const parsedLimit = Number.parseInt(String(limitRaw), 10);
  const resultLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(10, parsedLimit)) : 4;
  const sysDomains = parseDomainListSetting(sysMap.web_search_domain_filter);
  const envDomains = parseDomainListSetting(process.env.WEB_SEARCH_DOMAIN_FILTER);
  const domainList = sysDomains.length > 0 ? sysDomains : envDomains;
  const endpoint = sysMap.web_search_endpoint || process.env.WEB_SEARCH_ENDPOINT;
  return {
    enabled,
    engine,
    apiKey,
    resultLimit,
    domains: domainList,
    endpoint,
  };
};

class QuotaExceededError extends Error {
  snapshot: UsageQuotaSnapshot

  constructor(snapshot: UsageQuotaSnapshot) {
    super('Daily quota exceeded')
    this.name = 'QuotaExceededError'
    this.snapshot = snapshot
  }
}

// 发送消息schema
const sendMessageSchema = z.object({
  sessionId: z.number().int().positive(),
  content: z.string().min(1).max(10000),
  // 可选图片数据：前端传入 data(base64，不含前缀)、mime
  images: z.array(z.object({ data: z.string().min(1), mime: z.string().min(1) })).max(4).optional(),
  // 即时开关（覆盖系统/会话默认）
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low','medium','high']).optional(),
  ollamaThink: z.boolean().optional(),
  saveReasoning: z.boolean().optional(),
  // 幂等ID：前端生成的 nonce，用于去重
  clientMessageId: z.string().min(1).max(128).optional(),
  contextEnabled: z.boolean().optional(),
  features: z
    .object({
      web_search: z.boolean().optional(),
    })
    .optional(),
});

const cancelStreamSchema = z.object({
  sessionId: z.number().int().positive(),
  clientMessageId: z.string().min(1).max(128).optional(),
});

// 获取会话消息历史
chat.get('/sessions/:sessionId/messages', actorMiddleware, async (c) => {
  try {
    const actor = c.get('actor') as Actor;
    const sessionId = parseInt(c.req.param('sessionId'));

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    // 验证会话是否存在且属于当前用户
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...sessionOwnershipClause(actor),
      },
    });

    if (!session) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');

    const [messages, total, siteBaseSetting] = await Promise.all([
      prisma.message.findMany({
        where: { sessionId },
        select: {
          id: true,
          sessionId: true,
          role: true,
          content: true,
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
        },
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
      }
      const rel = Array.isArray(attachments) ? attachments.map((att) => att.relativePath) : []
      return {
        ...rest,
        images: resolveChatImageUrls(rel, baseUrl),
        toolEvents: parseToolLogsJson(toolLogsJson),
      }
    });

    await extendAnonymousSession(actor, sessionId)

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

// 管理员：刷新图片访问地址（基于最新域名生成示例链接）
chat.post('/admin/attachments/refresh', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
  try {
    const siteBaseSetting = await prisma.systemSetting.findUnique({
      where: { key: 'site_base_url' },
      select: { value: true },
    })
    const baseUrl = determineChatImageBaseUrl({
      request: c.req.raw,
      siteBaseUrl: siteBaseSetting?.value ?? null,
    })

    let total = 0
    let samples: Array<{ id: number; messageId: number; relativePath: string }> = []
    try {
      total = await prisma.messageAttachment.count()
      samples = await prisma.messageAttachment.findMany({
        orderBy: { id: 'desc' },
        take: 5,
        select: { id: true, messageId: true, relativePath: true },
      })
    } catch (error) {
      if (isMessageAttachmentTableMissing(error)) {
        return c.json<ApiResponse>({
          success: false,
          error: `图片附件功能尚未初始化：${MESSAGE_ATTACHMENT_MIGRATION_HINT}`,
        }, 503)
      }
      throw error
    }

    const sampleUrls = samples.map((item) => ({
      id: item.id,
      messageId: item.messageId,
      url: resolveChatImageUrls([item.relativePath], baseUrl)[0] || '',
    }))

    return c.json<ApiResponse>({
      success: true,
      data: {
        baseUrl,
        attachments: total,
        samples: sampleUrls,
        refreshedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[attachments.refresh] error', error)
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : '刷新图片链接失败',
    }, 500)
  }
})

// 发送消息并获取AI响应（流式）
chat.post('/stream', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
  try {
    const actor = c.get('actor') as Actor;
    const userId = actor.type === 'user' ? actor.id : null;
    const payload = c.req.valid('json') as any;
    const { sessionId, content, images } = payload;
    const requestedFeatures = payload?.features || {};

    await logTraffic({
      category: 'client-request',
      route: '/api/chat/stream',
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
    })

    // 验证会话是否存在且属于当前用户
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...sessionOwnershipClause(actor),
      },
      include: {
        connection: true,
      },
    });

    if (!session) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    // 新模型选择：要求存在 connection + modelRawId
    if (!session.connectionId || !session.connection || !session.modelRawId) {
      return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400)
    }

    await extendAnonymousSession(actor, sessionId)

    const clientMessageIdInput = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : ''
    const clientMessageId = clientMessageIdInput || null
    const now = new Date()

    let userMessageRecord: any = null
    let messageWasReused = false
    let quotaSnapshot: UsageQuotaSnapshot | null = null

    try {
      await prisma.$transaction(async (tx) => {
        if (clientMessageId) {
          const existing = await tx.message.findUnique({
            where: { sessionId_clientMessageId: { sessionId, clientMessageId } },
          })
          if (existing) {
            userMessageRecord = existing
            messageWasReused = true
            quotaSnapshot = await inspectActorQuota(actor, { tx, now })
            return
          }
        } else {
          const existing = await tx.message.findFirst({
            where: { sessionId, role: 'user', content },
            orderBy: { createdAt: 'desc' },
          })
          if (existing) {
            const createdAt = existing.createdAt instanceof Date
              ? existing.createdAt
              : new Date(existing.createdAt as any)
            if (now.getTime() - createdAt.getTime() <= MESSAGE_DEDUPE_WINDOW_MS) {
              userMessageRecord = existing
              messageWasReused = true
              quotaSnapshot = await inspectActorQuota(actor, { tx, now })
              return
            }
          }
        }

        const consumeResult = await consumeActorQuota(actor, { tx, now })
        if (!consumeResult.success) {
          throw new QuotaExceededError(consumeResult.snapshot)
        }
        quotaSnapshot = consumeResult.snapshot

        userMessageRecord = await tx.message.create({
          data: {
            sessionId,
            role: 'user',
            content,
            ...(clientMessageId ? { clientMessageId } : {}),
          },
        })
      })
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return c.json({
          success: false,
          error: 'Daily quota exhausted',
          quota: serializeQuotaSnapshot(error.snapshot),
          requiredLogin: actor.type !== 'user',
        }, 429)
      }
      throw error
    }

    if (!userMessageRecord) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Failed to persist user message',
      }, 500)
    }

    if (images && images.length > 0 && userMessageRecord?.id && !messageWasReused) {
      await persistChatImages(images, {
        sessionId,
        messageId: userMessageRecord.id,
        userId: userId ?? 0,
        clientMessageId,
      });
    }

    if (actor.type === 'anonymous') {
      cleanupAnonymousSessions({ activeSessionId: sessionId }).catch((error) => {
        log.debug('Anonymous cleanup error', error);
      });
    }

    const contextEnabled = payload?.contextEnabled !== false;
    const contextLimit = await resolveContextLimit({
      connectionId: session.connectionId,
      rawModelId: session.modelRawId,
      provider: session.connection.provider,
    });

    let truncatedContext: Array<{ role: string; content: string }>;

    if (contextEnabled) {
      const recentMessages = await prisma.message.findMany({
        where: { sessionId },
        select: {
          role: true,
          content: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const conversationHistory = recentMessages
        .filter((msg: { role: string; content: string }) => msg.role !== 'user' || msg.content !== content)
        .reverse();

      const fullConversation = [
        ...conversationHistory,
        { role: 'user', content },
      ];

      truncatedContext = await Tokenizer.truncateMessages(
        fullConversation,
        contextLimit,
      );
    } else {
      truncatedContext = [{ role: 'user', content }];
    }

    // 统计上下文使用量（估算）
    const promptTokens = await Tokenizer.countConversationTokens(truncatedContext);
    const contextRemaining = Math.max(0, contextLimit - promptTokens);

    // 解密API Key（仅 bearer 时需要）
    const decryptedApiKey = session.connection.authType === 'bearer' && session.connection.apiKey
      ? AuthUtils.decryptApiKey(session.connection.apiKey)
      : ''

    const provider = session.connection.provider as 'openai' | 'azure_openai' | 'ollama'
    const baseUrl = session.connection.baseUrl.replace(/\/$/, '')
    const extraHeaders = session.connection.headersJson ? JSON.parse(session.connection.headersJson) : {}
    const authHeader: Record<string,string> = {}
    if (session.connection.authType === 'bearer' && decryptedApiKey) {
      authHeader['Authorization'] = `Bearer ${decryptedApiKey}`
    } else if (session.connection.authType === 'system_oauth') {
      const token = process.env.SYSTEM_OAUTH_TOKEN
      if (token) authHeader['Authorization'] = `Bearer ${token}`
    } else if (session.connection.authType === 'microsoft_entra_id' && provider === 'azure_openai') {
      try {
        const envToken = process.env.AZURE_ACCESS_TOKEN
        if (envToken) authHeader['Authorization'] = `Bearer ${envToken}`
        else {
          // 动态获取 Azure 访问令牌
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { DefaultAzureCredential } = require('@azure/identity')
          const cred = new DefaultAzureCredential()
          const token = await cred.getToken('https://cognitiveservices.azure.com/.default')
          if (token?.token) authHeader['Authorization'] = `Bearer ${token.token}`
        }
      } catch (e) {
        // 忽略失败：缺少依赖或凭据时不设置 Authorization
      }
    }

    log.debug('Chat stream request', { sessionId, actor: actor.identifier, provider, baseUrl, model: session.modelRawId })

    // 构建AI API请求
    // 先将历史消息（纯文本）放入
    const messagesPayload: any[] = truncatedContext.map((msg: { role: string; content: string }) => ({
      role: msg.role,
      content: msg.content,
    }));

    // 为当前用户消息构造多模态内容
    const parts: any[] = []
    if (content?.trim()) {
      parts.push({ type: 'text', text: content })
    }
    if (images && images.length) {
      for (const img of images) {
        parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })
      }
    }

    // 如果最后一条就是当前用户消息，则替换为 parts；否则追加一条
    const last = messagesPayload[messagesPayload.length - 1]
    if (last && last.role === 'user' && last.content === content) {
      messagesPayload[messagesPayload.length - 1] = { role: 'user', content: parts }
    } else {
      messagesPayload.push({ role: 'user', content: parts })
    }

    const requestData: any = {
      model: session.modelRawId,
      messages: messagesPayload,
      stream: true,
      temperature: 0.7,
    };

    // 供应商参数透传（系统设置控制）
    // 即时与会话/系统优先级：request > session > system/env
    const sessionDefaults = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { reasoningEnabled: true, reasoningEffort: true, ollamaThink: true } })
    // 读取系统设置以支持推理/思考等开关的默认值（需在使用 sysMap 前初始化）
    const sysRows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    const sysMap = sysRows.reduce((m, r) => { (m as any)[r.key] = r.value; return m; }, {} as Record<string, string>);
    const agentWebSearchConfig = buildAgentWebSearchConfig(sysMap);
    const retentionDaysRaw = sysMap.chat_image_retention_days || process.env.CHAT_IMAGE_RETENTION_DAYS || `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`
    const retentionDaysParsed = Number.parseInt(retentionDaysRaw, 10)
    cleanupExpiredChatImages(Number.isFinite(retentionDaysParsed) ? retentionDaysParsed : CHAT_IMAGE_DEFAULT_RETENTION_DAYS).catch((error) => {
      console.warn('[chat] cleanupExpiredChatImages', error)
    })
    const reqReasoningEnabled = payload.reasoningEnabled
    const reqReasoningEffort = payload.reasoningEffort
    const reqOllamaThink = payload.ollamaThink

    const effectiveReasoningEnabled = typeof reqReasoningEnabled === 'boolean'
      ? reqReasoningEnabled
      : (sessionDefaults?.reasoningEnabled ?? ((sysMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false'))

    const effectiveReasoningEffort = (reqReasoningEffort || sessionDefaults?.reasoningEffort || (sysMap.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || '')).toString()

    const effectiveOllamaThink = typeof reqOllamaThink === 'boolean'
      ? reqOllamaThink
      : ((sessionDefaults?.ollamaThink ?? ((sysMap.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true')) as boolean)

    const defaultReasoningSaveToDb = (sysMap.reasoning_save_to_db ?? (process.env.REASONING_SAVE_TO_DB ?? 'true'))
      .toString()
      .toLowerCase() === 'true';
    const effectiveReasoningSaveToDb =
      typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : defaultReasoningSaveToDb;

    if (effectiveReasoningEnabled && effectiveReasoningEffort) {
      requestData.reasoning_effort = effectiveReasoningEffort
    }
    if (effectiveReasoningEnabled && effectiveOllamaThink) {
      requestData.think = true
    }

    console.log('Starting AI stream request to:', baseUrl);

    // 设置 SSE 响应头（直接随返回的 Response 带回，避免丢失）
    // 说明：此前通过 c.header() 设置，但最终 `new Response(stream)` 未继承这些头，
    // 在某些代理/运行环境下会导致缓冲，无法逐块渲染。
    const sseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // 禁用 Nginx 缓冲，提升流式实时性
      'X-Accel-Buffering': 'no',
      // 兼容旧行为；实际 CORS 由全局中间件控制
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    };

    const webSearchFeatureRequested = requestedFeatures?.web_search === true;
    const providerSupportsTools = provider === 'openai' || provider === 'azure_openai';
    const agentWebSearchActive =
      webSearchFeatureRequested &&
      agentWebSearchConfig.enabled &&
      providerSupportsTools &&
      Boolean(agentWebSearchConfig.apiKey);

    if (agentWebSearchActive) {
      return await createAgentWebSearchResponse({
        session,
        sessionId,
        requestData,
        messagesPayload,
        promptTokens,
        contextLimit,
        contextRemaining,
        quotaSnapshot,
        userMessageRecord,
        sseHeaders,
        agentConfig: agentWebSearchConfig,
        provider,
        baseUrl,
        authHeader,
        extraHeaders,
        reasoningEnabled: effectiveReasoningEnabled,
        reasoningSaveToDb: effectiveReasoningSaveToDb,
        clientMessageId,
        actorIdentifier: actor.identifier,
        requestSignal: c.req.raw.signal,
      });
    }

    let aiResponseContent = '';
    // 推理相关累积
    let reasoningBuffer = '';
    const reasoningState = createReasoningState();
    let reasoningDoneEmitted = false;
    let reasoningDurationSeconds = 0;
    // 读取系统设置（若存在则覆盖环境变量），用于网络稳定性与 usage 行为

    // usage 透出与透传
    let USAGE_EMIT = (sysMap.usage_emit ?? (process.env.USAGE_EMIT ?? 'true')).toString().toLowerCase() !== 'false';
    let USAGE_PROVIDER_ONLY = (sysMap.usage_provider_only ?? (process.env.USAGE_PROVIDER_ONLY ?? 'false')).toString().toLowerCase() === 'true';
    // 心跳与超时参数
    const heartbeatIntervalMs = parseInt(sysMap.sse_heartbeat_interval_ms || process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000');
    const providerMaxIdleMs = parseInt(sysMap.provider_max_idle_ms || process.env.PROVIDER_MAX_IDLE_MS || '60000');
    const providerTimeoutMs = parseInt(sysMap.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000');

    // 推理链（CoT）配置
    const REASONING_ENABLED = (sysMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false';
    const REASONING_SAVE_TO_DB = effectiveReasoningSaveToDb;
    const REASONING_TAGS_MODE = (sysMap.reasoning_tags_mode ?? (process.env.REASONING_TAGS_MODE ?? 'default')).toString();
    const REASONING_CUSTOM_TAGS = (() => {
      try {
        const raw = sysMap.reasoning_custom_tags || process.env.REASONING_CUSTOM_TAGS || '';
        const arr = raw ? JSON.parse(raw) : null;
        if (Array.isArray(arr) && arr.length === 2 && typeof arr[0] === 'string' && typeof arr[1] === 'string') return [[arr[0], arr[1]] as [string, string]];
      } catch {}
      return null;
    })();
    const STREAM_DELTA_CHUNK_SIZE = Math.max(1, parseInt(sysMap.stream_delta_chunk_size || process.env.STREAM_DELTA_CHUNK_SIZE || '1'));
    const providerInitialGraceMs = Math.max(0, parseInt(sysMap.provider_initial_grace_ms || process.env.PROVIDER_INITIAL_GRACE_MS || '120000'));
    const providerReasoningIdleMs = Math.max(0, parseInt(sysMap.provider_reasoning_idle_ms || process.env.PROVIDER_REASONING_IDLE_MS || '300000'));
    const reasoningKeepaliveIntervalMs = Math.max(0, parseInt(sysMap.reasoning_keepalive_interval_ms || process.env.REASONING_KEEPALIVE_INTERVAL_MS || '0'));

    // 提前记录是否已收到厂商 usage（优先使用）
    let providerUsageSeen = false as boolean;
    let providerUsageSnapshot: any = null;
    // 兜底：在结束前可统计 completion_tokens
    let completionTokensFallback = 0 as number;
    const encoder = new TextEncoder();

    // 单次厂商请求（支持 429/5xx 退避一次）
    const providerRequestOnce = async (signal: AbortSignal): Promise<Response> => {
      let url = ''
      let body: any = { ...requestData }
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeader,
        ...extraHeaders,
      }
      if (provider === 'openai') {
        body = convertOpenAIReasoningPayload(body)
        url = `${baseUrl}/chat/completions`
      } else if (provider === 'azure_openai') {
        const v = session.connection?.azureApiVersion || '2024-02-15-preview'
        // Azure 使用 deployments/{model}/chat/completions
        body = convertOpenAIReasoningPayload(body)
        url = `${baseUrl}/openai/deployments/${encodeURIComponent(session.modelRawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`
      } else if (provider === 'ollama') {
        // 适配 Ollama chat 接口
        url = `${baseUrl}/api/chat`
        body = {
          model: session.modelRawId,
          messages: messagesPayload.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content?.map((p: any) => p.text).filter(Boolean).join('\n') })),
          stream: true,
        }
      } else {
        url = `${baseUrl}`
      }

      await logTraffic({
        category: 'upstream-request',
        route: '/api/chat/stream',
        direction: 'outbound',
        context: {
          sessionId,
          provider,
          url,
        },
        payload: {
          headers,
          body,
        },
      })

      try {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
        await logTraffic({
          category: 'upstream-response',
          route: '/api/chat/stream',
          direction: 'outbound',
          context: {
            sessionId,
            provider,
            url,
          },
          payload: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
          },
        })
        return response
      } catch (error: any) {
        await logTraffic({
          category: 'upstream-error',
          route: '/api/chat/stream',
          direction: 'outbound',
          context: {
            sessionId,
            provider,
            url,
          },
          payload: {
            message: error?.message || String(error),
          },
        })
        throw error
      }
    };

    const providerRequestWithBackoff = async (): Promise<Response> => {
      // 控制超时与空闲的 AbortController
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(new Error('provider request timeout')), providerTimeoutMs);
      try {
        let response = await providerRequestOnce(ac.signal);
        if (response.status === 429) {
          log.warn('Provider rate limited (429), backing off...', { backoffMs: BACKOFF_429_MS });
          await new Promise(r => setTimeout(r, BACKOFF_429_MS));
          response = await providerRequestOnce(ac.signal);
        } else if (response.status >= 500) {
          log.warn('Provider 5xx, backing off...', { status: response.status, backoffMs: BACKOFF_5XX_MS });
          await new Promise(r => setTimeout(r, BACKOFF_5XX_MS));
          response = await providerRequestOnce(ac.signal);
        }
        return response;
      } finally {
        clearTimeout(timeout);
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        class DownstreamClosedError extends Error {
          constructor(cause?: unknown) {
            super('SSE downstream closed');
            this.name = 'DownstreamClosedError';
            if (cause !== undefined) {
              (this as any).cause = cause;
            }
          }
        }

        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const stopHeartbeat = () => {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        };

        let downstreamAborted = false;
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        const requestSignal = c.req.raw.signal;

        const markDownstreamClosed = () => {
          if (downstreamAborted) return;
          downstreamAborted = true;
          stopHeartbeat();
          if (reader) {
            try {
              const cancelled = reader.cancel();
              cancelled?.catch?.(() => {});
            } catch {}
            reader = null;
          }
        };

        const safeEnqueue = (payload: string) => {
          if (!downstreamAborted && requestSignal?.aborted) {
            markDownstreamClosed();
          }
          if (downstreamAborted) {
            throw new DownstreamClosedError();
          }
          try {
            controller.enqueue(encoder.encode(payload));
          } catch (err) {
            markDownstreamClosed();
            console.warn('SSE downstream closed, stop streaming', err);
            throw new DownstreamClosedError(err);
          }
        };

        const handleAbort = () => {
          markDownstreamClosed();
        };
        if (requestSignal) {
          if (requestSignal.aborted) {
            markDownstreamClosed();
          } else {
            requestSignal.addEventListener('abort', handleAbort);
          }
        }

        try {
          // 发送开始事件
          const startEvent = `data: ${JSON.stringify({
            type: 'start',
            messageId: userMessageRecord?.id ?? null,
          })}\n\n`;
          safeEnqueue(startEvent);

          if (quotaSnapshot) {
            const quotaEvent = `data: ${JSON.stringify({
              type: 'quota',
              quota: serializeQuotaSnapshot(quotaSnapshot),
            })}\n\n`;
            safeEnqueue(quotaEvent);
          }

          // 在开始后透出一次 usage（prompt 部分）
          if (USAGE_EMIT && !USAGE_PROVIDER_ONLY) {
            const usageEvent = `data: ${JSON.stringify({
              type: 'usage',
              usage: {
                prompt_tokens: promptTokens,
                // 初值 total 以 prompt 为主，completion 将在结束前补齐
                total_tokens: promptTokens,
                context_limit: contextLimit,
                context_remaining: contextRemaining,
              },
            })}\n\n`;
            safeEnqueue(usageEvent);
          }

          // 调用第三方AI API（带退避）
          const response = await providerRequestWithBackoff();

          log.debug('AI provider response', { status: response.status, ok: response.ok })
          if (!response.ok) {
            throw new Error(`AI API request failed: ${response.status} ${response.statusText}`);
          }

          // 处理流式响应
          const responseBody = response.body;
          if (!responseBody) {
            throw new Error('No response body reader');
          }
          reader = responseBody.getReader();

          const decoder = new TextDecoder();
          let buffer = '';

          const requestStartedAt = Date.now();
          let firstChunkAt: number | null = null;
          let lastChunkAt: number | null = null;
          let lastKeepaliveSentAt = 0;
          let pendingVisibleDelta = '';
          let visibleDeltaCount = 0;
          let pendingReasoningDelta = '';
          let reasoningDeltaCount = 0;
          let providerDone = false;

          const flushVisibleDelta = (force = false) => {
            if (!pendingVisibleDelta) return;
            if (!force && visibleDeltaCount < STREAM_DELTA_CHUNK_SIZE) return;
            aiResponseContent += pendingVisibleDelta;
            const contentEvent = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`;
            safeEnqueue(contentEvent);
            pendingVisibleDelta = '';
            visibleDeltaCount = 0;
          };

          const flushReasoningDelta = (force = false) => {
            if (!pendingReasoningDelta) return;
            if (!force && reasoningDeltaCount < STREAM_DELTA_CHUNK_SIZE) return;
            reasoningBuffer += pendingReasoningDelta;
            const reasoningEvent = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`;
            safeEnqueue(reasoningEvent);
            pendingReasoningDelta = '';
            reasoningDeltaCount = 0;
          };

          const emitReasoningKeepalive = (idleMs: number) => {
            const keepaliveEvent = `data: ${JSON.stringify({ type: 'reasoning', keepalive: true, idle_ms: idleMs })}\n\n`;
            safeEnqueue(keepaliveEvent);
            lastKeepaliveSentAt = Date.now();
          };

          // 心跳&空闲监控
          heartbeat = setInterval(() => {
            try {
              // SSE 注释心跳（客户端忽略），同时也可用 data: keepalive
              safeEnqueue(': ping\n\n');
            } catch {}
            const now = Date.now();
            if (!firstChunkAt) {
              if (providerInitialGraceMs > 0 && now - requestStartedAt > providerInitialGraceMs) {
                try { (response as any)?.body?.cancel?.(); } catch {}
              }
              return;
            }
            const last = lastChunkAt ?? firstChunkAt;
            const idleMs = now - last;
            if (providerReasoningIdleMs > 0 && idleMs > providerReasoningIdleMs) {
              try { (response as any)?.body?.cancel?.(); } catch {}
              return;
            }
            if (reasoningKeepaliveIntervalMs > 0 && idleMs > reasoningKeepaliveIntervalMs && now - lastKeepaliveSentAt > reasoningKeepaliveIntervalMs) {
              try {
                flushReasoningDelta(true);
                flushVisibleDelta(true);
                emitReasoningKeepalive(idleMs);
              } catch {}
            }
          }, Math.max(1000, heartbeatIntervalMs));

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const now = Date.now();
            lastChunkAt = now;
            if (!firstChunkAt) firstChunkAt = now;
            lastKeepaliveSentAt = now;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const l = line.replace(/\r$/, '');
              if (!l.startsWith('data: ')) continue;

              const data = l.slice(6);
              log.debug('SSE line', data?.slice(0, 120));

              if (data === '[DONE]') {
                flushReasoningDelta(true);
                flushVisibleDelta(true);
                // 流结束
                const endEvent = `data: ${JSON.stringify({
                  type: 'end',
                })}\n\n`;
                safeEnqueue(endEvent);
                providerDone = true;
                break;
              }

              let parsed: any;
              try {
                parsed = JSON.parse(data);
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', data, parseError);
                continue;
              }

              // 提取AI响应内容
              const deltaContent: string | undefined = parsed.choices?.[0]?.delta?.content;
              const deltaReasoning: string | undefined = parsed.choices?.[0]?.delta?.reasoning_content;

              // 供应商原生 reasoning_content（OpenAI 等）
              if (REASONING_ENABLED && deltaReasoning) {
                if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                pendingReasoningDelta += deltaReasoning;
                reasoningDeltaCount += 1;
                flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
              }

              if (deltaContent) {
                let visible = deltaContent;
                if (REASONING_ENABLED && REASONING_TAGS_MODE !== 'off') {
                  const tags = REASONING_TAGS_MODE === 'custom' && REASONING_CUSTOM_TAGS ? REASONING_CUSTOM_TAGS : DEFAULT_REASONING_TAGS;
                  const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState);
                  visible = visibleDelta;
                  if (reasoningDelta) {
                    if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                    pendingReasoningDelta += reasoningDelta;
                    reasoningDeltaCount += 1;
                    flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                  }
                }

                if (visible) {
                  pendingVisibleDelta += visible;
                  visibleDeltaCount += 1;
                  flushVisibleDelta(visibleDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                }
              }

              // 结束原因（如果可用）
              const fr = parsed.choices?.[0]?.finish_reason;
              if (fr) {
                const stopEvent = `data: ${JSON.stringify({
                  type: 'stop',
                  reason: fr,
                })}\n\n`;
                safeEnqueue(stopEvent);
              }

              // 厂商 usage 透传（优先级更高）
              if (USAGE_EMIT && parsed.usage) {
                // 仅当厂商 usage 含有效数值时，才标记为已接收，避免空对象/全0 覆盖本地估算
                const n = (u: any) => ({
                  prompt: Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0,
                  completion: Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0,
                  total: Number(u?.total_tokens ?? 0) || 0,
                });
                const nn = n(parsed.usage);
                const valid = (nn.prompt > 0) || (nn.completion > 0) || (nn.total > 0);
                if (valid) {
                  providerUsageSeen = true;
                  providerUsageSnapshot = parsed.usage;
                }
                const providerUsageEvent = `data: ${JSON.stringify({
                  type: 'usage',
                  usage: parsed.usage,
                })}\n\n`;
                safeEnqueue(providerUsageEvent);
              }
            }

            if (providerDone || downstreamAborted) {
              break;
            }
          }

          flushReasoningDelta(true);
          flushVisibleDelta(true);
          stopHeartbeat();

          // 推理结束事件（若产生过推理）
          if (REASONING_ENABLED && !reasoningDoneEmitted && reasoningBuffer.trim()) {
            const endedAt = Date.now();
            if (reasoningState.startedAt) {
              reasoningDurationSeconds = Math.max(0, Math.round((endedAt - reasoningState.startedAt) / 1000));
            }
            const reasoningDoneEvent = `data: ${JSON.stringify({ type: 'reasoning', done: true, duration: reasoningDurationSeconds })}\n\n`;
            safeEnqueue(reasoningDoneEvent);
            reasoningDoneEmitted = true;
          }

          // 保存AI完整回复延后到完成阶段，以便与 usage 绑定

          // 在完成前透出兜底 usage（若未收到厂商 usage，或未设置仅透传）
          if (USAGE_EMIT && (!USAGE_PROVIDER_ONLY || !providerUsageSeen)) {
            try {
              completionTokensFallback = await Tokenizer.countTokens(aiResponseContent);
            } catch (_) {
              completionTokensFallback = 0;
            }
            const finalUsageEvent = `data: ${JSON.stringify({
              type: 'usage',
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokensFallback,
                total_tokens: promptTokens + completionTokensFallback,
                context_limit: contextLimit,
                context_remaining: Math.max(0, contextLimit - promptTokens),
              },
            })}\n\n`;
            safeEnqueue(finalUsageEvent);
          }

          // 发送完成事件
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
          })}\n\n`;
          safeEnqueue(completeEvent);

          // 完成后持久化 usage（优先厂商 usage，否则兜底估算）
          try {
            const extractNumbers = (u: any): { prompt: number; completion: number; total: number } => {
              try {
                const prompt = Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0;
                const completion = Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0;
                const total = Number(u?.total_tokens ?? (prompt + completion)) || (prompt + completion);
                return { prompt, completion, total };
              } catch {
                return { prompt: 0, completion: 0, total: 0 };
              }
            };

            // 若厂商 usage 无效（全0/空），则回退到本地估算
            const providerNums = providerUsageSeen ? extractNumbers(providerUsageSnapshot) : { prompt: 0, completion: 0, total: 0 }
            const providerValid = (providerNums.prompt > 0) || (providerNums.completion > 0) || (providerNums.total > 0)
            const finalUsage = providerValid
              ? providerNums
              : { prompt: promptTokens, completion: completionTokensFallback, total: promptTokens + completionTokensFallback };

            // 保存AI完整回复（若尚未保存）并记录 messageId
            let assistantMessageId: number | null = null;
            if (aiResponseContent.trim()) {
              try {
                const saved = await prisma.message.create({
                  data: {
                    sessionId,
                    role: 'assistant',
                    content: aiResponseContent.trim(),
                    ...(REASONING_ENABLED && (typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : REASONING_SAVE_TO_DB) && reasoningBuffer.trim()
                      ? { reasoning: reasoningBuffer.trim(), reasoningDurationSeconds }
                      : {}),
                  },
                });
                assistantMessageId = saved?.id ?? null;
              } catch (e) {
                // 若已保存过则忽略错误
              }
            }

            if (USAGE_EMIT) {
              await (prisma as any).usageMetric.create({
                data: {
                  sessionId,
                  messageId: assistantMessageId ?? undefined,
                  model: session.modelRawId || 'unknown',
                  provider: (() => { try { const u = new URL(baseUrl); return u.hostname; } catch { return null; } })() ?? undefined,
                  promptTokens: finalUsage.prompt,
                  completionTokens: finalUsage.completion,
                  totalTokens: finalUsage.total,
                  contextLimit: contextLimit,
                },
              });
            }
          } catch (persistErr) {
            console.warn('Persist usage failed:', persistErr);
          }

        } catch (error) {
          if (error instanceof DownstreamClosedError || downstreamAborted) {
            log.debug('Streaming aborted: SSE downstream closed');
            return;
          }

          console.error('Streaming error:', error);
          log.error('Streaming error detail', (error as Error)?.message, (error as Error)?.stack)

          // 若尚未输出内容，尝试降级为非流式一次
          if (!aiResponseContent) {
            try {
              const nonStreamData = { ...requestData, stream: false } as any;
              const ac = new AbortController();
              const timeout = setTimeout(() => ac.abort(new Error('provider non-stream timeout')), providerTimeoutMs);
              // 构造非流式请求 URL/Body 与上面一致
              let url = ''
              let body: any = { ...nonStreamData }
              let headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...authHeader,
                ...extraHeaders,
              }
              if (provider === 'openai') {
                url = `${baseUrl}/chat/completions`
              } else if (provider === 'azure_openai') {
                const v = session.connection?.azureApiVersion || '2024-02-15-preview'
                url = `${baseUrl}/openai/deployments/${encodeURIComponent(session.modelRawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`
              } else if (provider === 'ollama') {
                url = `${baseUrl}/api/chat`
                body = {
                  model: session.modelRawId,
                  messages: messagesPayload.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content?.map((p: any) => p.text).filter(Boolean).join('\n') })),
                  stream: false,
                }
              }
              const resp = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: ac.signal,
              });
              clearTimeout(timeout);
              if (resp.ok) {
                const j = await resp.json() as ProviderChatCompletionResponse;
                const text = j?.choices?.[0]?.message?.content || '';
                if (text) {
                  aiResponseContent = text;
                  safeEnqueue(`data: ${JSON.stringify({ type: 'content', content: text })}\n\n`);
                  safeEnqueue(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
                  return;
                }
              }
            } catch (e) {
              // ignore
            }
          }

          // 发送错误事件
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`;
          safeEnqueue(errorEvent);
        } finally {
          if (requestSignal) {
            try {
              requestSignal.removeEventListener('abort', handleAbort);
            } catch {}
          }
          try {
            stopHeartbeat();
            controller.close();
          } catch {}
        }
      },
    });

    await logTraffic({
      category: 'client-response',
      route: '/api/chat/stream',
      direction: 'inbound',
      context: {
        sessionId,
        actor: actor.identifier,
      },
      payload: {
        status: 200,
        stream: true,
      },
    })
    return c.newResponse(stream as any, 200, sseHeaders);

  } catch (error) {
    console.error('Chat stream error:', error);
    log.error('Chat stream error detail', (error as Error)?.message, (error as Error)?.stack)
    await logTraffic({
      category: 'client-response',
      route: '/api/chat/stream',
      direction: 'inbound',
      context: {
        actor: (() => {
          try { return (c.get('actor') as Actor | undefined)?.identifier }
          catch { return undefined }
        })(),
      },
      payload: {
        status: 500,
        error: (error as Error)?.message || String(error),
      },
    })
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to process chat request',
    }, 500);
  }
});

chat.post('/stream/cancel', actorMiddleware, zValidator('json', cancelStreamSchema), async (c) => {
  const actor = c.get('actor') as Actor;
  const payload = c.req.valid('json');
  const { sessionId, clientMessageId } = payload;
  const key = buildAgentStreamKey(sessionId, clientMessageId ?? null);
  if (!key) {
    return c.json<ApiResponse>({ success: true });
  }
  const meta = agentStreamControllers.get(key);
  if (!meta || meta.actorId !== actor.identifier || meta.sessionId !== sessionId) {
    return c.json<ApiResponse>({ success: true });
  }
  meta.cancelled = true;
  try {
    meta.controller?.abort();
  } catch {}
  return c.json<ApiResponse>({ success: true });
});

// 非流式：同步返回完整回复
chat.post('/completion', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
  try {
    const actor = c.get('actor') as Actor
    const userId = actor.type === 'user' ? actor.id : null
    const payload = c.req.valid('json') as any
    const { sessionId, content, images } = payload

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
    })

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...sessionOwnershipClause(actor),
      },
      include: { connection: true },
    })
    if (!session) {
      return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404)
    }
    if (!session.connectionId || !session.connection || !session.modelRawId) {
      return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400)
    }

    await extendAnonymousSession(actor, sessionId)

    const clientMessageIdInput = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : ''
    const clientMessageId = clientMessageIdInput || null
    const now = new Date()

    let userMessageRecord: any = null
    let messageWasReused = false
    let quotaSnapshot: UsageQuotaSnapshot | null = null

    try {
      await prisma.$transaction(async (tx) => {
        if (clientMessageId) {
          const existing = await tx.message.findUnique({
            where: { sessionId_clientMessageId: { sessionId, clientMessageId } },
          })
          if (existing) {
            userMessageRecord = existing
            messageWasReused = true
            quotaSnapshot = await inspectActorQuota(actor, { tx, now })
            return
          }
        } else {
          const existing = await tx.message.findFirst({
            where: { sessionId, role: 'user', content },
            orderBy: { createdAt: 'desc' },
          })
          if (existing) {
            const createdAt = existing.createdAt instanceof Date
              ? existing.createdAt
              : new Date(existing.createdAt as any)
            if (now.getTime() - createdAt.getTime() <= MESSAGE_DEDUPE_WINDOW_MS) {
              userMessageRecord = existing
              messageWasReused = true
              quotaSnapshot = await inspectActorQuota(actor, { tx, now })
              return
            }
          }
        }

        const consumeResult = await consumeActorQuota(actor, { tx, now })
        if (!consumeResult.success) {
          throw new QuotaExceededError(consumeResult.snapshot)
        }
        quotaSnapshot = consumeResult.snapshot

        userMessageRecord = await tx.message.create({
          data: {
            sessionId,
            role: 'user',
            content,
            ...(clientMessageId ? { clientMessageId } : {}),
          },
        })
      })
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return c.json({
          success: false,
          error: 'Daily quota exhausted',
          quota: serializeQuotaSnapshot(error.snapshot),
          requiredLogin: actor.type !== 'user',
        }, 429)
      }
      throw error
    }

    if (!userMessageRecord) {
      return c.json<ApiResponse>({ success: false, error: 'Failed to persist user message' }, 500)
    }

    if (images && images.length > 0 && userMessageRecord?.id && !messageWasReused) {
      await persistChatImages(images, {
        sessionId,
        messageId: userMessageRecord.id,
        userId: userId ?? 0,
        clientMessageId,
      })
    }

    if (actor.type === 'anonymous') {
      cleanupAnonymousSessions({ activeSessionId: sessionId }).catch((error) => {
        log.debug('Anonymous cleanup error', error)
      })
    }

    const contextEnabled = payload?.contextEnabled !== false;
    const contextLimit = await resolveContextLimit({
      connectionId: session.connectionId,
      rawModelId: session.modelRawId,
      provider: session.connection.provider,
    });

    let truncated: Array<{ role: string; content: string }>;
    if (contextEnabled) {
      const recent = await prisma.message.findMany({
        where: { sessionId },
        select: { role: true, content: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const conversation = recent
        .filter((msg: { role: string; content: string }) => msg.role !== 'user' || msg.content !== content)
        .reverse();
      truncated = await Tokenizer.truncateMessages(conversation.concat([{ role: 'user', content }]), contextLimit);
    } else {
      truncated = [{ role: 'user', content }];
    }
    const promptTokens = await Tokenizer.countConversationTokens(truncated);

    const decryptedApiKey = session.connection.authType === 'bearer' && session.connection.apiKey
      ? AuthUtils.decryptApiKey(session.connection.apiKey)
      : ''

    const messagesPayload: any[] = truncated.map((m: any) => ({ role: m.role, content: m.content }));
    const parts: any[] = [];
    if (content?.trim()) parts.push({ type: 'text', text: content });
    if (images && images.length) {
      for (const img of images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } });
    }
    const last = messagesPayload[messagesPayload.length - 1];
    if (last && last.role === 'user' && last.content === content) messagesPayload[messagesPayload.length - 1] = { role: 'user', content: parts };
    else messagesPayload.push({ role: 'user', content: parts });

    const provider = session.connection.provider as 'openai'|'azure_openai'|'ollama'
    const baseUrl = session.connection.baseUrl.replace(/\/$/, '')
    const extraHeaders = session.connection.headersJson ? JSON.parse(session.connection.headersJson) : {}
    let body: any = { model: session.modelRawId, messages: messagesPayload, stream: false, temperature: 0.7 };
    const settingsRows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    const settingsMap = settingsRows.reduce((m, r) => { (m as any)[r.key] = r.value; return m; }, {} as Record<string, string>);
    const retentionDaysRaw = settingsMap.chat_image_retention_days || process.env.CHAT_IMAGE_RETENTION_DAYS || `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`
    const retentionDaysParsed = Number.parseInt(retentionDaysRaw, 10)
    cleanupExpiredChatImages(Number.isFinite(retentionDaysParsed) ? retentionDaysParsed : CHAT_IMAGE_DEFAULT_RETENTION_DAYS).catch((error) => {
      console.warn('[chat] cleanupExpiredChatImages', error)
    })
    // 非流式补全请求的超时（毫秒），优先系统设置，其次环境变量，默认 5 分钟
    const providerTimeoutMs = parseInt(settingsMap.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000');
    const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { reasoningEnabled: true, reasoningEffort: true, ollamaThink: true } })
    const ren = typeof payload?.reasoningEnabled === 'boolean' ? payload.reasoningEnabled : (sess?.reasoningEnabled ?? ((settingsMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false'))
    const ref = (payload?.reasoningEffort || sess?.reasoningEffort || (settingsMap.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || '')).toString()
    const otk = typeof payload?.ollamaThink === 'boolean' ? payload.ollamaThink : ((sess?.ollamaThink ?? ((settingsMap.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true')) as boolean)
    if (ren && ref) body.reasoning_effort = ref
    if (ren && otk) body.think = true

    let url = ''
    if (provider === 'openai') {
      url = `${baseUrl}/chat/completions`
    } else if (provider === 'azure_openai') {
      const v = session.connection.azureApiVersion || '2024-02-15-preview'
      url = `${baseUrl}/openai/deployments/${encodeURIComponent(session.modelRawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`
    } else if (provider === 'ollama') {
      url = `${baseUrl}/api/chat`
      body = {
        model: session.modelRawId,
        messages: messagesPayload.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content?.map((p: any) => p.text).filter(Boolean).join('\n') })),
        stream: false,
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(session.connection.authType === 'bearer' && decryptedApiKey ? { 'Authorization': `Bearer ${decryptedApiKey}` } : {}),
      ...extraHeaders,
    }
    const doOnce = async (signal: AbortSignal) => {
      await logTraffic({
        category: 'upstream-request',
        route: '/api/chat/completion',
        direction: 'outbound',
        context: {
          sessionId,
          provider,
          url,
        },
        payload: {
          headers,
          body,
        },
      })
      try {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
        await logTraffic({
          category: 'upstream-response',
          route: '/api/chat/completion',
          direction: 'outbound',
          context: {
            sessionId,
            provider,
            url,
          },
          payload: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
          },
        })
        return response
      } catch (error: any) {
        await logTraffic({
          category: 'upstream-error',
          route: '/api/chat/completion',
          direction: 'outbound',
          context: {
            sessionId,
            provider,
            url,
          },
          payload: {
            message: error?.message || String(error),
          },
        })
        throw error
      }
    }
    const requestWithBackoff = async () => {
      const ac = new AbortController();
      const tout = setTimeout(() => ac.abort(new Error('provider timeout')), providerTimeoutMs);
      try {
        let r = await doOnce(ac.signal);
        if (r.status === 429) { await new Promise(rz => setTimeout(rz, BACKOFF_429_MS)); r = await doOnce(ac.signal); }
        else if (r.status >= 500) { await new Promise(rz => setTimeout(rz, BACKOFF_5XX_MS)); r = await doOnce(ac.signal); }
        return r;
      } finally { clearTimeout(tout); }
    };

    const resp = await requestWithBackoff();
    if (!resp.ok) {
      await logTraffic({
        category: 'client-response',
        route: '/api/chat/completion',
        direction: 'inbound',
        context: {
          sessionId,
          actor: actor.identifier,
        },
        payload: {
          status: resp.status,
          statusText: resp.statusText,
        },
      })
      return c.json<ApiResponse>({ success: false, error: `AI API request failed: ${resp.status} ${resp.statusText}` }, 502);
    }
    const json = await resp.json() as ProviderChatCompletionResponse;
    await logTraffic({
      category: 'upstream-response',
      route: '/api/chat/completion',
      direction: 'outbound',
      context: {
        sessionId,
        provider,
        url,
        stage: 'parsed',
      },
      payload: {
        status: resp.status,
        body: json,
      },
    })
    const text = json?.choices?.[0]?.message?.content || '';
    const fallbackReasoning: string | undefined = json?.choices?.[0]?.message?.reasoning_content || json?.message?.thinking || undefined;
    const u = json?.usage || {};
    const usage = {
      prompt_tokens: Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? promptTokens) || promptTokens,
      completion_tokens: Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0,
      total_tokens: Number(u?.total_tokens ?? 0) || (promptTokens + (Number(u?.completion_tokens ?? 0) || 0)),
      context_limit: contextLimit,
      context_remaining: Math.max(0, contextLimit - promptTokens),
    };

    let assistantMsgId: number | null = null;
    const sessionStillExists = async () => {
      const count = await prisma.chatSession.count({ where: { id: sessionId } });
      return count > 0;
    };
    if (text && (await sessionStillExists())) {
      const saveFlag = (() => {
        if (typeof payload?.saveReasoning === 'boolean') return payload.saveReasoning
        return true
      })()
      try {
        const saved = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: text,
            ...((fallbackReasoning && saveFlag) ? { reasoning: String(fallbackReasoning) } : {}),
          },
        });
        assistantMsgId = saved.id;
      } catch (persistErr) {
        console.warn('Persist assistant message failed:', persistErr);
      }
    } else if (text) {
      console.warn('Skip persisting assistant message because session no longer exists', { sessionId });
    }
    try {
      if (await sessionStillExists()) {
        await (prisma as any).usageMetric.create({
          data: {
            sessionId,
            messageId: assistantMsgId ?? undefined,
            model: session.modelRawId || 'unknown',
            provider: (() => { try { const u = new URL(baseUrl); return u.hostname; } catch { return null; } })() ?? undefined,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            contextLimit: contextLimit,
          },
        });
      } else {
        console.warn('Skip persisting usage metric because session no longer exists', { sessionId });
      }
    } catch (persistErr) {
      console.warn('Persist usage metric failed:', persistErr);
    }

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
        contentPreview: text,
        usage,
        quota: quotaSnapshot ? serializeQuotaSnapshot(quotaSnapshot) : null,
      },
    })

    return c.json<ApiResponse<{ content: string; usage: typeof usage; quota?: ReturnType<typeof serializeQuotaSnapshot> | null }>>({
      success: true,
      data: {
        content: text,
        usage,
        quota: quotaSnapshot ? serializeQuotaSnapshot(quotaSnapshot) : null,
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
          try { return (c.get('actor') as Actor | undefined)?.identifier }
          catch { return undefined }
        })(),
      },
      payload: {
        status: 500,
        error: (error as Error)?.message || String(error),
      },
    })
    return c.json<ApiResponse>({ success: false, error: 'Failed to process non-stream completion' }, 500);
  }
});

// 停止生成（前端可通过关闭连接实现，这里提供确认接口）
chat.post('/stop', actorMiddleware, zValidator('json', z.object({
  sessionId: z.number().int().positive(),
})), async (c) => {
  // 这个接口主要用于前端确认停止生成
  // 实际的停止是通过客户端关闭SSE连接实现的
  return c.json<ApiResponse>({
    success: true,
    message: 'Stop request received',
  });
});

// 重新生成AI回复
chat.post('/regenerate', actorMiddleware, zValidator('json', z.object({
  sessionId: z.number().int().positive(),
  messageId: z.number().int().positive(), // 要重新生成的消息ID
})), async (c) => {
  try {
    const user = c.get('user') as { id: number } | undefined;
    if (!user || typeof user.id !== 'number') {
      return c.json<ApiResponse>({ success: false, error: 'User context missing' }, { status: 401 });
    }
    const { sessionId, messageId } = c.req.valid('json');

    // 验证会话和消息权限
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
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    if (!message || message.sessionId !== sessionId) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Message not found',
      }, 404);
    }

    if (message.role !== 'assistant') {
      return c.json<ApiResponse>({
        success: false,
        error: 'Can only regenerate assistant messages',
      }, 400);
    }

    // 找到对应的用户消息
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

    // 删除原有的AI回复
    await prisma.message.delete({
      where: { id: messageId },
    });

    // 这里简化处理，实际应该重新调用AI API
    // 为了简化，我们返回一个提示让前端重新发送请求
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

// 统一生成接口（非会话态），按 provider 映射到相应 generate API
// 入参：{ connectionId?: number, modelId?: string, prompt: string, stream?: boolean }
chat.post('/generate', actorMiddleware, zValidator('json', z.object({
  connectionId: z.number().int().positive().optional(),
  modelId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  stream: z.boolean().optional(),
})), async (c) => {
  try {
    const user = c.get('user')
    const body = c.req.valid('json') as any
    let conn = null as any
    let rawId: string | null = null

    if (body.connectionId) {
      conn = await prisma.connection.findFirst({ where: { id: body.connectionId, ownerUserId: null } })
      if (!conn) return c.json<ApiResponse>({ success: false, error: 'Connection not found' }, 404)
      rawId = body.modelId || null
    } else if (body.modelId) {
      const cached = await prisma.modelCatalog.findFirst({ where: { modelId: body.modelId } })
      if (!cached) return c.json<ApiResponse>({ success: false, error: 'Model not found' }, 404)
      conn = await prisma.connection.findUnique({ where: { id: cached.connectionId } })
      rawId = cached.rawId
    } else {
      return c.json<ApiResponse>({ success: false, error: 'connectionId or modelId required' }, 400)
    }

    const baseUrl = conn.baseUrl.replace(/\/$/, '')
    const provider = conn.provider as 'openai'|'azure_openai'|'ollama'
    const decryptedApiKey = conn.authType === 'bearer' && conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : ''
    const extraHeaders = conn.headersJson ? JSON.parse(conn.headersJson) : {}
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(conn.authType === 'bearer' && decryptedApiKey ? { 'Authorization': `Bearer ${decryptedApiKey}` } : {}),
      ...extraHeaders,
    }

    if (provider === 'ollama') {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: rawId, prompt: body.prompt, stream: !!body.stream }),
      })
      const text = await res.text()
      return c.text(text, toContentfulStatus(res.status))
    } else if (provider === 'openai' || provider === 'azure_openai') {
      const messages = [{ role: 'user', content: body.prompt }]
      let url = ''
      if (provider === 'openai') url = `${baseUrl}/chat/completions`
      else {
        const v = conn.azureApiVersion || '2024-02-15-preview'
        url = `${baseUrl}/openai/deployments/${encodeURIComponent(rawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: rawId, messages, stream: !!body.stream }) })
      const json = await res.json()
      return c.json(json, toContentfulStatus(res.status))
    }
    return c.json<ApiResponse>({ success: false, error: 'Unsupported provider' }, 400)
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e?.message || 'Generate failed' }, 500)
  }
})

export default chat;

// 用量聚合查询
chat.get('/usage', actorMiddleware, async (c) => {
  try {
    const actor = c.get('actor') as Actor | undefined;
    const sessionId = parseInt(c.req.query('sessionId') || '0');
    if (!sessionId || Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400);
    }

    if (!actor) {
      return c.json<ApiResponse>({ success: false, error: 'Actor context missing' }, 401);
    }

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        ...(actor.type === 'user'
          ? { userId: actor.id }
          : { anonymousKey: actor.key }),
      },
      include: { connection: true },
    });
    if (!session) {
      return c.json<ApiResponse>({
        success: true,
        data: {
          totals: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          last_round: null,
          current: { prompt_tokens: 0, context_limit: null, context_remaining: null },
        },
      });
    }

    // 聚合
    const [metrics, last] = await Promise.all([
      (prisma as any).usageMetric.findMany({ where: { sessionId } }),
      (prisma as any).usageMetric.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const totals = metrics.reduce((acc: { prompt_tokens: number; completion_tokens: number; total_tokens: number }, m: any) => {
      acc.prompt_tokens += Number(m.promptTokens || 0);
      acc.completion_tokens += Number(m.completionTokens || 0);
      acc.total_tokens += Number(m.totalTokens || 0);
      return acc;
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

    // 即时上下文占用（估算）
    const contextLimit = await resolveContextLimit({
      connectionId: session.connectionId,
      rawModelId: session.modelRawId,
      provider: session.connection?.provider,
    });
    const recentMessages = await prisma.message.findMany({
      where: { sessionId },
      select: { role: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const conversation = [...recentMessages].reverse();
    const used = await Tokenizer.countConversationTokens(conversation as Array<{ role: string; content: string }>);
    const current = {
      prompt_tokens: used,
      context_limit: contextLimit,
      context_remaining: Math.max(0, contextLimit - used),
    };

    return c.json<ApiResponse>({
      success: true,
      data: {
        totals,
        last_round: last ? {
          prompt_tokens: Number((last as any).promptTokens || 0),
          completion_tokens: Number((last as any).completionTokens || 0),
          total_tokens: Number((last as any).totalTokens || 0),
          context_limit: (last as any).contextLimit ?? null,
          createdAt: (last as any).createdAt,
          model: (last as any).model,
          provider: (last as any).provider,
        } : null,
        current,
      },
    });
  } catch (error) {
    console.error('Get usage error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch usage' }, 500);
  }
});

// 所有会话的用量聚合（当前用户）
chat.get('/sessions/usage', actorMiddleware, async (c) => {
  try {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor) {
      return c.json<ApiResponse>({ success: false, error: 'Actor context missing' }, 401);
    }

    const whereClause = actor.type === 'user'
      ? { userId: actor.id }
      : { anonymousKey: actor.key };

    const sessions = await prisma.chatSession.findMany({
      where: whereClause,
      select: { id: true },
    });
    const sessionIds = sessions.map(s => s.id);
    if (!sessionIds.length) {
      return c.json<ApiResponse>({ success: true, data: [] });
    }

    // groupBy 汇总每个 session 的 totals
    const grouped = await (prisma as any).usageMetric.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIds } },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
    });

    const result = grouped.map((g: any) => ({
      sessionId: g.sessionId,
      totals: {
        prompt_tokens: Number(g._sum?.promptTokens || 0),
        completion_tokens: Number(g._sum?.completionTokens || 0),
        total_tokens: Number(g._sum?.totalTokens || 0),
      },
    }));

    return c.json<ApiResponse>({ success: true, data: result });
  } catch (error) {
    console.error('Get sessions usage error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch sessions usage' }, 500);
  }
});

// 按日统计导出（JSON）: /api/chat/usage/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&sessionId=optional
chat.get('/usage/daily', actorMiddleware, async (c) => {
  try {
    const user = c.get('user') as { id: number } | undefined;
    if (!user || typeof user.id !== 'number') {
      return c.json<ApiResponse>({ success: false, error: 'User context missing' }, { status: 401 });
    }
    const from = c.req.query('from');
    const to = c.req.query('to');
    const sessionIdStr = c.req.query('sessionId');

    // 解析日期：如果只传入 YYYY-MM-DD，则按本地时区解析
    const parseYMD = (s: string, endOfDay = false): Date | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1; // 0-based month
      const d = Number(m[3]);
      if (endOfDay) {
        // 当天 23:59:59.999（本地时区），确保包含整天数据
        return new Date(y, mo, d, 23, 59, 59, 999);
      }
      // 当天 00:00:00.000（本地时区）
      return new Date(y, mo, d, 0, 0, 0, 0);
    };

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    let fromDate = from ? (parseYMD(from, false) || new Date(from)) : defaultFrom;
    let toDate = to ? (parseYMD(to, true) || new Date(to)) : now;
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid date range' }, 400);
    }
    // 兜底：如果范围颠倒，交换
    if (fromDate > toDate) {
      const tmp = fromDate; fromDate = toDate; toDate = tmp;
    }

    let sessionFilter: any = {};
    if (sessionIdStr) {
      const sessionId = parseInt(sessionIdStr);
      if (!sessionId || Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400);
      }
      const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== user.id) {
        return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
      }
      sessionFilter.sessionId = sessionId;
    } else {
      // 限定为当前用户的所有会话
      const sessions = await prisma.chatSession.findMany({ where: { userId: user.id }, select: { id: true } });
      sessionFilter.sessionId = { in: sessions.map(s => s.id) };
    }

    const metrics = await (prisma as any).usageMetric.findMany({
      where: {
        ...sessionFilter,
        createdAt: { gte: fromDate, lte: toDate },
      },
      select: { createdAt: true, promptTokens: true, completionTokens: true, totalTokens: true },
      orderBy: { createdAt: 'asc' },
    });

    const pad2 = (n: number) => n < 10 ? `0${n}` : `${n}`;
    const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

    const byDay = new Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>();
    for (const m of metrics) {
      const k = dayKey(new Date(m.createdAt));
      const cur = byDay.get(k) || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      cur.prompt_tokens += Number(m.promptTokens || 0);
      cur.completion_tokens += Number(m.completionTokens || 0);
      cur.total_tokens += Number(m.totalTokens || 0);
      byDay.set(k, cur);
    }

    const result = Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v }));
    return c.json<ApiResponse>({ success: true, data: { from: fromDate.toISOString(), to: toDate.toISOString(), rows: result } });
  } catch (error) {
    console.error('Get daily usage error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch daily usage' }, 500);
  }
});
