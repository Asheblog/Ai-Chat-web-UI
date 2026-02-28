import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { ApiResponse, Actor, Message, UsageQuotaSnapshot } from '../../../types';
import { AuthUtils } from '../../../utils/auth';
import type { ProviderType } from '../../../utils/providers';
import { buildChatProviderRequest } from '../../../utils/chat-provider';
import { Tokenizer } from '../../../utils/tokenizer';
import { cleanupExpiredChatImages, loadPersistedChatImages, determineChatImageBaseUrl } from '../../../utils/chat-images';
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../../config/storage';
import { consumeActorQuota, serializeQuotaSnapshot } from '../../../utils/quota';
import { cleanupAnonymousSessions } from '../../../utils/anonymous-cleanup';
import { resolveContextLimit, resolveCompletionLimit } from '../../../utils/context-window';
import { TaskTraceRecorder, shouldEnableTaskTrace, summarizeSseLine, type TaskTraceStatus } from '../../../utils/task-trace';
import { createReasoningState, DEFAULT_REASONING_TAGS, extractByTags } from '../../../utils/reasoning-tags';
import {
  createAgentWebSearchResponse,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
  buildAgentWorkspaceToolConfig,
} from '../../chat/agent-web-search-response';
import { createImageGenerationResponse, checkImageGenerationCapability } from '../../chat/image-generation-response';
import { persistAssistantFinalResponse, upsertAssistantMessageByClientId } from '../../chat/assistant-message-service';
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
import { chatRequestBuilder } from '../services/chat-request-builder';
import {
  reasoningCompatibilityService,
  type AttemptTracker,
  type ReasoningProtocol,
} from '../services/reasoning-compatibility-service';
import type { AgentStreamMeta } from '../../chat/stream-state';
import { BackendLogger as log } from '../../../utils/logger';
import { redactHeadersForTrace, summarizeBodyForTrace, summarizeErrorForTrace } from '../../../utils/trace-helpers';
import { truncateString } from '../../../utils/task-trace';
import { parseApiError, getFriendlyErrorMessage } from '../../../utils/api-error-parser';
import {
  BACKOFF_429_MS,
  BACKOFF_5XX_MS,
  ProviderChatCompletionResponse,
  QuotaExceededError,
  cancelStreamSchema,
  extendAnonymousSession,
  sendMessageSchema,
  sessionOwnershipClause,
} from '../chat-common';
import { createUserMessageWithQuota } from '../services/message-service';
import { chatService, ChatServiceError } from '../../../services/chat';
import { providerRequester } from '../services/provider-requester';
import { nonStreamFallbackService } from '../services/non-stream-fallback-service';
import { assistantProgressService } from '../services/assistant-progress-service';
import { extractOpenAIResponsesStreamEvent } from '../../../utils/openai-responses';
import {
  streamUsageService,
  computeStreamMetrics,
  resolveCompletionTokensForMetrics,
} from '../services/stream-usage-service';
import { streamTraceService } from '../services/stream-trace-service';
import { streamSseService } from '../services/stream-sse-service';
import { RAGContextBuilder } from '../../chat/rag-context-builder';
import type { RAGService } from '../../../services/document/rag-service';
import { getDocumentServices } from '../../../services/document-services-factory';
import { GeneratedImageStorage, type GeneratedImage } from '../../../services/image-generation';
import { BUILTIN_SKILL_SLUGS, normalizeRequestedSkills } from '../../skills/types';

