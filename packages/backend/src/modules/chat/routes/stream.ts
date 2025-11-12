import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { ApiResponse, Actor, Message, UsageQuotaSnapshot } from '../../../types';
import { AuthUtils } from '../../../utils/auth';
import { convertOpenAIReasoningPayload } from '../../../utils/providers';
import { Tokenizer } from '../../../utils/tokenizer';
import { persistChatImages, cleanupExpiredChatImages } from '../../../utils/chat-images';
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../../config/storage';
import { consumeActorQuota, inspectActorQuota, serializeQuotaSnapshot } from '../../../utils/quota';
import { cleanupAnonymousSessions } from '../../../utils/anonymous-cleanup';
import { resolveContextLimit } from '../../../utils/context-window';
import { TaskTraceRecorder, shouldEnableTaskTrace, summarizeSseLine, type TaskTraceStatus } from '../../../utils/task-trace';
import { createReasoningState, DEFAULT_REASONING_TAGS, extractByTags } from '../../../utils/reasoning-tags';
import { createAgentWebSearchResponse, buildAgentWebSearchConfig } from '../../chat/agent-web-search-response';
import { upsertAssistantMessageByClientId } from '../../chat/assistant-message-service';
import {
  buildAgentStreamKey,
  buildPendingCancelKeyByClientId,
  buildPendingCancelKeyByMessageId,
  clearPendingCancelMarkers,
  deriveAssistantClientMessageId,
  findStreamMetaByAssistantClientMessageId,
  findStreamMetaByClientMessageId,
  findStreamMetaByMessageId,
  getStreamMetaByKey,
  hasPendingStreamCancelKey,
  registerPendingCancelMarker,
  registerStreamMeta,
  releaseStreamMeta,
  resolveAssistantClientIdFromRequest,
  updateStreamMetaController,
  deletePendingStreamCancelKey,
} from '../../chat/stream-state';
import type { AgentStreamMeta } from '../../chat/stream-state';
import { BackendLogger as log } from '../../../utils/logger';
import { logTraffic } from '../../../utils/traffic-logger';
import {
  BACKOFF_429_MS,
  BACKOFF_5XX_MS,
  MESSAGE_DEDUPE_WINDOW_MS,
  ProviderChatCompletionResponse,
  QuotaExceededError,
  cancelStreamSchema,
  extendAnonymousSession,
  sendMessageSchema,
  sessionOwnershipClause,
} from '../chat-common';