export const registerChatStreamRoutes = (router: Hono) => {
  router.post('/stream', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    let traceRecorder: TaskTraceRecorder | null = null
    try {
      const actor = c.get('actor') as Actor;
      const payload = c.req.valid('json') as any;
      const { sessionId } = payload;
      const replyToMessageId =
        typeof payload?.replyToMessageId === 'number' ? payload.replyToMessageId : null
      const replyToClientMessageIdRaw =
        typeof payload?.replyToClientMessageId === 'string'
          ? payload.replyToClientMessageId.trim()
          : ''
      const replyToClientMessageId = replyToClientMessageIdRaw || null
      let content = typeof payload?.content === 'string' ? payload.content : ''
      let images = replyToMessageId || replyToClientMessageId ? undefined : payload.images;
      const requestedSkills = normalizeRequestedSkills(payload?.skills)
      const requestedSkillSet = new Set(requestedSkills.enabled)
      const traceToggle = typeof payload?.traceEnabled === 'boolean' ? payload.traceEnabled : undefined;

      // 验证会话是否存在且属于当前用户
      let session
      try {
        session = await chatService.getSessionWithConnection(actor, sessionId)
      } catch (error) {
        if (error instanceof ChatServiceError) {
          if (error.statusCode === 404) {
            log.warn('[chat stream] session not found', {
              sessionId,
              actor: actor.identifier,
            })
          }
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
        }
        throw error
      }

      await extendAnonymousSession(actor, sessionId)

      const clientMessageIdInput = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : ''
      const clientMessageId = clientMessageIdInput || null
      const now = new Date()

      let userMessageRecord: Message | null = null
      let assistantMessageId: number | null = null
      let messageWasReused = false
      let quotaSnapshot: UsageQuotaSnapshot | null = null

      const reuseExistingUserMessage = async (message: Message) => {
        content = message.content;
        userMessageRecord = message;
        messageWasReused = true;
        const quotaResult = await consumeActorQuota(actor, { now });
        if (!quotaResult.success) {
          return {
            quotaError: c.json({
              success: false,
              error: 'Daily quota exhausted',
              quota: serializeQuotaSnapshot(quotaResult.snapshot),
              requiredLogin: actor.type !== 'user',
            }, 429),
          };
        }
        quotaSnapshot = quotaResult.snapshot;
        return { quotaError: null };
      };

      if (replyToMessageId) {
        const existingUserMessage = await prisma.message.findFirst({
          where: { id: replyToMessageId, sessionId, role: 'user' },
        });
        if (!existingUserMessage) {
          let fallbackMessage: Message | null = null;
          if (replyToClientMessageId) {
            fallbackMessage = (await prisma.message.findFirst({
              where: { sessionId, clientMessageId: replyToClientMessageId, role: 'user' },
            })) as Message | null;
            if (fallbackMessage) {
              log.warn('[chat stream] numeric reply message missing, fallback to client id', {
                sessionId,
                replyToMessageId,
                replyToClientMessageId,
                actor: actor.identifier,
              });
            }
          }
          if (!fallbackMessage) {
            log.warn('[chat stream] reference user message (numeric id) missing', {
              sessionId,
              replyToMessageId,
              actor: actor.identifier,
            });
            return c.json<ApiResponse>({ success: false, error: 'Reference message not found' }, 404);
          }
          const { quotaError } = await reuseExistingUserMessage(fallbackMessage);
          if (quotaError) {
            return quotaError;
          }
        } else {
          const { quotaError } = await reuseExistingUserMessage(existingUserMessage as Message);
          if (quotaError) {
            return quotaError;
          }
        }
      } else if (replyToClientMessageId) {
        const existingUserMessage = await prisma.message.findFirst({
          where: {
            sessionId,
            clientMessageId: replyToClientMessageId,
            role: 'user',
          },
        });
        if (!existingUserMessage) {
          log.warn('[chat stream] reference user message (client id) missing', {
            sessionId,
            replyToClientMessageId,
            actor: actor.identifier,
          });
          return c.json<ApiResponse>({ success: false, error: 'Reference message not found' }, 404);
        }
        const { quotaError } = await reuseExistingUserMessage(existingUserMessage as Message);
        if (quotaError) {
          return quotaError;
        }
      } else {
        try {
          const result = await createUserMessageWithQuota({
            actor,
            sessionId,
            content,
            clientMessageId,
            images,
            now,
          })
          userMessageRecord = result.userMessage as Message
          messageWasReused = result.messageWasReused
          quotaSnapshot = result.quotaSnapshot
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
      }

      if ((replyToMessageId || replyToClientMessageId) && userMessageRecord && (!images || images.length === 0)) {
        const restoredImages = await loadPersistedChatImages(userMessageRecord.id)
        if (restoredImages.length > 0) {
          images = restoredImages
        }
      }

      const assistantClientMessageId = deriveAssistantClientMessageId(
        replyToMessageId ? `${clientMessageId ?? ''}${clientMessageId ? ':' : ''}regen:${replyToMessageId}:${Date.now()}` : clientMessageId
      );

      try {
        const placeholderId = await upsertAssistantMessageByClientId({
          sessionId,
          clientMessageId: assistantClientMessageId,
          data: {
            content: '',
            streamStatus: 'streaming',
            streamCursor: 0,
            streamReasoning: null,
            parentMessageId: userMessageRecord?.id ?? null,
            variantIndex: null,
          },
        });
        assistantMessageId = placeholderId ?? assistantMessageId;
        if (!assistantMessageId) {
          log.warn('Assistant placeholder upsert returned null', { sessionId, clientMessageId: assistantClientMessageId });
        }
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

      // RAG 文档检索增强（包括会话文档和知识库）
      let ragContext: string | null = null;
      let hasSessionDocuments = false;
      let hasKnowledgeBases = false;
      let sessionRagService: RAGService | null = null;
      const knowledgeBaseIds = Array.isArray(payload?.knowledgeBaseIds) ? payload.knowledgeBaseIds : [];

      try {
        const docServices = getDocumentServices();
        if (docServices) {
          sessionRagService = docServices.ragService;
          const ragContextBuilder = new RAGContextBuilder(docServices.ragService, {
            documentService: docServices.documentService,
            enhancedRagService: docServices.enhancedRagService,
          });

          // 检查会话文档
          hasSessionDocuments = await ragContextBuilder.shouldEnhance(sessionId);
          // 检查知识库
          hasKnowledgeBases = await ragContextBuilder.hasKnowledgeBases(knowledgeBaseIds);

          if (hasSessionDocuments || hasKnowledgeBases) {
            log.debug('RAG enhancement enabled', {
              sessionId,
              hasSessionDocuments,
              hasKnowledgeBases,
              knowledgeBaseIds: knowledgeBaseIds.length,
            });

            // 组合检索：同时检索会话文档和知识库
            const ragResult = await ragContextBuilder.enhanceCombined(
              sessionId,
              knowledgeBaseIds,
              content
            );

            if (ragResult.context) {
              ragContext = ragContextBuilder.buildSystemPrompt(ragResult.context);
              log.debug('RAG context built', {
                sessionId,
                sessionHits: ragResult.sessionResult?.hits.length ?? 0,
                kbHits: ragResult.kbResult?.hits.length ?? 0,
              });
            }
          }
        }
      } catch (ragError) {
        log.warn('RAG enhancement failed, continuing without', {
          sessionId,
          error: ragError instanceof Error ? ragError.message : ragError,
        });
      }

      const preparedRequest = await chatRequestBuilder.prepare({
        session,
        payload,
        content,
        images,
        mode: 'stream',
        historyUpperBound: userMessageRecord?.createdAt ?? null,
        personalPrompt: actor.type === 'user' ? actor.personalPrompt ?? null : null,
        ragContext,
      });

      const promptTokens = preparedRequest.promptTokens;
      const contextLimit = preparedRequest.contextLimit;
      const contextRemaining = preparedRequest.contextRemaining;
      const contextEnabled = preparedRequest.contextEnabled;
      const sysMap = preparedRequest.systemSettings;
      const messagesPayload = preparedRequest.messagesPayload;
      const requestData: any = JSON.parse(JSON.stringify(preparedRequest.baseRequestBody));
      let providerRequest = preparedRequest.providerRequest;
      const provider = providerRequest.providerLabel as ProviderType;
      const baseUrl = session.connection.baseUrl.replace(/\/+$/, '');
      const authHeader = providerRequest.authHeader;
      const extraHeaders = providerRequest.extraHeaders;
      const providerHost = providerRequest.providerHost;
      let activeReasoningProtocol: ReasoningProtocol =
        provider === 'openai_responses' ? 'responses' : 'chat_completions';
      let reasoningProtocolDecisionReason = 'initial_provider_default';
      let reasoningCompatibilityProfile: Awaited<
        ReturnType<typeof reasoningCompatibilityService.decideProtocol>
      >['profile'] | null = null;

      log.debug('Chat stream request', { sessionId, actor: actor.identifier, provider, baseUrl, model: session.modelRawId })

      const traceDecision = await shouldEnableTaskTrace({
        actor,
        requestFlag: traceToggle,
        sysMap,
        env: process.env.NODE_ENV,
      });
      const agentWebSearchConfig = buildAgentWebSearchConfig(sysMap);
      const pythonToolConfig = buildAgentPythonToolConfig(sysMap);
      const urlReaderConfig = buildAgentUrlReaderConfig(sysMap);
      const workspaceToolConfig = buildAgentWorkspaceToolConfig(sysMap);
      const agentMaxToolIterations = (() => {
        const raw =
          sysMap.agent_max_tool_iterations ??
          process.env.AGENT_MAX_TOOL_ITERATIONS ??
          '4';
        const parsed = Number.parseInt(String(raw), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return Math.min(20, parsed);
        }
        return 4;
      })();
      const sanitizeScope = (scope?: string) => {
        if (!scope) return undefined;
        const normalized = scope.trim().toLowerCase();
        return ['webpage', 'document', 'paper', 'image', 'video', 'podcast'].includes(normalized)
          ? normalized
          : undefined;
      };
      const webSearchSkillOverride = requestedSkills.overrides?.[BUILTIN_SKILL_SLUGS.WEB_SEARCH] || {}
      const webSearchScopeOverride =
        typeof webSearchSkillOverride.scope === 'string'
          ? webSearchSkillOverride.scope
          : typeof webSearchSkillOverride.web_search_scope === 'string'
            ? webSearchSkillOverride.web_search_scope
            : null
      if (webSearchScopeOverride) {
        agentWebSearchConfig.scope = sanitizeScope(webSearchScopeOverride) || agentWebSearchConfig.scope
      }
      const includeSummaryOverride =
        typeof webSearchSkillOverride.includeSummary === 'boolean'
          ? webSearchSkillOverride.includeSummary
          : typeof webSearchSkillOverride.include_summary === 'boolean'
            ? webSearchSkillOverride.include_summary
            : typeof webSearchSkillOverride.web_search_include_summary === 'boolean'
              ? webSearchSkillOverride.web_search_include_summary
              : null
      if (typeof includeSummaryOverride === 'boolean') {
        agentWebSearchConfig.includeSummary = includeSummaryOverride
      }
      const includeRawOverride =
        typeof webSearchSkillOverride.includeRawContent === 'boolean'
          ? webSearchSkillOverride.includeRawContent
          : typeof webSearchSkillOverride.include_raw === 'boolean'
            ? webSearchSkillOverride.include_raw
            : typeof webSearchSkillOverride.web_search_include_raw === 'boolean'
              ? webSearchSkillOverride.web_search_include_raw
              : null
      if (typeof includeRawOverride === 'boolean') {
        agentWebSearchConfig.includeRawContent = includeRawOverride
      }
      const resultLimitOverrideRaw =
        typeof webSearchSkillOverride.resultLimit === 'number'
          ? webSearchSkillOverride.resultLimit
          : typeof webSearchSkillOverride.result_limit === 'number'
            ? webSearchSkillOverride.result_limit
            : typeof webSearchSkillOverride.size === 'number'
              ? webSearchSkillOverride.size
              : typeof webSearchSkillOverride.web_search_size === 'number'
                ? webSearchSkillOverride.web_search_size
                : null
      if (typeof resultLimitOverrideRaw === 'number' && Number.isFinite(resultLimitOverrideRaw)) {
        const next = Math.max(1, Math.min(10, resultLimitOverrideRaw));
        agentWebSearchConfig.resultLimit = next;
      }
      const assistantReplyHistoryLimit = (() => {
        const raw =
          sysMap.assistant_reply_history_limit ||
          process.env.ASSISTANT_REPLY_HISTORY_LIMIT ||
          '5'
        const parsed = Number.parseInt(String(raw), 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          return Math.min(20, parsed)
        }
        return 5
      })()
      const effectiveReasoningEnabled = preparedRequest.reasoning.enabled
      const effectiveReasoningEffort = preparedRequest.reasoning.effort
      const effectiveOllamaThink = preparedRequest.reasoning.ollamaThink
      if (effectiveReasoningEnabled) {
        const protocolDecision = await reasoningCompatibilityService.decideProtocol({
          provider,
          connectionId: session.connectionId,
          modelRawId: session.modelRawId!,
          reasoningEnabled: effectiveReasoningEnabled,
        })
        activeReasoningProtocol = protocolDecision.protocol
        reasoningProtocolDecisionReason = protocolDecision.reason
        reasoningCompatibilityProfile = protocolDecision.profile

        if (provider === 'openai' && protocolDecision.protocol === 'responses') {
          const responsesRequest = buildChatProviderRequest({
            provider: 'openai_responses',
            baseUrl,
            rawModelId: session.modelRawId!,
            body: requestData,
            stream: true,
          })
          providerRequest = {
            ...providerRequest,
            url: responsesRequest.url,
            body: responsesRequest.body,
          }
        }
      } else {
        activeReasoningProtocol = provider === 'openai_responses' ? 'responses' : 'chat_completions'
        reasoningProtocolDecisionReason = 'reasoning_disabled'
      }

      const defaultReasoningSaveToDb = (sysMap.reasoning_save_to_db ?? (process.env.REASONING_SAVE_TO_DB ?? 'true'))
        .toString()
        .toLowerCase() === 'true';
      const effectiveReasoningSaveToDb =
        typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : defaultReasoningSaveToDb;

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

      const webSearchSkillRequested = requestedSkillSet.has(BUILTIN_SKILL_SLUGS.WEB_SEARCH);
      const pythonSkillRequested = requestedSkillSet.has(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER);
      const urlReaderSkillRequested =
        requestedSkillSet.has(BUILTIN_SKILL_SLUGS.URL_READER) || webSearchSkillRequested;
      const documentSkillRequested =
        requestedSkillSet.has(BUILTIN_SKILL_SLUGS.DOCUMENT_SEARCH) || hasSessionDocuments;
      const knowledgeBaseSkillRequested =
        requestedSkillSet.has(BUILTIN_SKILL_SLUGS.KNOWLEDGE_BASE_SEARCH) || hasKnowledgeBases;
      const agentWebSearchActive =
        webSearchSkillRequested &&
        agentWebSearchConfig.enabled &&
        Boolean(agentWebSearchConfig.apiKey);
      const pythonToolActive =
        pythonSkillRequested && pythonToolConfig.enabled;
      const workspaceToolsActive = pythonToolActive && workspaceToolConfig.enabled;
      const urlReaderActive = urlReaderSkillRequested;
      // 文档工具和知识库工具也需要进入 agent 模式
      const documentToolsActive = documentSkillRequested && hasSessionDocuments;
      const knowledgeBaseToolsActive = knowledgeBaseSkillRequested && hasKnowledgeBases;
      const builtinSkillSlugs = new Set<string>([
          BUILTIN_SKILL_SLUGS.WEB_SEARCH,
          BUILTIN_SKILL_SLUGS.PYTHON_RUNNER,
          BUILTIN_SKILL_SLUGS.URL_READER,
          BUILTIN_SKILL_SLUGS.DOCUMENT_SEARCH,
          BUILTIN_SKILL_SLUGS.KNOWLEDGE_BASE_SEARCH,
        ])
      const dynamicSkillRequestedRaw = Array.from(requestedSkillSet).some((slug) => !builtinSkillSlugs.has(slug));
      const dynamicSkillRequested = false;
      const dynamicSkillDisabledMessage = '聊天侧动态 Skill 运行时已迁移，请使用 workspace 工具链（python_runner / workspace_*）';
      if (dynamicSkillRequestedRaw) {
        log.warn('[chat stream] dynamic skill runtime disabled in chat route', {
          sessionId,
          actor: actor.identifier,
          requestedDynamicSkills: Array.from(requestedSkillSet).filter((slug) => !builtinSkillSlugs.has(slug)),
        });
      }
      if (
        dynamicSkillRequestedRaw &&
        !agentWebSearchActive &&
        !pythonToolActive &&
        !workspaceToolsActive &&
        !urlReaderActive &&
        !documentToolsActive &&
        !knowledgeBaseToolsActive
      ) {
        return c.json<ApiResponse>({
          success: false,
          error: dynamicSkillDisabledMessage,
        }, 400);
      }
      const agentToolsActive =
        agentWebSearchActive ||
        pythonToolActive ||
        workspaceToolsActive ||
        urlReaderActive ||
        documentToolsActive ||
        knowledgeBaseToolsActive ||
        dynamicSkillRequested;
      const resolvedMaxConcurrentStreams = (() => {
        const raw =
          sysMap.chat_max_concurrent_streams ||
          process.env.CHAT_MAX_CONCURRENT_STREAMS ||
          '1';
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          return Math.min(8, Math.max(1, parsed));
        }
        return 1;
      })();
      const concurrencyErrorMessage = '并发生成数已达系统上限，请稍候重试';
      const denyByConcurrencyLimit = () => {
        traceRecorder?.log?.('stream:concurrency_denied', {
          limit: resolvedMaxConcurrentStreams,
          actor: actor.identifier,
        });
        return c.json<ApiResponse>(
          { success: false, error: concurrencyErrorMessage },
          429,
        );
      };

      const STREAM_PROGRESS_PERSIST_INTERVAL_MS = Math.max(
        250,
        parseInt(sysMap.stream_progress_persist_interval_ms || process.env.STREAM_PROGRESS_PERSIST_INTERVAL_MS || '800'),
      );
      traceRecorder = await TaskTraceRecorder.create({
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
          skills: requestedSkills,
          agentWebSearchActive,
          workspaceToolsActive,
          reasoningEnabled: effectiveReasoningEnabled,
          reasoningEffort: effectiveReasoningEffort,
          ollamaThink: effectiveOllamaThink,
          reasoningProtocol: activeReasoningProtocol,
          reasoningProtocolDecision: reasoningProtocolDecisionReason,
          contextLimit,
        },
        maxEvents: traceDecision.config.maxEvents,
      });
      if (!traceRecorder) {
        throw new Error('Trace recorder not initialized')
      }
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
      traceRecorder.log('http:client_request', {
        route: '/api/chat/stream',
        direction: 'inbound',
        actor: actor.identifier,
        actorType: actor.type,
        sessionId,
        replyToMessageId,
        replyToClientMessageId,
        clientMessageId,
        contentPreview: truncateString(content || '', 200),
        imagesCount: Array.isArray(images) ? images.length : 0,
        skills: requestedSkills,
        traceRequested: traceToggle ?? null,
      })

      // 检测是否为生图模型：查询 ModelCatalog 的 capabilities.image_generation
      // 只有明确配置了 image_generation: true 的模型才走专用生图 API
      const isImageGenModel = session.connection
        ? await checkImageGenerationCapability(session.connection.id, session.modelRawId || '')
        : false;
      if (isImageGenModel && session.connection) {
        log.info('[chat stream] Image generation model detected', {
          sessionId,
          model: session.modelRawId,
        });
        
        return await createImageGenerationResponse({
          sessionId,
          content,
          connection: {
            id: session.connection.id,
            baseUrl: session.connection.baseUrl,
            apiKey: session.connection.apiKey,
            provider: session.connection.provider,
          },
          modelRawId: session.modelRawId || '',
          sseHeaders,
          quotaSnapshot,
          userMessageRecord,
          assistantMessageId,
          assistantClientMessageId,
          actorIdentifier: actor.identifier,
          request: c.req.raw,
        });
      }

      if (agentToolsActive) {
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
          pythonToolConfig,
          urlReaderConfig,
          workspaceToolConfig,
          agentMaxToolIterations,
          requestedSkills,
          toolFlags: {
            webSearch: agentWebSearchActive,
            python: pythonToolActive,
            workspace: workspaceToolsActive,
            urlReader: urlReaderActive,
            document: documentToolsActive,
            knowledgeBase: knowledgeBaseToolsActive,
          },
          provider,
          baseUrl,
          authHeader,
          extraHeaders,
          reasoningEnabled: effectiveReasoningEnabled,
          reasoningSaveToDb: effectiveReasoningSaveToDb,
          clientMessageId,
          actorIdentifier: actor.identifier,
          actorUserId: actor.type === 'user' ? actor.id : null,
          requestSignal: c.req.raw.signal,
          assistantMessageId,
          assistantClientMessageId,
          streamProgressPersistIntervalMs: STREAM_PROGRESS_PERSIST_INTERVAL_MS,
          traceRecorder,
          idleTimeoutMs: traceDecision.config.idleTimeoutMs,
          assistantReplyHistoryLimit,
          maxConcurrentStreams: resolvedMaxConcurrentStreams,
          concurrencyErrorMessage,
          ragService: sessionRagService, // 传递 RAG 服务实例
          knowledgeBaseIds, // 传递知识库 ID 列表
        });
      }

      const activeStreamMeta = registerStreamMeta({
        sessionId,
        actorIdentifier: actor.identifier,
        clientMessageId,
        assistantMessageId,
        assistantClientMessageId,
        maxActorStreams: resolvedMaxConcurrentStreams,
      });
      if (!activeStreamMeta) {
        return denyByConcurrencyLimit();
      }

      const streamLogBase = () => ({
        sessionId,
        actor: actor.identifier,
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
      let latexTraceRecorder: LatexTraceRecorder | null = null;
      let latexAuditSummary: { matched: number; unmatched: number } | null = null;
      traceRecorder.log('stream:started', {
        mode: 'standard',
        provider,
        baseUrl,
        reasoningProtocol: activeReasoningProtocol,
        reasoningProtocolDecision: reasoningProtocolDecisionReason,
      });

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
          } catch { }
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
      const providerTimeoutMs = providerRequest.timeoutMs;

      // 推理链（CoT）配置
      const REASONING_ENABLED = (sysMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false';
      const REASONING_SAVE_TO_DB = effectiveReasoningSaveToDb;
      const REASONING_TAGS_MODE = (sysMap.reasoning_tags_mode ?? (process.env.REASONING_TAGS_MODE ?? 'default')).toString();
      const REASONING_CUSTOM_TAGS = (() => {
        try {
          const raw = sysMap.reasoning_custom_tags || process.env.REASONING_CUSTOM_TAGS || '';
          const arr = raw ? JSON.parse(raw) : null;
          if (Array.isArray(arr) && arr.length === 2 && typeof arr[0] === 'string' && typeof arr[1] === 'string') return [[arr[0], arr[1]] as [string, string]];
        } catch { }
        return null;
      })();
      const reasoningCompatibilityEnabled = REASONING_ENABLED && effectiveReasoningEnabled;
      const detectChatReasoningSignal = (
        payload: any,
      ):
        | 'delta.reasoning_content'
        | 'delta.reasoning'
        | 'delta.thinking'
        | 'delta.analysis'
        | null => {
        if (typeof payload?.choices?.[0]?.delta?.reasoning_content === 'string') {
          return 'delta.reasoning_content';
        }
        if (typeof payload?.choices?.[0]?.delta?.reasoning === 'string') {
          return 'delta.reasoning';
        }
        if (typeof payload?.choices?.[0]?.delta?.thinking === 'string') {
          return 'delta.thinking';
        }
        if (typeof payload?.choices?.[0]?.delta?.analysis === 'string') {
          return 'delta.analysis';
        }
        if (typeof payload?.delta?.reasoning_content === 'string') {
          return 'delta.reasoning_content';
        }
        if (typeof payload?.delta?.reasoning === 'string') {
          return 'delta.reasoning';
        }
        if (typeof payload?.message?.reasoning_content === 'string') {
          return 'delta.reasoning_content';
        }
        if (typeof payload?.message?.reasoning === 'string') {
          return 'delta.reasoning';
        }
        if (typeof payload?.reasoning === 'string') {
          return 'delta.reasoning';
        }
        if (typeof payload?.analysis === 'string') {
          return 'delta.analysis';
        }
        return null;
      };
      const buildProtocolRequest = (protocol: ReasoningProtocol) => {
        if (protocol === 'responses' && provider === 'openai') {
          const next = buildChatProviderRequest({
            provider: 'openai_responses',
            baseUrl,
            rawModelId: session.modelRawId!,
            body: requestData,
            stream: true,
          });
          return {
            ...providerRequest,
            url: next.url,
            body: next.body,
          };
        }
        if (protocol === 'chat_completions' && provider === 'openai') {
          const next = buildChatProviderRequest({
            provider: 'openai',
            baseUrl,
            rawModelId: session.modelRawId!,
            body: requestData,
            stream: true,
          });
          return {
            ...providerRequest,
            url: next.url,
            body: next.body,
          };
        }
        return providerRequest;
      };
      const responsesFallbackEnabled =
        (sysMap.reasoning_responses_fallback_enabled ?? (process.env.REASONING_RESPONSES_FALLBACK_ENABLED ?? 'true'))
          .toString()
          .toLowerCase() !== 'false';
      const isResponsesUnsupportedFallback = (statusCode: number, bodyText: string) => {
        if (statusCode === 404 || statusCode === 405 || statusCode === 501) return true;
        if (statusCode !== 400) return false;
        const message = bodyText.toLowerCase();
        return (
          message.includes('/responses') ||
          message.includes('responses') ||
          message.includes('unknown endpoint') ||
          message.includes('not found')
        );
      };
      const createReasoningAttempt = (
        protocol: ReasoningProtocol,
        decisionReason: string,
      ): AttemptTracker | null => {
        if (!reasoningCompatibilityEnabled) return null;
        return reasoningCompatibilityService.createAttempt({
          provider,
          connectionId: session.connectionId,
          modelRawId: session.modelRawId!,
          protocol,
          reasoningEnabled: reasoningCompatibilityEnabled,
          decisionReason,
        });
      };
      let activeReasoningAttempt: AttemptTracker | null = createReasoningAttempt(
        activeReasoningProtocol,
        reasoningProtocolDecisionReason,
      );
      const STREAM_DELTA_CHUNK_SIZE = Math.max(1, parseInt(sysMap.stream_delta_chunk_size || process.env.STREAM_DELTA_CHUNK_SIZE || '1'));
      const streamDeltaFlushIntervalMs = Math.max(
        0,
        parseInt(sysMap.stream_delta_flush_interval_ms || process.env.STREAM_DELTA_FLUSH_INTERVAL_MS || '0'),
      );
      const streamReasoningFlushIntervalMs = Math.max(
        0,
        parseInt(
          sysMap.stream_reasoning_flush_interval_ms ||
          process.env.STREAM_REASONING_FLUSH_INTERVAL_MS ||
          `${streamDeltaFlushIntervalMs}`,
        ),
      );
      const streamKeepaliveIntervalMs = Math.max(
        0,
        parseInt(sysMap.stream_keepalive_interval_ms || process.env.STREAM_KEEPALIVE_INTERVAL_MS || '0'),
      );
      const providerInitialGraceMs = Math.max(0, parseInt(sysMap.provider_initial_grace_ms || process.env.PROVIDER_INITIAL_GRACE_MS || '120000'));
      const providerReasoningIdleMs = Math.max(0, parseInt(sysMap.provider_reasoning_idle_ms || process.env.PROVIDER_REASONING_IDLE_MS || '300000'));
      const reasoningKeepaliveIntervalMs = Math.max(0, parseInt(sysMap.reasoning_keepalive_interval_ms || process.env.REASONING_KEEPALIVE_INTERVAL_MS || '0'));
      // 提前记录是否已收到厂商 usage（优先使用）
      let providerUsageSeen = false as boolean;
      let providerUsageSnapshot: any = null;
      // 兜底：在结束前可统计 completion_tokens
      let completionTokensFallback = 0 as number;
      const encoder = new TextEncoder();
      const extractUsageNumbers = (u: any): { prompt: number; completion: number; total: number } => {
        try {
          const prompt = Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0;
          const completion = Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0;
          const total =
            Number(u?.total_tokens ?? (prompt + completion)) || (prompt + completion);
          return { prompt, completion, total };
        } catch {
          return { prompt: 0, completion: 0, total: 0 };
        }
      };

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
        const result = await assistantProgressService.persistProgress({
          assistantMessageId,
          sessionId,
          clientMessageId: assistantClientMessageId,
          content: aiResponseContent,
          reasoning: currentReasoning,
          status: nextStatus,
          errorMessage: options?.errorMessage ?? null,
          traceRecorder,
        });
        if (result.recovered && result.messageId) {
          assistantMessageId = result.messageId;
        }
      };

      let currentProviderController: AbortController | null = null;

      const providerRequestWithBackoff = async (): Promise<Response> =>
        providerRequester.requestWithBackoff({
          request: {
            url: providerRequest.url,
            headers: providerRequest.headers,
            body: providerRequest.body,
          },
          context: {
            sessionId,
            provider,
            route: '/api/chat/stream',
            timeoutMs: providerTimeoutMs,
          },
          traceRecorder,
          traceContext: {
            route: '/api/chat/stream',
            sessionId,
            provider,
            baseUrl,
            model: session.modelRawId,
            connectionId: session.connectionId,
          },
          onControllerReady: (controller) => {
            currentProviderController = controller
            bindProviderController(controller)
          },
          onControllerClear: () => {
            bindProviderController(null)
            currentProviderController = null
          },
        });
      type NonStreamFallbackResult = {
        text: string;
        reasoning?: string | null;
        usage?: ProviderChatCompletionResponse['usage'] | null;
        images?: GeneratedImage[];
      };

      const performNonStreamingFallback = async (): Promise<NonStreamFallbackResult | null> =>
        nonStreamFallbackService.execute({
          provider,
          baseUrl,
          modelRawId: session.modelRawId!,
          messagesPayload,
          requestData,
          authHeader,
          extraHeaders,
          azureApiVersion: session.connection?.azureApiVersion,
          timeoutMs: providerTimeoutMs,
          logger: log,
          traceRecorder,
          traceContext: {
            route: '/api/chat/stream',
            sessionId,
            provider,
            model: session.modelRawId,
            baseUrl,
          },
        });

      const stream = new ReadableStream({
        async start(controller) {
          let stopHeartbeat: (() => void) | null = null;

          let downstreamAborted = false;
          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          const requestSignal = c.req.raw.signal;
          const idleTimeout = traceDecision.config.idleTimeoutMs > 0 ? traceDecision.config.idleTimeoutMs : null;
          let idleWatchTimer: ReturnType<typeof setInterval> | null = null;
          let lastChunkTimestamp = Date.now();
          let idleWarned = false;

          const emitter = streamSseService.createEmitter({
            controller,
            encoder,
            requestSignal,
            traceRecorder,
            streamLogBase,
          })
          const markDownstreamClosed = (reason: string) => {
            if (downstreamAborted) return
            downstreamAborted = true
            try {
              emitter.markClosed(reason)
            } catch { }
            try {
              controller.close()
            } catch { }
          }
          const safeEnqueue = (payload: string) => {
            if (downstreamAborted || emitter.isClosed()) return false
            const delivered = emitter.enqueue(payload)
            if (!delivered) {
              markDownstreamClosed('enqueue-closed')
            }
            return delivered
          }
          const finalizeReasoningAttempt = async (params?: {
            statusCode?: number | null
            error?: string | null
            emitUnavailableNotice?: boolean
          }) => {
            if (!activeReasoningAttempt) return reasoningCompatibilityProfile
            const attempt = activeReasoningAttempt
            const profile = await reasoningCompatibilityService.finalizeAttempt(attempt, {
              statusCode: params?.statusCode,
              error: params?.error,
            })
            activeReasoningAttempt = null
            traceMetadataExtras.reasoningProtocol = attempt.protocol
            traceMetadataExtras.reasoningProtocolDecision = attempt.decisionReason
            traceMetadataExtras.reasoningSignals = Array.from(attempt.signals.values())
            traceMetadataExtras.reasoningObserved = attempt.sawReasoning
            if (profile) {
              reasoningCompatibilityProfile = profile
            }

            if (params?.emitUnavailableNotice) {
              const notice = reasoningCompatibilityService.buildUnavailableNotice({
                attempt,
                profile: reasoningCompatibilityProfile,
              })
              if (notice) {
                const markedProfile = await reasoningCompatibilityService.markUnavailable(
                  {
                    provider,
                    connectionId: session.connectionId,
                    modelRawId: session.modelRawId!,
                  },
                  notice,
                )
                reasoningCompatibilityProfile = markedProfile
                traceMetadataExtras.reasoningUnavailable = {
                  code: notice.code,
                  reason: notice.reason,
                }
                traceRecorder.log('reasoning:unavailable', {
                  ...streamLogBase(),
                  protocol: attempt.protocol,
                  code: notice.code,
                  reason: notice.reason,
                  suggestion: notice.suggestion,
                })
                safeEnqueue(
                  `data: ${JSON.stringify({
                    type: 'reasoning_unavailable',
                    code: notice.code,
                    reason: notice.reason,
                    suggestion: notice.suggestion,
                    protocol: attempt.protocol,
                    decision: attempt.decisionReason,
                  })}\n\n`,
                )
              }
            }

            return reasoningCompatibilityProfile
          }
          const completeWithNonStreamingFallback = async (
            origin: 'stream_error' | 'reasoning_only',
          ): Promise<boolean> => {
            const fallbackResult = await performNonStreamingFallback();
            const trimmedText = fallbackResult?.text?.trim() || '';
            const fallbackImages = Array.isArray(fallbackResult?.images) ? fallbackResult!.images : [];
            if (!fallbackResult || (!trimmedText && fallbackImages.length === 0)) {
              return false;
            }

            const appendReasoning = (value?: string | null) => {
              if (!value) return;
              const trimmed = value.trim();
              if (!trimmed) return;
              reasoningCompatibilityService.markReasoningObserved(activeReasoningAttempt);
              reasoningBuffer = reasoningBuffer
                ? `${reasoningBuffer}${reasoningBuffer.endsWith('\n') ? '' : '\n'}${trimmed}`
                : trimmed;
            };
            appendReasoning(fallbackResult.reasoning);

            if (fallbackResult.usage) {
              providerUsageSeen = true;
              providerUsageSnapshot = fallbackResult.usage;
              traceMetadataExtras.finalUsage = fallbackResult.usage;
              traceMetadataExtras.providerUsageSource = 'fallback_non_stream';
              const usageEvent = `data: ${JSON.stringify({ type: 'usage', usage: fallbackResult.usage })}\n\n`;
              emitter.enqueue(usageEvent);
            }

            let resolvedImages = fallbackImages;
            if (fallbackImages.length > 0 && assistantMessageId) {
              try {
                const imageStorage = new GeneratedImageStorage({ prisma });
                const siteBaseSetting = await prisma.systemSetting.findUnique({
                  where: { key: 'site_base_url' },
                  select: { value: true },
                });
                const imageBaseUrl = determineChatImageBaseUrl({
                  request: c.req.raw,
                  siteBaseUrl: siteBaseSetting?.value ?? null,
                });
                const savedImages = await imageStorage.saveImages(fallbackImages, {
                  messageId: assistantMessageId,
                  sessionId,
                });
                resolvedImages = imageStorage.resolveImageUrls(savedImages, imageBaseUrl);
              } catch (error) {
                log.error('[chat stream] non-stream image save failed', {
                  sessionId,
                  messageId: assistantMessageId,
                  error: (error as Error).message,
                });
              }
            }

            const imageMarkdowns: string[] = [];
            if (resolvedImages.length > 0) {
              const seenUrls = new Set<string>();
              let uniqueIdx = 0;
              for (const img of resolvedImages) {
                const finalUrl = img.url || (img.base64 ? `data:${img.mime || 'image/png'};base64,${img.base64}` : '');
                if (!finalUrl) continue;
                const fingerprint = finalUrl.slice(0, 200);
                if (seenUrls.has(fingerprint)) continue;
                seenUrls.add(fingerprint);
                uniqueIdx += 1;
                imageMarkdowns.push(`![Generated Image ${uniqueIdx}](${finalUrl})`);
              }
            }

            const finalText = trimmedText && imageMarkdowns.length > 0
              ? `${trimmedText}\n\n${imageMarkdowns.join('\n\n')}`
              : trimmedText || imageMarkdowns.join('\n\n');

            if (!finalText) {
              return false;
            }

            aiResponseContent = finalText;
            const contentEvent = `data: ${JSON.stringify({ type: 'content', content: finalText })}\n\n`;
            emitter.enqueue(contentEvent);
            const completeEvent = `data: ${JSON.stringify({ type: 'complete', origin: 'fallback' })}\n\n`;
            emitter.enqueue(completeEvent);
            traceStatus = 'completed';
            traceRecorder.log('stream:fallback_non_stream', { origin });

            await persistAssistantProgress({ force: true, status: 'done' });
            let fallbackCompletionTokens = 0;
            try {
              fallbackCompletionTokens = await Tokenizer.countTokens(finalText);
            } catch {
              fallbackCompletionTokens = 0;
            }
            const fallbackUsageNumbers = fallbackResult.usage
              ? extractUsageNumbers(fallbackResult.usage)
              : {
                prompt: promptTokens,
                completion: fallbackCompletionTokens,
                total: promptTokens + fallbackCompletionTokens,
              };
            if (!fallbackResult.usage) {
              traceMetadataExtras.finalUsage = {
                prompt_tokens: fallbackUsageNumbers.prompt,
                completion_tokens: fallbackUsageNumbers.completion,
                total_tokens: fallbackUsageNumbers.total,
                context_limit: contextLimit,
              };
              traceMetadataExtras.providerUsageSource = 'fallback_non_stream';
            }
            const shouldPersistReasoning =
              REASONING_ENABLED &&
              (typeof payload?.saveReasoning === 'boolean' ? payload.saveReasoning : REASONING_SAVE_TO_DB) &&
              reasoningBuffer.trim().length > 0;

            const persistedId = await persistAssistantFinalResponse({
              sessionId,
              existingMessageId: assistantMessageId,
              assistantClientMessageId,
              fallbackClientMessageId: clientMessageId,
              parentMessageId: userMessageRecord?.id ?? null,
              replyHistoryLimit: assistantReplyHistoryLimit,
              content: finalText,
              streamReasoning: shouldPersistReasoning ? reasoningBuffer.trim() : null,
              reasoning: shouldPersistReasoning ? reasoningBuffer.trim() : null,
              reasoningDurationSeconds: shouldPersistReasoning ? reasoningDurationSeconds : null,
              streamError: null,
              usage: {
                promptTokens: fallbackUsageNumbers.prompt,
                completionTokens: fallbackUsageNumbers.completion,
                totalTokens: fallbackUsageNumbers.total,
                contextLimit,
              },
              model: session.modelRawId,
              provider: providerHost ?? undefined,
            });
            if (persistedId) {
              assistantMessageId = persistedId;
              traceRecorder.setMessageContext(
                persistedId,
                assistantClientMessageId ?? clientMessageId,
              );
              traceRecorder.log('db:persist_final', {
                messageId: persistedId,
                length: finalText.length,
                promptTokens: fallbackUsageNumbers.prompt,
                completionTokens: fallbackUsageNumbers.completion,
                totalTokens: fallbackUsageNumbers.total,
                source: 'non_stream_fallback',
              });
            }

            await finalizeReasoningAttempt({
              statusCode: 200,
              emitUnavailableNotice: true,
            });
            return true;
          };

          const handleAbort = () => {
            markDownstreamClosed('request-signal-abort');
          };
          if (requestSignal) {
            if (requestSignal.aborted) {
              markDownstreamClosed('request-already-aborted');
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
              emitter.enqueue(usageEvent);
            }

            // 调用第三方AI API（带退避）
            let response = await providerRequestWithBackoff();

            log.debug('AI provider response', {
              status: response.status,
              ok: response.ok,
              protocol: activeReasoningProtocol,
            })
            if (!response.ok) {
              let errorText = await response.text().catch(() => '')
              traceRecorder.log('http:provider_error_body', {
                route: '/api/chat/stream',
                provider,
                sessionId,
                status: response.status,
                statusText: response.statusText,
                headers: redactHeadersForTrace(response.headers),
                bodyPreview: truncateString(errorText, 500),
                protocol: activeReasoningProtocol,
              })

              const shouldFallbackToChat =
                reasoningCompatibilityEnabled &&
                provider === 'openai' &&
                activeReasoningProtocol === 'responses' &&
                responsesFallbackEnabled &&
                isResponsesUnsupportedFallback(response.status, errorText)

              if (shouldFallbackToChat) {
                await finalizeReasoningAttempt({
                  statusCode: response.status,
                  error: errorText || `HTTP_${response.status}`,
                  emitUnavailableNotice: false,
                })
                activeReasoningProtocol = 'chat_completions'
                reasoningProtocolDecisionReason = 'responses_http_unsupported_fallback_chat'
                providerRequest = buildProtocolRequest('chat_completions')
                activeReasoningAttempt = createReasoningAttempt(
                  activeReasoningProtocol,
                  reasoningProtocolDecisionReason,
                )
                traceRecorder.log('reasoning:protocol_fallback', {
                  ...streamLogBase(),
                  from: 'responses',
                  to: 'chat_completions',
                  status: response.status,
                  reason: 'responses_endpoint_unsupported',
                })

                response = await providerRequestWithBackoff()
                log.debug('AI provider fallback response', {
                  status: response.status,
                  ok: response.ok,
                  protocol: activeReasoningProtocol,
                })
                if (!response.ok) {
                  errorText = await response.text().catch(() => '')
                  traceRecorder.log('http:provider_error_body', {
                    route: '/api/chat/stream',
                    provider,
                    sessionId,
                    status: response.status,
                    statusText: response.statusText,
                    headers: redactHeadersForTrace(response.headers),
                    bodyPreview: truncateString(errorText, 500),
                    protocol: activeReasoningProtocol,
                  })
                  await finalizeReasoningAttempt({
                    statusCode: response.status,
                    error: errorText || `HTTP_${response.status}`,
                    emitUnavailableNotice: false,
                  })
                  const parsedError = parseApiError({
                    status: response.status,
                    message: errorText,
                    error: errorText,
                  });
                  const friendlyMessage = parsedError.suggestion
                    ? `${parsedError.message}。${parsedError.suggestion}`
                    : parsedError.message;
                  throw new Error(friendlyMessage);
                }
              } else {
                await finalizeReasoningAttempt({
                  statusCode: response.status,
                  error: errorText || `HTTP_${response.status}`,
                  emitUnavailableNotice: false,
                })
                // 解析上游错误并生成友好的错误消息
                const parsedError = parseApiError({
                  status: response.status,
                  message: errorText,
                  error: errorText
                });
                const friendlyMessage = parsedError.suggestion
                  ? `${parsedError.message}。${parsedError.suggestion}`
                  : parsedError.message;
                throw new Error(friendlyMessage);
              }
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
            let providerSseLines = 0;
            let providerSseSamples = 0;
            const providerSseSampleLimit = 5;
            let providerContentChunks = 0;
            let providerReasoningChunks = 0;
            let providerUsageEvents = 0;
            let providerStopEvents = 0;
            let providerFirstDeltaAt: number | null = null;
            let providerFirstUsageAt: number | null = null;
            const traceIdleTimeoutMs = traceDecision.config.idleTimeoutMs > 0 ? traceDecision.config.idleTimeoutMs : null;
            let traceIdleWarned = false;
            let pendingVisibleDelta = '';
            let visibleDeltaCount = 0;
            let lastVisibleFlushAt = Date.now();
            let pendingReasoningDelta = '';
            let reasoningDeltaCount = 0;
            let lastReasoningFlushAt = Date.now();
            let providerDone = false;

            const flushVisibleDelta = async (force = false) => {
              if (!pendingVisibleDelta) return;
              const elapsed = Date.now() - lastVisibleFlushAt;
              if (
                !force &&
                visibleDeltaCount < STREAM_DELTA_CHUNK_SIZE &&
                (!streamDeltaFlushIntervalMs || elapsed < streamDeltaFlushIntervalMs)
              ) {
                return;
              }
              aiResponseContent += pendingVisibleDelta;
              const contentEvent = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`;
              safeEnqueue(contentEvent);
              await persistAssistantProgress();
              pendingVisibleDelta = '';
              visibleDeltaCount = 0;
              lastVisibleFlushAt = Date.now();
            };

            const flushReasoningDelta = async (force = false) => {
              if (!pendingReasoningDelta) return;
              const elapsed = Date.now() - lastReasoningFlushAt;
              if (
                !force &&
                reasoningDeltaCount < STREAM_DELTA_CHUNK_SIZE &&
                (!streamReasoningFlushIntervalMs || elapsed < streamReasoningFlushIntervalMs)
              ) {
                return;
              }
              reasoningBuffer += pendingReasoningDelta;
              const reasoningEvent = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`;
              safeEnqueue(reasoningEvent);
              await persistAssistantProgress({ includeReasoning: true });
              pendingReasoningDelta = '';
              reasoningDeltaCount = 0;
              lastReasoningFlushAt = Date.now();
            };

            const emitReasoningKeepalive = (idleMs: number) => {
              const keepaliveEvent = `data: ${JSON.stringify({ type: 'reasoning', keepalive: true, idle_ms: idleMs })}\n\n`;
              emitter.enqueue(keepaliveEvent);
            };
            const emitStreamKeepalive = (idleMs: number) => {
              const keepaliveEvent = `data: ${JSON.stringify({ type: 'keepalive', idle_ms: idleMs })}\n\n`;
              emitter.enqueue(keepaliveEvent);
            };

            stopHeartbeat = streamSseService.startHeartbeat({
              emitter,
              heartbeatIntervalMs,
              providerInitialGraceMs,
              providerReasoningIdleMs,
              reasoningKeepaliveIntervalMs,
              streamKeepaliveIntervalMs,
              traceIdleTimeoutMs,
              getTimestamps: () => ({
                firstChunkAt,
                lastChunkAt,
                lastKeepaliveSentAt,
                requestStartedAt,
              }),
              setLastKeepaliveSentAt: (ts) => {
                lastKeepaliveSentAt = ts
              },
              onTraceIdleTimeout: traceIdleWarned
                ? undefined
                : (idleMs) => {
                  traceRecorder.log('stream.keepalive_timeout', { idleMs })
                  traceIdleWarned = true
                },
              onProviderInitialTimeout: (idleMs) => {
                traceRecorder.log('stream.first_chunk_timeout', {
                  ...streamLogBase(),
                  provider,
                  baseUrl,
                  idleMs,
                  providerInitialGraceMs,
                })
              },
              cancelProvider: () => {
                try { (response as any)?.body?.cancel?.(); } catch { }
              },
              flushReasoningDelta: (force) => flushReasoningDelta(force),
              flushVisibleDelta: (force) => flushVisibleDelta(force),
              emitReasoningKeepalive,
              emitStreamKeepalive,
            });

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

                providerSseLines += 1;

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
	                let parsedKind: string = 'raw';
	                try {
	                  parsed = JSON.parse(data);
	                  parsedKind = 'json';
	                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', data, parseError);
                  if (providerSseSamples < providerSseSampleLimit) {
                    providerSseSamples += 1;
                    traceRecorder.log('stream.provider_sse_sample', {
                      ...streamLogBase(),
                      provider,
                      baseUrl,
                      idx: providerSseSamples,
                      kind: 'parse_error',
                      rawPreview: truncateString(data, 200),
                    })
                  }
	                  continue;
	                }

	                const responsesEvent = extractOpenAIResponsesStreamEvent(parsed)
	                if (responsesEvent) {
	                  if (responsesEvent.kind === 'delta') {
	                    const deltaReasoning = responsesEvent.reasoningDelta
	                    const deltaContent = responsesEvent.contentDelta

	                    if (REASONING_ENABLED && deltaReasoning) {
                        const signal =
                          parsed?.type === 'response.reasoning_summary_text.delta'
                            ? 'responses.reasoning_summary_text.delta'
                            : 'responses.reasoning_text.delta'
                        reasoningCompatibilityService.markSignal(activeReasoningAttempt, signal)
	                      if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
	                      pendingReasoningDelta += deltaReasoning
	                      reasoningDeltaCount += 1
	                      providerReasoningChunks += 1
	                      if (!providerFirstDeltaAt) providerFirstDeltaAt = now
	                      await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE)
	                    }

	                    if (deltaContent) {
	                      if (!providerFirstDeltaAt) providerFirstDeltaAt = now
	                      let visible = deltaContent
	                      if (REASONING_ENABLED && REASONING_TAGS_MODE !== 'off') {
	                        const tags =
	                          REASONING_TAGS_MODE === 'custom' && REASONING_CUSTOM_TAGS
	                            ? REASONING_CUSTOM_TAGS
	                            : DEFAULT_REASONING_TAGS
	                        const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState)
	                        visible = visibleDelta
	                        if (reasoningDelta) {
                            reasoningCompatibilityService.markSignal(activeReasoningAttempt, 'tag.reasoning')
                            reasoningCompatibilityService.markReasoningObserved(activeReasoningAttempt)
	                          if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
	                          pendingReasoningDelta += reasoningDelta
	                          reasoningDeltaCount += 1
	                          providerReasoningChunks += 1
	                          await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE)
	                        }
	                      }

	                      if (visible) {
	                        pendingVisibleDelta += visible
	                        visibleDeltaCount += 1
	                        providerContentChunks += 1
	                        await flushVisibleDelta(visibleDeltaCount >= STREAM_DELTA_CHUNK_SIZE)
	                      }
	                    }

	                    continue
	                  }

	                  if (responsesEvent.kind === 'done') {
	                    if (USAGE_EMIT && responsesEvent.usage) {
	                      const usagePayload = responsesEvent.usage
	                      const n = (u: any) => ({
	                        prompt: Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0,
	                        completion: Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0,
	                        total: Number(u?.total_tokens ?? 0) || 0,
	                      })
	                      const nn = n(usagePayload)
	                      const valid = nn.prompt > 0 || nn.completion > 0 || nn.total > 0
	                      if (valid) {
	                        providerUsageSeen = true
	                        providerUsageSnapshot = usagePayload
	                        traceMetadataExtras.finalUsage = usagePayload
	                        traceMetadataExtras.providerUsageSource = 'provider'
	                      }
	                      if (!providerFirstUsageAt) providerFirstUsageAt = now
	                      providerUsageEvents += 1
	                      safeEnqueue(`data: ${JSON.stringify({ type: 'usage', usage: usagePayload })}\n\n`)
	                    }

	                    await flushReasoningDelta(true)
	                    await flushVisibleDelta(true)
	                    safeEnqueue(`data: ${JSON.stringify({ type: 'end' })}\n\n`)
	                    providerDone = true
	                    break
	                  }

	                  continue
	                }

	                // 提取AI响应内容
	                const deltaContent: string | undefined = parsed.choices?.[0]?.delta?.content;
	                const deltaReasoning: string | undefined =
	                  parsed?.choices?.[0]?.delta?.reasoning_content ??
	                  parsed?.choices?.[0]?.delta?.reasoning ??
	                  parsed?.choices?.[0]?.delta?.thinking ??
	                  parsed?.choices?.[0]?.delta?.analysis ??
	                  parsed?.delta?.reasoning_content ??
	                  parsed?.delta?.reasoning ??
	                  parsed?.message?.reasoning_content ??
	                  parsed?.message?.reasoning ??
	                  parsed?.reasoning ??
	                  parsed?.analysis;

                // 供应商原生 reasoning_content（OpenAI 等）
                if (REASONING_ENABLED && deltaReasoning) {
                  const signal = detectChatReasoningSignal(parsed)
                  if (signal) {
                    reasoningCompatibilityService.markSignal(activeReasoningAttempt, signal)
                  } else {
                    reasoningCompatibilityService.markReasoningObserved(activeReasoningAttempt)
                  }
                  if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                  pendingReasoningDelta += deltaReasoning;
                  reasoningDeltaCount += 1;
                  providerReasoningChunks += 1;
                  if (!providerFirstDeltaAt) providerFirstDeltaAt = now;
                  await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                }

                if (deltaContent) {
                  if (!providerFirstDeltaAt) providerFirstDeltaAt = now;
                  let visible = deltaContent;
                  if (REASONING_ENABLED && REASONING_TAGS_MODE !== 'off') {
                    const tags = REASONING_TAGS_MODE === 'custom' && REASONING_CUSTOM_TAGS ? REASONING_CUSTOM_TAGS : DEFAULT_REASONING_TAGS;
                    const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState);
                    visible = visibleDelta;
                    if (reasoningDelta) {
                      reasoningCompatibilityService.markSignal(activeReasoningAttempt, 'tag.reasoning')
                      reasoningCompatibilityService.markReasoningObserved(activeReasoningAttempt)
                      if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                      pendingReasoningDelta += reasoningDelta;
                      reasoningDeltaCount += 1;
                      providerReasoningChunks += 1;
                      await flushReasoningDelta(reasoningDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                    }
                  }

                  if (visible) {
                    pendingVisibleDelta += visible;
                    visibleDeltaCount += 1;
                    providerContentChunks += 1;
                    await flushVisibleDelta(visibleDeltaCount >= STREAM_DELTA_CHUNK_SIZE);
                  }
                }

                // 结束原因（如果可用）
                const fr = parsed.choices?.[0]?.finish_reason;
                if (fr) {
                  providerStopEvents += 1;
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
                  if (!providerFirstUsageAt) providerFirstUsageAt = now;
                  providerUsageEvents += 1;
                  const providerUsageEvent = `data: ${JSON.stringify({
                    type: 'usage',
                    usage: parsed.usage,
                  })}\n\n`;
                  safeEnqueue(providerUsageEvent);
                }

                if (providerSseSamples < providerSseSampleLimit) {
                  providerSseSamples += 1;
                  traceRecorder.log('stream.provider_sse_sample', {
                    ...streamLogBase(),
                    provider,
                    baseUrl,
                    idx: providerSseSamples,
                    kind: parsedKind,
                    deltaContentPreview: deltaContent ? truncateString(deltaContent, 120) : undefined,
                    deltaReasoningPreview: deltaReasoning ? truncateString(deltaReasoning, 120) : undefined,
                    finishReason: fr,
                    hasUsage: Boolean(parsed.usage),
                  })
                }
              }

              if (providerDone) {
                break;
              }
            }

            traceRecorder.log('stream.provider_sse_summary', {
              ...streamLogBase(),
              provider,
              baseUrl,
              protocol: activeReasoningProtocol,
              protocolDecision: reasoningProtocolDecisionReason,
              firstChunkAt,
              firstChunkDelayMs: firstChunkAt ? firstChunkAt - requestStartedAt : null,
              firstDeltaDelayMs: providerFirstDeltaAt ? providerFirstDeltaAt - requestStartedAt : null,
              firstUsageDelayMs: providerFirstUsageAt ? providerFirstUsageAt - requestStartedAt : null,
              lastChunkAt,
              providerDone,
              downstreamAborted,
              sseLines: providerSseLines,
              contentChunks: providerContentChunks,
              reasoningChunks: providerReasoningChunks,
              usageEvents: providerUsageEvents,
              stopEvents: providerStopEvents,
            })

            await flushReasoningDelta(true);
            await flushVisibleDelta(true);
            stopHeartbeat();
            bindProviderController(null);
            currentProviderController = null;
            if (!aiResponseContent.trim()) {
              const handledByFallback = await completeWithNonStreamingFallback('reasoning_only');
              if (handledByFallback) {
                return;
              }
              if (reasoningBuffer.trim()) {
                const errorMessage = '模型仅返回推理，未生成正文';
                const errorEvent = `data: ${JSON.stringify({
                  type: 'error',
                  error: errorMessage,
                })}\n\n`;
                safeEnqueue(errorEvent);
                traceStatus = 'error';
                traceErrorMessage = errorMessage;
                traceRecorder.log('stream:error', { message: errorMessage, reason: 'reasoning_only_without_content' });
                await persistAssistantProgress({
                  force: true,
                  includeReasoning: true,
                  status: 'error',
                  errorMessage,
                });
                await finalizeReasoningAttempt({
                  statusCode: 200,
                  error: errorMessage,
                  emitUnavailableNotice: false,
                });
                return;
              }
            }

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
            await finalizeReasoningAttempt({
              statusCode: 200,
              emitUnavailableNotice: true,
            });

            // 保存AI完整回复延后到完成阶段，以便与 usage 绑定

            // 始终计算兜底 completion tokens：即使关闭 usage 事件，也需要用于 metrics 与落库
            try {
              completionTokensFallback = await Tokenizer.countTokens(aiResponseContent);
            } catch (_) {
              completionTokensFallback = 0;
            }

            // 在完成前透出兜底 usage（若未收到厂商 usage，或未设置仅透传）
            if (USAGE_EMIT && (!USAGE_PROVIDER_ONLY || !providerUsageSeen)) {
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

            // 计算流式响应的性能指标
            const completionTokensForMetrics = resolveCompletionTokensForMetrics({
              providerUsageSeen,
              providerUsageSnapshot,
              completionTokensFallback,
            });
            const completedAt = Date.now();
            const streamMetrics = computeStreamMetrics({
              timing: {
                requestStartedAt,
                firstChunkAt,
                completedAt,
              },
              completionTokens: completionTokensForMetrics,
            });

            // 发送完成事件（包含后端计算的 metrics）
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              metrics: {
                firstTokenLatencyMs: streamMetrics.firstTokenLatencyMs,
                responseTimeMs: streamMetrics.responseTimeMs,
                tokensPerSecond: streamMetrics.tokensPerSecond,
              },
            })}\n\n`;
            safeEnqueue(completeEvent);
            traceStatus = 'completed';
            traceMetadataExtras.reasoningDurationSeconds = reasoningDurationSeconds;

            // 完成后持久化 usage（优先厂商 usage，否则兜底估算）
            try {
              const usageResult = await streamUsageService.finalize({
                sessionId,
                modelRawId: session.modelRawId!,
                providerHost,
                assistantMessageId,
                assistantClientMessageId,
                clientMessageId,
                userMessageId: userMessageRecord?.id ?? null,
                content: aiResponseContent,
                reasoningBuffer,
                reasoningDurationSeconds,
                promptTokens,
                completionTokensFallback,
                contextLimit,
                providerUsageSeen,
                providerUsageSnapshot,
                reasoningEnabled: REASONING_ENABLED,
                reasoningSaveToDb:
                  typeof payload?.saveReasoning === 'boolean'
                    ? payload.saveReasoning
                    : REASONING_SAVE_TO_DB,
                assistantReplyHistoryLimit,
                traceRecorder,
                timing: {
                  requestStartedAt,
                  firstChunkAt,
                  completedAt,
                },
                precomputedMetrics: streamMetrics,
              });
              assistantMessageId = usageResult.assistantMessageId;
              traceMetadataExtras.finalUsage = {
                prompt_tokens: usageResult.finalUsage.prompt,
                completion_tokens: usageResult.finalUsage.completion,
                total_tokens: usageResult.finalUsage.total,
                context_limit: usageResult.finalUsage.contextLimit,
                context_remaining: Math.max(
                  0,
                  usageResult.finalUsage.contextLimit - usageResult.finalUsage.prompt,
                ),
              };
              traceMetadataExtras.providerUsageSource = usageResult.providerUsageSource;

              const traceResult = await streamTraceService.handleLatexTrace({
                traceRecorder,
                latexTraceRecorder,
                content: aiResponseContent,
                assistantMessageId,
                assistantClientMessageId,
                clientMessageId,
              })
              latexTraceRecorder = traceResult.latexTraceRecorder
              latexAuditSummary = traceResult.latexAuditSummary
            } catch (persistErr) {
              console.warn('Persist final assistant response failed:', persistErr);
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
              await finalizeReasoningAttempt({
                error: 'cancelled_by_user',
                emitUnavailableNotice: false,
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
              const handledByFallback = await completeWithNonStreamingFallback('stream_error');
              if (handledByFallback) {
                return;
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
            await finalizeReasoningAttempt({
              error: errorMessage,
              emitUnavailableNotice: false,
            });
          } finally {
            if (requestSignal) {
              try {
                requestSignal.removeEventListener('abort', handleAbort);
              } catch { }
            }
            try {
              stopHeartbeat();
              controller.close();
            } catch { }
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
            if (latexTraceRecorder) {
              try {
                await latexTraceRecorder.finalize(traceErrorMessage ? 'error' : 'completed', traceErrorMessage ? { error: traceErrorMessage } : undefined);
              } catch (error) {
                log.warn('Finalize latex trace failed', error);
              }
            }
            if (latexAuditSummary) {
              traceMetadataExtras.latexAudit = latexAuditSummary;
            }
            await finalizeReasoningAttempt({
              error: traceErrorMessage,
              emitUnavailableNotice: false,
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

      traceRecorder?.log('http:client_response', {
        route: '/api/chat/stream',
        direction: 'inbound',
        sessionId,
        actor: actor.identifier,
        status: 200,
        stream: true,
        sseHeaders,
      })
      return c.newResponse(stream as any, 200, sseHeaders);

    } catch (error) {
      console.error('Chat stream error:', error);
      log.error('Chat stream error detail', (error as Error)?.message, (error as Error)?.stack)
      traceRecorder?.log('http:client_response', {
        route: '/api/chat/stream',
        direction: 'inbound',
        actor: (() => {
          try { return (c.get('actor') as Actor | undefined)?.identifier }
          catch { return undefined }
        })(),
        status: 500,
        error: summarizeErrorForTrace(error),
      })
      if (traceRecorder?.isEnabled()) {
        await traceRecorder.finalize('error', {
          metadata: { error: (error as Error)?.message || String(error) },
        })
      }
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

    // 调试日志：检测流元数据匹配失败的情况
    if (meta && !matchedMeta) {
      log.warn('Stream cancel: meta found but actor mismatch', {
        sessionId,
        messageId,
        clientMessageId: normalizedClientMessageId,
        metaActorId: meta.actorId,
        requestActorId: actor.identifier,
        metaSessionId: meta.sessionId,
      });
    }

    const assistantClientIdFromRequest = resolveAssistantClientIdFromRequest(normalizedClientMessageId);
    const effectiveAssistantClientId =
      matchedMeta?.assistantClientMessageId ?? assistantClientIdFromRequest ?? normalizedClientMessageId ?? null;

    if (matchedMeta) {
      matchedMeta.cancelled = true;
      try {
        matchedMeta.controller?.abort();
      } catch { }
      clearPendingCancelMarkers({
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: matchedMeta.assistantClientMessageId ?? effectiveAssistantClientId,
      });
      log.debug('Stream cancel: direct cancellation via streamMeta', {
        sessionId,
        messageId: matchedMeta.assistantMessageId,
        streamKey: matchedMeta.streamKey,
      });
    } else {
      registerPendingCancelMarker({
        sessionId,
        messageId: typeof messageId === 'number' || typeof messageId === 'string' ? messageId : null,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: effectiveAssistantClientId,
      });
      log.debug('Stream cancel: registered pending cancel marker (no active stream found)', {
        sessionId,
        messageId,
        clientMessageId: normalizedClientMessageId,
        assistantClientMessageId: effectiveAssistantClientId,
        metaFound: !!meta,
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