export const registerChatStreamRoutes = (router: Hono) => {
  router.post('/stream', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const userId = actor.type === 'user' ? actor.id : null;
      const payload = c.req.valid('json') as any;
      const { sessionId, content, images } = payload;
      const requestedFeatures = payload?.features || {};
      const traceToggle = typeof payload?.traceEnabled === 'boolean' ? payload.traceEnabled : undefined;

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
      let assistantMessageId: number | null = null
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

      const assistantClientMessageId = deriveAssistantClientMessageId(clientMessageId);

      try {
        const placeholder = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: '',
            clientMessageId: assistantClientMessageId,
            streamStatus: 'streaming',
            streamCursor: 0,
            streamReasoning: null,
          },
        });
        assistantMessageId = placeholder.id;
      } catch (error) {
        log.warn('Failed to create assistant placeholder', {
          sessionId,
          error: error instanceof Error ? error.message : error,
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
      const traceDecision = await shouldEnableTaskTrace({
        actor,
        requestFlag: traceToggle,
        sysMap,
        env: process.env.NODE_ENV,
      });
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

      const STREAM_PROGRESS_PERSIST_INTERVAL_MS = Math.max(
        250,
        parseInt(sysMap.stream_progress_persist_interval_ms || process.env.STREAM_PROGRESS_PERSIST_INTERVAL_MS || '800'),
      );
      const traceRecorder = await TaskTraceRecorder.create({
        enabled: traceDecision.enabled,
        sessionId,
        messageId: assistantMessageId ?? undefined,
        clientMessageId: assistantClientMessageId ?? clientMessageId,
        actorIdentifier: actor.identifier,
        traceLevel: traceDecision.traceLevel,
        metadata: {
          provider,
          model: session.modelRawId,
          connectionId: session.connectionId,
          features: requestedFeatures,
          agentWebSearchActive,
          reasoningEnabled: effectiveReasoningEnabled,
          reasoningEffort: effectiveReasoningEffort,
          ollamaThink: effectiveOllamaThink,
          contextLimit,
        },
        maxEvents: traceDecision.config.maxEvents,
      });
      traceRecorder.log('request:init', {
        sessionId,
        clientMessageId,
        promptTokens,
        contextLimit,
        contextEnabled,
        hasImages: Boolean(images?.length),
        messageReused: messageWasReused,
        quota: quotaSnapshot ? serializeQuotaSnapshot(quotaSnapshot) : null,
      });

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
          assistantMessageId,
          assistantClientMessageId,
          streamProgressPersistIntervalMs: STREAM_PROGRESS_PERSIST_INTERVAL_MS,
          traceRecorder,
          idleTimeoutMs: traceDecision.config.idleTimeoutMs,
        });
      }

      const activeStreamMeta = registerStreamMeta({
        sessionId,
        actorIdentifier: actor.identifier,
        clientMessageId,
        assistantMessageId,
        assistantClientMessageId,
      });

      const bindProviderController = (controller: AbortController | null) => {
        updateStreamMetaController(activeStreamMeta, controller);
      };

      const traceMetadataExtras: Record<string, unknown> = {};
      let traceStatus: TaskTraceStatus = 'running';
      let traceErrorMessage: string | null = null;
      traceRecorder.log('stream:started', { mode: 'standard', provider, baseUrl });

      let aiResponseContent = '';
      // 推理相关累积
      let reasoningBuffer = '';
      const reasoningState = createReasoningState();
      let reasoningDoneEmitted = false;
      let reasoningDurationSeconds = 0;
      let streamCancelled = false;
      const pendingCancelKeys = () => {
        const keys: string[] = [];
        const messageKey = buildPendingCancelKeyByMessageId(sessionId, assistantMessageId);
        if (messageKey) keys.push(messageKey);
        const assistantClientKey = buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId);
        if (assistantClientKey) keys.push(assistantClientKey);
        const userClientKey = buildPendingCancelKeyByClientId(sessionId, clientMessageId);
        if (userClientKey) keys.push(userClientKey);
        return keys;
      };
      const consumePendingCancelMarker = () => {
        let matched = false;
        for (const key of pendingCancelKeys()) {
          if (hasPendingStreamCancelKey(key)) {
            deletePendingStreamCancelKey(key);
            matched = true;
          }
        }
        return matched;
      };
      const markStreamCancelled = () => {
        if (streamCancelled) return;
        streamCancelled = true;
        if (currentProviderController) {
          try {
            currentProviderController.abort();
          } catch {}
          currentProviderController = null;
        }
      };
      const isStreamCancelled = () => {
        if (!streamCancelled && activeStreamMeta?.cancelled) {
          markStreamCancelled();
        }
        if (!streamCancelled && consumePendingCancelMarker()) {
          markStreamCancelled();
        }
        return streamCancelled;
      };
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

      let assistantProgressLastPersistAt = 0;
      let assistantProgressLastPersistedLength = 0;
      let assistantReasoningPersistLength = 0;
      const persistAssistantProgress = async (options?: { force?: boolean; includeReasoning?: boolean; status?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled'; errorMessage?: string | null }) => {
        if (!assistantMessageId) return;
        const force = options?.force === true;
        const includeReasoning = options?.includeReasoning !== false;
        const currentReasoning = includeReasoning ? reasoningBuffer : null;
        const now = Date.now();
        const deltaLength = aiResponseContent.length - assistantProgressLastPersistedLength;
        const reasoningDelta = includeReasoning ? (reasoningBuffer.length - assistantReasoningPersistLength) : 0;
        const cancelled = isStreamCancelled();
        if (cancelled && !force && !options?.status) {
          return;
        }
        if (!force) {
          const keepaliveExceeded = now - assistantProgressLastPersistAt >= STREAM_PROGRESS_PERSIST_INTERVAL_MS;
          const hasContentDelta = deltaLength >= 8;
          const hasReasoningDelta = includeReasoning && reasoningDelta >= 8;
          if (!hasContentDelta && !hasReasoningDelta && !keepaliveExceeded) {
            return;
          }
        }
        assistantProgressLastPersistAt = now;
        assistantProgressLastPersistedLength = aiResponseContent.length;
        if (includeReasoning) {
          assistantReasoningPersistLength = reasoningBuffer.length;
        }
        const nextStatus = options?.status ?? (cancelled ? 'cancelled' : 'streaming');
        try {
          await prisma.message.update({
            where: { id: assistantMessageId },
            data: {
              content: aiResponseContent,
              streamCursor: aiResponseContent.length,
              streamStatus: nextStatus,
              streamReasoning: currentReasoning && currentReasoning.trim().length > 0 ? currentReasoning : null,
              streamError: options?.errorMessage ?? null,
            },
          });
          traceRecorder.log('db:persist_progress', {
            messageId: assistantMessageId,
            length: aiResponseContent.length,
            reasoningLength: currentReasoning?.length ?? 0,
            status: nextStatus,
            force,
          });
        } catch (error) {
          const isRecordMissing =
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
          if (isRecordMissing) {
            const recoveredId = await upsertAssistantMessageByClientId({
              sessionId,
              clientMessageId: assistantClientMessageId,
              data: {
                content: aiResponseContent,
                streamCursor: aiResponseContent.length,
                streamStatus: nextStatus,
                streamReasoning: currentReasoning && currentReasoning.trim().length > 0 ? currentReasoning : null,
                streamError: options?.errorMessage ?? null,
              },
            });
            if (recoveredId) {
              assistantMessageId = recoveredId;
              log.warn('Assistant progress target missing, upserted placeholder record', {
                sessionId,
                recoveredId,
              });
              traceRecorder.log('db:persist_progress', {
                messageId: recoveredId,
                length: aiResponseContent.length,
                reasoningLength: currentReasoning?.length ?? 0,
                status: nextStatus,
                force,
                recovered: true,
              });
              return;
            }
          }
          log.warn('Persist assistant progress failed', {
            sessionId,
            error: error instanceof Error ? error.message : error,
          });
        }
      };

      let currentProviderController: AbortController | null = null;

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
        currentProviderController = ac;
        bindProviderController(ac);
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
        } catch (error) {
          bindProviderController(null);
          currentProviderController = null;
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      };

        const stream = new ReadableStream({
          async start(controller) {
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
          const idleTimeout = traceDecision.config.idleTimeoutMs > 0 ? traceDecision.config.idleTimeoutMs : null;
          let idleWatchTimer: ReturnType<typeof setInterval> | null = null;
          let lastChunkTimestamp = Date.now();
          let idleWarned = false;

          const markDownstreamClosed = () => {
            if (downstreamAborted) return;
            downstreamAborted = true;
            stopHeartbeat();
          };

          const safeEnqueue = (payload: string) => {
            if (!downstreamAborted && requestSignal?.aborted) {
              markDownstreamClosed();
            }
            if (downstreamAborted) {
              return false;
            }
            try {
              controller.enqueue(encoder.encode(payload));
              const summary = summarizeSseLine(payload.trim());
              if (summary) {
                traceRecorder.log('sse:dispatch', summary);
              }
              return true;
            } catch (err) {
              markDownstreamClosed();
              console.warn('SSE downstream closed, stop streaming', err);
              return false;
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

          const startIdleWatch = () => {
            if (!idleTimeout || idleWatchTimer) return
            idleWatchTimer = setInterval(() => {
              if (!idleTimeout || downstreamAborted) return
              const idleFor = Date.now() - lastChunkTimestamp
              if (idleFor >= idleTimeout && !idleWarned) {
                traceRecorder.log('stream.keepalive_timeout', { idleMs: idleFor })
                idleWarned = true
              }
            }, Math.min(Math.max(1000, idleTimeout / 2), 5000))
          }

          try {
            startIdleWatch()
            // 发送开始事件
            const startEvent = `data: ${JSON.stringify({
              type: 'start',
              messageId: userMessageRecord?.id ?? null,
              assistantMessageId,
              assistantClientMessageId,
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
            const traceIdleTimeoutMs = traceDecision.config.idleTimeoutMs > 0 ? traceDecision.config.idleTimeoutMs : null;
            let traceIdleWarned = false;
            let pendingVisibleDelta = '';
            let visibleDeltaCount = 0;
            let pendingReasoningDelta = '';
            let reasoningDeltaCount = 0;
            let providerDone = false;

            const flushVisibleDelta = async (force = false) => {
              if (!pendingVisibleDelta) return;
              if (!force && visibleDeltaCount < STREAM_DELTA_CHUNK_SIZE) return;
              aiResponseContent += pendingVisibleDelta;
              const contentEvent = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`;
              safeEnqueue(contentEvent);
              await persistAssistantProgress();
              pendingVisibleDelta = '';
              visibleDeltaCount = 0;
            };

            const flushReasoningDelta = async (force = false) => {
              if (!pendingReasoningDelta) return;
              if (!force && reasoningDeltaCount < STREAM_DELTA_CHUNK_SIZE) return;
              reasoningBuffer += pendingReasoningDelta;
              const reasoningEvent = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`;
              safeEnqueue(reasoningEvent);
              await persistAssistantProgress({ includeReasoning: true });
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
              if (traceIdleTimeoutMs && idleMs > traceIdleTimeoutMs && !traceIdleWarned) {
                traceRecorder.log('stream.keepalive_timeout', { idleMs });
                traceIdleWarned = true;
              }
              if (providerReasoningIdleMs > 0 && idleMs > providerReasoningIdleMs) {
                try { (response as any)?.body?.cancel?.(); } catch {}
                return;
              }
              if (reasoningKeepaliveIntervalMs > 0 && idleMs > reasoningKeepaliveIntervalMs && now - lastKeepaliveSentAt > reasoningKeepaliveIntervalMs) {
                try {
                  void flushReasoningDelta(true).catch(() => {});
                  void flushVisibleDelta(true).catch(() => {});
                  emitReasoningKeepalive(idleMs);
                } catch {}
              }
            }, Math.max(1000, heartbeatIntervalMs));

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const now = Date.now();
              lastChunkAt = now;
              lastChunkTimestamp = now;
              idleWarned = false;
              traceIdleWarned = false;
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
                  await flushReasoningDelta(true);
                  await flushVisibleDelta(true);
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
                  await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
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
                      await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                    }
                  }

                  if (visible) {
                    pendingVisibleDelta += visible;
                    visibleDeltaCount += 1;
                    await flushVisibleDelta(visibleDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
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
                    traceMetadataExtras.finalUsage = parsed.usage;
                    traceMetadataExtras.providerUsageSource = 'provider';
                  }
                  const providerUsageEvent = `data: ${JSON.stringify({
                    type: 'usage',
                    usage: parsed.usage,
                  })}\n\n`;
                  safeEnqueue(providerUsageEvent);
                }
              }

              if (providerDone) {
                break;
              }
            }

            await flushReasoningDelta(true);
            await flushVisibleDelta(true);
            stopHeartbeat();
            bindProviderController(null);
            currentProviderController = null;

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
              const fallbackUsagePayload = {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokensFallback,
                total_tokens: promptTokens + completionTokensFallback,
                context_limit: contextLimit,
                context_remaining: Math.max(0, contextLimit - promptTokens),
              };
              const finalUsageEvent = `data: ${JSON.stringify({
                type: 'usage',
                usage: fallbackUsagePayload,
              })}\n\n`;
              safeEnqueue(finalUsageEvent);
              traceMetadataExtras.finalUsage = fallbackUsagePayload;
              traceMetadataExtras.providerUsageSource = providerUsageSeen ? 'provider' : 'fallback';
            }

            // 发送完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
            })}\n\n`;
            safeEnqueue(completeEvent);
            traceStatus = 'completed';
            traceMetadataExtras.reasoningDurationSeconds = reasoningDurationSeconds;

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
              let persistedAssistantMessageId: number | null = assistantMessageId;
              if (aiResponseContent.trim()) {
                const updateData: any = {
                  content: aiResponseContent.trim(),
                  streamStatus: 'done',
                  streamCursor: aiResponseContent.trim().length,
                  streamReasoning:
                    REASONING_ENABLED &&
                    (typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : REASONING_SAVE_TO_DB) &&
                    reasoningBuffer.trim()
                      ? reasoningBuffer.trim()
                      : null,
                  streamError: null,
                };
                if (
                  REASONING_ENABLED &&
                  (typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : REASONING_SAVE_TO_DB) &&
                  reasoningBuffer.trim()
                ) {
                  updateData.reasoning = reasoningBuffer.trim();
                  updateData.reasoningDurationSeconds = reasoningDurationSeconds;
                } else {
                  updateData.reasoning = null;
                  updateData.reasoningDurationSeconds = null;
                }
                if (assistantMessageId) {
                  try {
                    await prisma.message.update({
                      where: { id: assistantMessageId },
                      data: updateData,
                    });
                    persistedAssistantMessageId = assistantMessageId;
                  } catch (e) {
                    log.warn('Failed to update assistant placeholder for default stream, fallback to upsert', {
                      sessionId,
                      error: e instanceof Error ? e.message : e,
                    });
                    const recoveredId = await upsertAssistantMessageByClientId({
                      sessionId,
                      clientMessageId: assistantClientMessageId,
                      data: updateData,
                    });
                    persistedAssistantMessageId = recoveredId ?? null;
                  }
                } else {
                  const recoveredId = await upsertAssistantMessageByClientId({
                    sessionId,
                    clientMessageId: assistantClientMessageId,
                    data: updateData,
                  });
                  persistedAssistantMessageId = recoveredId ?? null;
                }
              }

              if (persistedAssistantMessageId) {
                traceRecorder.setMessageContext(
                  persistedAssistantMessageId,
                  assistantClientMessageId ?? clientMessageId,
                );
              }

              if (USAGE_EMIT) {
                await (prisma as any).usageMetric.create({
                  data: {
                    sessionId,
                    messageId: persistedAssistantMessageId ?? undefined,
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
            bindProviderController(null);
            currentProviderController = null;
            if (activeStreamMeta?.cancelled) {
              streamCancelled = true;
              log.debug('Streaming cancelled by client request', {
                sessionId,
                assistantMessageId,
              });
              await persistAssistantProgress({
                force: true,
                status: 'cancelled',
                errorMessage: 'Cancelled by user',
              });
              traceStatus = 'cancelled';
              traceRecorder.log('stream:cancelled', { sessionId, assistantMessageId });
              return;
            }
            if (downstreamAborted) {
              log.debug('Streaming aborted: SSE downstream closed');
            }

            console.error('Streaming error:', error);
            log.error('Streaming error detail', (error as Error)?.message, (error as Error)?.stack)
            traceStatus = 'error';
            traceErrorMessage = error instanceof Error ? error.message : 'Streaming error';
            traceRecorder.log('stream:error', { message: traceErrorMessage });

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
                    await persistAssistantProgress(true);
                    if (assistantMessageId) {
                      try {
                    await prisma.message.update({
                      where: { id: assistantMessageId },
                      data: {
                        content: text,
                        streamStatus: 'done',
                        streamCursor: text.length,
                        streamReasoning: reasoningBuffer.trim().length > 0 ? reasoningBuffer : null,
                        streamError: null,
                      },
                    });
                      } catch {}
                    } else {
                      try {
                        const saved = await prisma.message.create({
                          data: {
                            sessionId,
                            role: 'assistant',
                            content: text,
                            clientMessageId: assistantClientMessageId,
                            streamStatus: 'done',
                            streamCursor: text.length,
                            streamReasoning: reasoningBuffer.trim().length > 0 ? reasoningBuffer : null,
                          },
                        });
                        assistantMessageId = saved?.id ?? assistantMessageId;
                      } catch {}
                    }
                    return;
                  }
                }
              } catch (e) {
                // ignore
              }
            }

            // 发送错误事件
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorEvent = `data: ${JSON.stringify({
              type: 'error',
              error: errorMessage,
            })}\n\n`;
            safeEnqueue(errorEvent);
            await persistAssistantProgress({
              force: true,
              status: 'error',
              errorMessage,
            });
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
            if (idleWatchTimer) {
              clearInterval(idleWatchTimer);
              idleWatchTimer = null;
            }
            bindProviderController(null);
            currentProviderController = null;
            releaseStreamMeta(activeStreamMeta);
            clearPendingCancelMarkers({
              sessionId,
              messageId: assistantMessageId,
              clientMessageId,
              assistantClientMessageId,
            });
            const finalMetadata = {
              ...traceMetadataExtras,
              messageId: assistantMessageId,
            };
            if (traceErrorMessage) {
              (finalMetadata as any).error = traceErrorMessage;
            }
            const finalStatus = traceStatus === 'running'
              ? (traceErrorMessage ? 'error' : 'completed')
              : traceStatus;
            await traceRecorder.finalize(finalStatus, { metadata: finalMetadata });
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

  router.post('/stream/cancel', actorMiddleware, zValidator('json', cancelStreamSchema), async (c) => {
    const actor = c.get('actor') as Actor;
    const payload = c.req.valid('json');
    const { sessionId, clientMessageId, messageId } = payload;
    const normalizedClientMessageId =
      typeof clientMessageId === 'string' && clientMessageId.trim().length > 0
        ? clientMessageId.trim()
        : null;
    const keyCandidates = [
      buildAgentStreamKey(sessionId, normalizedClientMessageId ?? null),
      typeof messageId === 'number' && Number.isFinite(messageId)
        ? buildAgentStreamKey(sessionId, null, messageId)
        : null,
    ].filter(Boolean) as string[];

    let meta: AgentStreamMeta | null = null;
    for (const key of keyCandidates) {
      const candidate = getStreamMetaByKey(key);
      if (candidate) {
        meta = candidate;
        break;
      }
    }
    if (!meta && typeof messageId === 'number' && Number.isFinite(messageId)) {
      meta = findStreamMetaByMessageId(sessionId, messageId);
    }
    if (!meta && normalizedClientMessageId) {
      meta = findStreamMetaByClientMessageId(sessionId, normalizedClientMessageId);
      if (!meta) {
        meta = findStreamMetaByAssistantClientMessageId(sessionId, normalizedClientMessageId);
      }
    }

    const matchedMeta =
      meta && meta.actorId === actor.identifier && meta.sessionId === sessionId ? meta : null;
    const assistantClientIdFromRequest = resolveAssistantClientIdFromRequest(normalizedClientMessageId);
    const effectiveAssistantClientId =
      matchedMeta?.assistantClientMessageId ?? assistantClientIdFromRequest ?? normalizedClientMessageId ?? null;

    if (matchedMeta) {
      matchedMeta.cancelled = true;
      try {
        matchedMeta.controller?.abort();
      } catch {}
      clearPendingCancelMarkers({
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: matchedMeta.assistantClientMessageId ?? effectiveAssistantClientId,
      });
    } else {
      registerPendingCancelMarker({
        sessionId,
        messageId: typeof messageId === 'number' || typeof messageId === 'string' ? messageId : null,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: effectiveAssistantClientId,
      });
    }

    const cancellationUpdate = { streamStatus: 'cancelled', streamError: 'Cancelled by user' };
    const updateTasks: Array<Promise<any>> = [];

    if (effectiveAssistantClientId) {
      updateTasks.push(
        prisma.message.updateMany({
          where: { sessionId, clientMessageId: effectiveAssistantClientId },
          data: cancellationUpdate,
        }),
      );
    }

    const targetMessageId =
      typeof messageId === 'number' && Number.isFinite(messageId)
        ? messageId
        : typeof matchedMeta?.assistantMessageId === 'number'
          ? (matchedMeta.assistantMessageId as number)
          : null;
    if (targetMessageId) {
      updateTasks.push(
        prisma.message.updateMany({
          where: { sessionId, id: targetMessageId },
          data: cancellationUpdate,
        }),
      );
    }

    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks);
    }

    return c.json<ApiResponse>({ success: true });
  });
};
