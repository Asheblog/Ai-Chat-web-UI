import { Prisma, type ChatSession, type Connection } from '@prisma/client';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import {
  extractReasoningFromResponsesResponse,
  extractTextFromResponsesResponse,
} from '../../utils/openai-responses';
import { buildChatProviderRequest } from '../../utils/chat-provider';
import { Tokenizer } from '../../utils/tokenizer';
import type { WebSearchHit } from '../../utils/web-search';
import { serializeQuotaSnapshot } from '../../utils/quota';
import { getFriendlyErrorMessage, parseApiError } from '../../utils/api-error-parser';
import type { UsageQuotaSnapshot } from '../../types';
import { summarizeSsePayload } from '../../utils/task-trace';
import type { TaskTraceRecorder, TaskTraceStatus } from '../../utils/task-trace';
import type { ToolLogEntry } from './tool-logs';
import { persistAssistantFinalResponse, upsertAssistantMessageByClientId } from './assistant-message-service';
import {
  buildAgentStreamKey,
  deriveAssistantClientMessageId,
  persistStreamMeta,
  registerStreamMeta,
  releaseStreamMeta,
  updateStreamMetaController,
  buildPendingCancelKeyByMessageId,
  buildPendingCancelKeyByClientId,
  hasPendingStreamCancelKey,
  deletePendingStreamCancelKey,
} from './stream-state';
import type { RAGService } from '../../services/document/rag-service';
import { ToolLogManager } from './tool-log-manager';
import { StreamEventEmitter } from './stream-event-emitter';
import {
  createToolHandlerRegistry,
  sendUnsupportedToolError,
  type ToolCall,
} from './tool-handlers';
import {
  type LegacyFunctionCall,
  type ToolSchema,
  appendLegacyFunctionCallDelta,
  appendOpenAIToolCallDelta,
  appendResponsesToolCallEvent,
  buildUnsupportedToolResult,
  buildTextToolResultMessage,
  buildToolRequest,
  createToolCallBuffers,
  extractToolCallsFromMessage,
  extractToolCallsFromResponsesOutput,
  isUnsupportedFunctionParamError,
  isUnsupportedToolParamError,
  normalizeToolHandlerResult,
  parseToolCalls,
  resolveToolSchema,
} from './tool-protocol';
import {
  type AgentWebSearchConfig,
  type AgentPythonToolConfig,
  type AgentUrlReaderConfig,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
} from './agent-tool-config';
import type { ProviderType } from '../../utils/providers';

// Re-export for backwards compatibility
export {
  AgentWebSearchConfig,
  AgentPythonToolConfig,
  AgentUrlReaderConfig,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
};

type ChatSessionWithConnection = ChatSession & { connection: Connection | null };

export type AgentResponseParams = {
  session: ChatSessionWithConnection;
  sessionId: number;
  requestData: Record<string, any>;
  messagesPayload: any[];
  promptTokens: number;
  contextLimit: number;
  contextRemaining: number;
  quotaSnapshot: UsageQuotaSnapshot | null;
  userMessageRecord: any;
  sseHeaders: Record<string, string>;
  agentConfig: AgentWebSearchConfig;
  pythonToolConfig: AgentPythonToolConfig;
  urlReaderConfig: AgentUrlReaderConfig;
  agentMaxToolIterations: number;
  toolFlags: {
    webSearch: boolean;
    python: boolean;
    urlReader?: boolean;
    document?: boolean;
    knowledgeBase?: boolean;
  };
  knowledgeBaseIds?: number[];
  provider: string;
  baseUrl: string;
  authHeader: Record<string, string>;
  extraHeaders: Record<string, string>;
  reasoningEnabled: boolean;
  reasoningSaveToDb: boolean;
  clientMessageId?: string | null;
  actorIdentifier: string;
  requestSignal?: AbortSignal;
  assistantMessageId: number | null;
  assistantClientMessageId?: string | null;
  streamProgressPersistIntervalMs: number;
  traceRecorder: TaskTraceRecorder;
  idleTimeoutMs: number;
  assistantReplyHistoryLimit: number;
  maxConcurrentStreams: number;
  concurrencyErrorMessage: string;
  ragService?: RAGService | null;
};

export const createAgentWebSearchResponse = async (params: AgentResponseParams): Promise<Response> => {
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
    pythonToolConfig,
    urlReaderConfig,
    agentMaxToolIterations,
    toolFlags,
    provider,
    baseUrl,
    authHeader,
    extraHeaders,
    reasoningEnabled,
    reasoningSaveToDb,
    clientMessageId,
    actorIdentifier,
    requestSignal,
    assistantMessageId,
    assistantClientMessageId,
    streamProgressPersistIntervalMs,
    traceRecorder,
    idleTimeoutMs,
    assistantReplyHistoryLimit,
    maxConcurrentStreams,
    concurrencyErrorMessage,
    ragService,
  } = params;

  const traceMetadataExtras: Record<string, unknown> = {};
  let traceStatus: TaskTraceStatus = 'running';
  let traceErrorMessage: string | null = null;
  traceRecorder.log('agent:activated', {
    provider,
    baseUrl,
    engine: agentConfig.engine,
    model: session.modelRawId,
    tools: {
      web_search: toolFlags.webSearch,
      python_runner: toolFlags.python,
      url_reader: Boolean(toolFlags.urlReader),
      document_tools: Boolean(toolFlags.document),
      knowledge_base_tools: Boolean(toolFlags.knowledgeBase),
    },
  });

  let activeAssistantMessageId = assistantMessageId ?? null;

  const resolvedClientMessageId =
    clientMessageId ??
    userMessageRecord?.clientMessageId ??
    requestData?.client_message_id ??
    requestData?.clientMessageId ??
    null;
  const streamMeta = registerStreamMeta({
    sessionId,
    actorIdentifier,
    clientMessageId: resolvedClientMessageId,
    assistantMessageId: activeAssistantMessageId,
    assistantClientMessageId: assistantClientMessageId ?? null,
    maxActorStreams: maxConcurrentStreams,
  });
  if (!streamMeta) {
    traceRecorder.log('agent:concurrency_denied', {
      limit: maxConcurrentStreams,
      actor: actorIdentifier,
    });
    return new Response(
      JSON.stringify({ success: false, error: concurrencyErrorMessage }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const streamKey =
    streamMeta?.streamKey ??
    buildAgentStreamKey(sessionId, resolvedClientMessageId, userMessageRecord?.id ?? null);
  const assistantPlaceholderClientMessageId =
    typeof assistantClientMessageId === 'string' && assistantClientMessageId.trim().length > 0
      ? assistantClientMessageId
      : deriveAssistantClientMessageId(resolvedClientMessageId);

  const setStreamController = (controller: AbortController | null) => {
    updateStreamMetaController(streamMeta, controller);
  };

  const releaseStreamMetaHandle = () => {
    releaseStreamMeta(streamMeta);
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let downstreamClosed = false;
      let assistantProgressLastPersistAt = 0;
      let assistantProgressLastPersistedLength = 0;
      let assistantReasoningPersistLength = 0;
      const idleTimeout = idleTimeoutMs > 0 ? idleTimeoutMs : null;
      let idleWatchTimer: ReturnType<typeof setInterval> | null = null;
      let lastChunkAt = Date.now();
      let idleWarned = false;
      const startedAt = Date.now();
      let firstChunkAt: number | null = null;

      const toolLogs: ToolLogEntry[] = [];
      let toolLogSequence = 0;
      let toolLogsDirty = false;

      const persistAssistantProgress = async (
        options: { force?: boolean; includeReasoning?: boolean; status?: 'streaming' | 'done' | 'error' | 'cancelled'; errorMessage?: string | null } = {},
      ) => {
        if (!activeAssistantMessageId) return;
        const force = options.force === true;
        const includeReasoning = options.includeReasoning !== false;
        const currentReasoning =
          includeReasoning && reasoningBuffer.trim().length ? reasoningBuffer : null;
        const hasToolLogDelta = toolLogsDirty;
        if (!aiResponseContent && !currentReasoning && !force && !hasToolLogDelta) return;
        const now = Date.now();
        const deltaLength = aiResponseContent.length - assistantProgressLastPersistedLength;
        const reasoningDelta = includeReasoning
          ? reasoningBuffer.length - assistantReasoningPersistLength
          : 0;
        if (!force) {
          const keepaliveExceeded =
            now - assistantProgressLastPersistAt >= streamProgressPersistIntervalMs;
          const hasContentDelta = deltaLength >= 24;
          const hasReasoningDelta = includeReasoning && reasoningDelta >= 24;
          if (!hasContentDelta && !hasReasoningDelta && !keepaliveExceeded && !hasToolLogDelta) {
            return;
          }
        }
        assistantProgressLastPersistAt = now;
        assistantProgressLastPersistedLength = aiResponseContent.length;
        if (includeReasoning) {
          assistantReasoningPersistLength = reasoningBuffer.length;
        }
        const streamStatus = options.status ?? (streamMeta?.cancelled ? 'cancelled' : 'streaming');
        const reasoningPayload =
          currentReasoning && currentReasoning.trim().length ? currentReasoning : null;
        const shouldPersistToolLogs = toolLogsDirty || force;
        const toolLogsJson = shouldPersistToolLogs
          ? toolLogs.length > 0
            ? JSON.stringify(toolLogs)
            : null
          : undefined;
        try {
          const updateData: Prisma.MessageUpdateInput = {
            content: aiResponseContent,
            streamCursor: aiResponseContent.length,
            streamStatus,
            streamReasoning: reasoningPayload,
          };
          if (toolLogsJson !== undefined) {
            updateData.toolLogsJson = toolLogsJson;
          }
          await prisma.message.update({
            where: { id: activeAssistantMessageId },
            data: updateData,
          });
          traceRecorder.log('db:persist_progress', {
            messageId: activeAssistantMessageId,
            length: aiResponseContent.length,
            reasoningLength: reasoningPayload?.length ?? 0,
            force,
            toolLogsPersisted: toolLogsJson ? toolLogs.length : 0,
            toolLogsPending: toolLogsDirty ? toolLogs.length : 0,
          });
          if (toolLogsJson !== undefined) {
            toolLogsDirty = false;
          }
        } catch (error) {
          const isRecordMissing =
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
          if (isRecordMissing) {
            const recoveredId = await upsertAssistantMessageByClientId({
              sessionId,
              clientMessageId: assistantPlaceholderClientMessageId,
              data: {
                content: aiResponseContent,
                streamCursor: aiResponseContent.length,
                streamStatus,
                streamReasoning: reasoningPayload,
                streamError: null,
                ...(toolLogsJson !== undefined ? { toolLogsJson } : {}),
              },
            });
            if (recoveredId) {
              activeAssistantMessageId = recoveredId;
              if (streamMeta) {
                streamMeta.assistantMessageId = recoveredId;
                persistStreamMeta(streamMeta);
              }
              if (toolLogsJson !== undefined) {
                toolLogsDirty = false;
              }
              log.warn('Assistant progress target missing, upserted placeholder record', {
                sessionId,
                recoveredId,
              });
              traceRecorder.log('db:persist_progress', {
                messageId: recoveredId,
                length: aiResponseContent.length,
                reasoningLength: reasoningPayload?.length ?? 0,
                force,
                recovered: true,
                toolLogsPersisted: toolLogsJson ? toolLogs.length : 0,
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

      const safeEnqueue = (payload: Record<string, unknown>) => {
        if (!downstreamClosed && requestSignal?.aborted) {
          downstreamClosed = true;
        }
        if (downstreamClosed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          traceRecorder.log('sse:dispatch', summarizeSsePayload(payload));
          return true;
        } catch {
          downstreamClosed = true;
          return false;
        }
      };

      // 检查取消状态（包括直接取消标志和待取消标记）
      // 修复：刷新页面后停止按钮无效的问题
      const checkCancelled = (): boolean => {
        if (streamMeta?.cancelled) return true;
        // 检查 pendingCancelMarker（处理刷新页面后取消请求的情况）
        const cancelKeys = [
          buildPendingCancelKeyByMessageId(sessionId, activeAssistantMessageId),
          buildPendingCancelKeyByClientId(sessionId, assistantPlaceholderClientMessageId),
          buildPendingCancelKeyByClientId(sessionId, resolvedClientMessageId),
        ].filter(Boolean) as string[];
        for (const key of cancelKeys) {
          if (hasPendingStreamCancelKey(key)) {
            deletePendingStreamCancelKey(key);
            if (streamMeta) {
              streamMeta.cancelled = true;
            }
            return true;
          }
        }
        return false;
      };

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

      const mergeToolLogDetails = (
        previous?: ToolLogEntry['details'],
        next?: ToolLogEntry['details'],
      ): ToolLogEntry['details'] | undefined => {
        if (!previous && !next) return undefined;
        if (!previous) return next;
        if (!next) return previous;
        return {
          ...previous,
          ...next,
        };
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
        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          entry.summary = payload.summary.trim();
        }
        if (typeof payload.error === 'string' && payload.error.trim()) {
          entry.error = payload.error;
        }
        if (payload.details && typeof payload.details === 'object') {
          entry.details = payload.details as ToolLogEntry['details'];
        }
        const existingIndex = toolLogs.findIndex((log) => log.id === entry.id);
        if (existingIndex === -1) {
          toolLogs.push(entry);
        } else {
          const existing = toolLogs[existingIndex];
          toolLogs[existingIndex] = {
            ...existing,
            stage: entry.stage,
            query: entry.query ?? existing.query,
            hits: entry.hits ?? existing.hits,
            error: entry.error ?? existing.error,
            summary: entry.summary ?? existing.summary,
            createdAt: existing.createdAt,
            details: mergeToolLogDetails(existing.details, entry.details),
          };
        }
        toolLogsDirty = true;
        traceRecorder.log('tool:event_buffer', {
          messageId: activeAssistantMessageId ?? null,
          tool,
          stage,
          totalBuffered: toolLogs.length,
        });
        // 立即异步持久化工具事件，刷新页面也能看到最新工具日志
        persistAssistantProgress({ includeReasoning: false }).catch(() => { });
      };

      const sendToolEvent = (payload: Record<string, unknown>) => {
        const enriched = { type: 'tool', ...payload };
        safeEnqueue(enriched);
        recordToolLog(payload);
        traceRecorder.log('tool:event', summarizeSsePayload(enriched));
      };

      const startIdleWatch = () => {
        if (!idleTimeout || idleWatchTimer) return;
        idleWatchTimer = setInterval(() => {
          if (!idleTimeout || downstreamClosed) return;
          const idleFor = Date.now() - lastChunkAt;
          if (idleFor >= idleTimeout && !idleWarned) {
            traceRecorder.log('stream.keepalive_timeout', { idleMs: idleFor });
            idleWarned = true;
          }
        }, Math.min(Math.max(1000, idleTimeout / 2), 5000));
      };
      startIdleWatch();

      const appendReasoningChunk = (text: string, meta?: Record<string, unknown>) => {
        if (!text) return;
        const metaKind =
          meta && typeof (meta as any).kind === 'string' ? ((meta as any).kind as string) : null;
        if (metaKind && metaKind !== 'model' && reasoningBuffer && !reasoningBuffer.endsWith('\n')) {
          reasoningBuffer += '\n';
        }
        reasoningBuffer += text;
      };

      const emitReasoning = (content: string, meta?: Record<string, unknown>) => {
        const text = (content || '').trim();
        if (!text) return;
        appendReasoningChunk(text, meta);
        const payload: Record<string, unknown> = { type: 'reasoning', content: text };
        if (meta && Object.keys(meta).length > 0) {
          payload.meta = meta;
        }
        safeEnqueue(payload);
      };

      // 对齐标准流式接口：携带 assistantMessageId / assistantClientMessageId，便于前端替换占位ID
      safeEnqueue({
        type: 'start',
        messageId: userMessageRecord?.id ?? null,
        assistantMessageId: activeAssistantMessageId,
        assistantClientMessageId: assistantClientMessageId ?? assistantPlaceholderClientMessageId ?? null,
      });
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
      const knowledgeBaseIds = params.knowledgeBaseIds || [];
      const toolRegistry = createToolHandlerRegistry({
        webSearch: toolFlags.webSearch ? agentConfig : null,
        python: toolFlags.python ? pythonToolConfig : null,
        urlReader: toolFlags.urlReader ? {
          enabled: true,
          timeout: urlReaderConfig.timeout,
          maxContentLength: urlReaderConfig.maxContentLength,
        } : null,
        document: ragService && toolFlags.document
          ? { enabled: true, sessionId, ragService }
          : null,
        knowledgeBase: ragService && toolFlags.knowledgeBase
          ? { enabled: true, knowledgeBaseIds, ragService }
          : null,
      });
      const toolDefinitions = toolRegistry.getToolDefinitions();
      const allowedToolNames = toolRegistry.getAllowedToolNames();
      if (toolDefinitions.length === 0) {
        throw new Error('Agent 工具未启用');
      }
      let toolSchema: ToolSchema = resolveToolSchema({ provider, requestData });
      const maxIterations =
        agentMaxToolIterations > 0 ? agentMaxToolIterations : Number.POSITIVE_INFINITY;
      let currentProviderController: AbortController | null = null;
      const streamEnabled = provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai';

      const callProvider = async (messages: any[], schema: ToolSchema) => {
        const { body: chatBody, messages: preparedMessages, textPromptAdded } = buildToolRequest({
          requestData,
          messages,
          toolDefinitions,
          schema,
          provider,
          stream: streamEnabled,
        });
        if (textPromptAdded) {
          messages.splice(0, messages.length, ...preparedMessages);
        }
        const { url, body, streamMode } = buildChatProviderRequest({
          provider: provider as ProviderType,
          baseUrl,
          rawModelId: session.modelRawId!,
          body: chatBody,
          azureApiVersion: session.connection?.azureApiVersion,
          stream: streamEnabled,
        });

        const headers = {
          'Content-Type': 'application/json',
          ...authHeader,
          ...extraHeaders,
        };

        traceRecorder.log('agent:provider_request', {
          provider,
          model: session.modelRawId,
          url,
          headerKeys: Object.keys(headers || {}),
          authHeaderProvided: Object.keys(authHeader || {}).length > 0,
          extraHeaderKeys: Object.keys(extraHeaders || {}),
          streamMode,
          toolsRequested:
            schema === 'functions'
              ? toolDefinitions.map((fn: any) => fn?.function?.name || 'unknown')
              : Array.isArray(body.tools)
                ? body.tools.map((t: any) => t?.function?.name || t?.type || 'unknown')
                : [],
          toolSchema: schema,
        });

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
            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              // ignore
            }
            const requestError: any = new Error(
              `AI provider request failed (${response.status}): ${text}`,
            );
            requestError.status = response.status;
            if (parsed) {
              requestError.payload = parsed;
            }
            throw requestError;
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
      let aiResponseContent = '';
      let reasoningBuffer = '';
      let providerUsageSeen = false;

      try {
        let iterations = 0;
        while (iterations < maxIterations) {
          iterations += 1;
          let response: Response;
          try {
            response = await callProvider(workingMessages, toolSchema);
          } catch (error) {
            if (
              toolSchema === 'tools' &&
              provider !== 'openai_responses' &&
              isUnsupportedToolParamError(error)
            ) {
              toolSchema = 'functions';
              traceRecorder.log('agent:tool_schema_fallback', {
                provider,
                model: session.modelRawId,
                schema: toolSchema,
              });
              response = await callProvider(workingMessages, toolSchema);
            } else if (toolSchema === 'functions' && isUnsupportedFunctionParamError(error)) {
              toolSchema = 'text';
              traceRecorder.log('agent:tool_schema_fallback', {
                provider,
                model: session.modelRawId,
                schema: toolSchema,
              });
              response = await callProvider(workingMessages, toolSchema);
            } else {
              throw error;
            }
          }
          const reader = streamEnabled ? response.body?.getReader() : null;
          if (streamEnabled && !reader) {
            throw new Error('AI provider returned no response body');
          }
          const decoder = new TextDecoder();
          let buffer = '';
          let sawSse = false;
          let providerUsage: any = null;
          let iterationContent = '';
          let iterationReasoning = '';
          let iterationReasoningStartedAt: number | null = null;
          let contentAlreadySent = false;
          const toolCallBuffers = createToolCallBuffers();
          let messageToolCalls: ToolCall[] = [];
          let legacyFunctionCall: LegacyFunctionCall | null = null;
          const activeToolSchema = toolSchema;
          const bufferTextOutput = activeToolSchema === 'text';
          const parseNonSsePayload = (raw: string) => {
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed?.output)) {
                iterationContent = extractTextFromResponsesResponse(parsed) || '';
                const reasoningText = extractReasoningFromResponsesResponse(parsed) || '';
                if (reasoningText) {
                  iterationReasoning = reasoningText;
                  emitReasoning(reasoningText, { kind: 'model', stage: 'stream' });
                }
                const outputToolCalls = extractToolCallsFromResponsesOutput(parsed.output);
                if (outputToolCalls.length > 0) {
                  messageToolCalls = outputToolCalls;
                }
                if (parsed?.usage) {
                  providerUsage = parsed.usage;
                  providerUsageSeen = true;
                  safeEnqueue({ type: 'usage', usage: parsed.usage });
                }
                return;
              }
              const message = parsed?.choices?.[0]?.message ?? {};
              const content = typeof message.content === 'string' ? message.content : '';
              if (content) {
                iterationContent = content;
              }
              const reasoningText =
                (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
                (typeof message.reasoning === 'string' && message.reasoning) ||
                (typeof message.analysis === 'string' && message.analysis) ||
                '';
              if (reasoningText) {
                iterationReasoning = reasoningText;
                emitReasoning(reasoningText, { kind: 'model', stage: 'stream' });
              }
              const nextToolCalls = extractToolCallsFromMessage(message);
              if (nextToolCalls.length > 0) {
                messageToolCalls = nextToolCalls;
              }
              if (parsed?.usage) {
                providerUsage = parsed.usage;
                providerUsageSeen = true;
                safeEnqueue({ type: 'usage', usage: parsed.usage });
              }
            } catch {
              // ignore invalid JSON
            }
          };

          let streamFinished = false;
          if (streamEnabled && reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              lastChunkAt = Date.now();
              idleWarned = false;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const normalized = line.replace(/\r$/, '');
                if (!normalized.startsWith('data: ')) continue;
                sawSse = true;
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

                if (typeof parsed?.type === 'string' && parsed.type.startsWith('response.')) {
                  if (firstChunkAt == null) firstChunkAt = Date.now();

                  if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
                    iterationContent += parsed.delta;
                    if (!bufferTextOutput) {
                      aiResponseContent += parsed.delta;
                      safeEnqueue({ type: 'content', content: parsed.delta });
                      contentAlreadySent = true;
                      await persistAssistantProgress();
                    }
                  } else if (
                    (parsed.type === 'response.reasoning_text.delta' || parsed.type === 'response.reasoning_summary_text.delta') &&
                    typeof parsed.delta === 'string'
                  ) {
                    if (!reasoningStartedAt) reasoningStartedAt = Date.now();
                    if (!iterationReasoningStartedAt) iterationReasoningStartedAt = Date.now();
                    iterationReasoning += parsed.delta;
                    emitReasoning(parsed.delta, { kind: 'model', stage: 'stream' });
                    await persistAssistantProgress();
                  } else if (
                    parsed.type === 'response.completed' ||
                    parsed.type === 'response.failed' ||
                    parsed.type === 'response.incomplete'
                  ) {
                    providerUsage = parsed.response?.usage ?? providerUsage;
                    if (providerUsage) {
                      providerUsageSeen = true;
                      safeEnqueue({ type: 'usage', usage: providerUsage });
                    }
                    streamFinished = true;
                    break;
                  }
                  appendResponsesToolCallEvent(toolCallBuffers.responses, parsed);
                  continue;
                }

                const choice = parsed.choices?.[0];
                if (!choice) continue;
                if (firstChunkAt == null) {
                  firstChunkAt = Date.now();
                }
                const delta = choice.delta ?? {};
                if (delta.reasoning_content) {
                  if (!reasoningStartedAt) reasoningStartedAt = Date.now();
                  if (!iterationReasoningStartedAt) iterationReasoningStartedAt = Date.now();
                  iterationReasoning += delta.reasoning_content;
                  emitReasoning(delta.reasoning_content, { kind: 'model', stage: 'stream' });
                  await persistAssistantProgress();
                }
                if (delta.content) {
                  iterationContent += delta.content;
                  if (!bufferTextOutput) {
                    aiResponseContent += delta.content;
                    safeEnqueue({ type: 'content', content: delta.content });
                    contentAlreadySent = true;
                    await persistAssistantProgress();
                  }
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const toolDelta of delta.tool_calls) {
                    appendOpenAIToolCallDelta(toolCallBuffers.openai, toolDelta);
                  }
                }
                const legacyDelta = delta.function_call;
                if (legacyDelta && typeof legacyDelta === 'object') {
                  legacyFunctionCall = appendLegacyFunctionCallDelta(legacyFunctionCall, legacyDelta);
                }
                if (choice.message && messageToolCalls.length === 0) {
                  const nextToolCalls = extractToolCallsFromMessage(choice.message);
                  if (nextToolCalls.length > 0) {
                    messageToolCalls = nextToolCalls;
                  }
                }
                if (parsed.usage) {
                  providerUsage = parsed.usage;
                  providerUsageSeen = true;
                  safeEnqueue({ type: 'usage', usage: parsed.usage });
                }
              }
              if (streamFinished) break;
            }
            await reader.cancel().catch(() => { });
          } else {
            const raw = await response.text().catch(() => '');
            parseNonSsePayload(raw.trim());
          }
          currentProviderController = null;
          setStreamController(null);

          if (streamEnabled && !sawSse) {
            parseNonSsePayload(buffer.trim());
          }

          const { toolCalls: effectiveToolCalls, textContent } = parseToolCalls({
            openaiToolCallBuffers: toolCallBuffers.openai,
            responsesToolCallBuffers: toolCallBuffers.responses,
            messageToolCalls,
            legacyFunctionCall,
            textContent: iterationContent,
            textProtocolEnabled: activeToolSchema === 'text',
            toolDefinitions,
            allowedToolNames,
          });
          const cleanedContent = typeof textContent === 'string' ? textContent : iterationContent;

          if (!contentAlreadySent && !bufferTextOutput && cleanedContent) {
            aiResponseContent += cleanedContent;
            safeEnqueue({ type: 'content', content: cleanedContent });
            contentAlreadySent = true;
            await persistAssistantProgress();
          }
          if (bufferTextOutput && effectiveToolCalls.length === 0 && cleanedContent) {
            aiResponseContent += cleanedContent;
            safeEnqueue({ type: 'content', content: cleanedContent });
            contentAlreadySent = true;
            await persistAssistantProgress();
          }

          if (iterationReasoning.trim()) {
            reasoningChunks.push(iterationReasoning.trim());
          }

          if (effectiveToolCalls.length > 0) {
            const reasoningPayload = iterationReasoning.trim();
            if (activeToolSchema === 'functions') {
              let isFirstToolCall = true;
              for (const toolCall of effectiveToolCalls) {
                const toolName = toolCall?.function?.name || '';
                const toolArguments = toolCall?.function?.arguments || '{}';
                workingMessages.push({
                  role: 'assistant',
                  content: isFirstToolCall ? cleanedContent : '',
                  function_call: {
                    name: toolName || 'unknown',
                    arguments: toolArguments,
                  },
                });
                isFirstToolCall = false;
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(toolArguments || '{}');
                } catch {
                  args = {};
                }
                let result = null as Awaited<ReturnType<typeof toolRegistry.handleToolCall>> | null;
                if (toolName && allowedToolNames.has(toolName)) {
                  result = await toolRegistry.handleToolCall(
                    toolName,
                    toolCall as ToolCall,
                    args,
                    {
                      sessionId,
                      emitReasoning,
                      sendToolEvent,
                    },
                  );
                }
                if (!result) {
                  sendUnsupportedToolError(toolName || 'unknown', toolCall.id, sendToolEvent);
                  result = buildUnsupportedToolResult(toolCall.id, toolName || 'unknown');
                }
                result = normalizeToolHandlerResult(result, toolCall.id);
                workingMessages.push({
                  role: 'function',
                  name: result.toolName,
                  content: result.message.content,
                });
              }
              continue;
            }

            if (activeToolSchema === 'text') {
              workingMessages.push({
                role: 'assistant',
                content: iterationContent,
              });
              for (const toolCall of effectiveToolCalls) {
                const toolName = toolCall?.function?.name || '';
                let result = null as Awaited<ReturnType<typeof toolRegistry.handleToolCall>> | null;
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(toolCall.function?.arguments ?? '{}');
                } catch {
                  args = {};
                }
                if (toolName && allowedToolNames.has(toolName)) {
                  result = await toolRegistry.handleToolCall(
                    toolName,
                    toolCall as ToolCall,
                    args,
                    {
                      sessionId,
                      emitReasoning,
                      sendToolEvent,
                    },
                  );
                }
                if (!result) {
                  sendUnsupportedToolError(toolName || 'unknown', toolCall.id, sendToolEvent);
                  result = buildUnsupportedToolResult(toolCall.id, toolName || 'unknown');
                }
                result = normalizeToolHandlerResult(result, toolCall.id);
                workingMessages.push(buildTextToolResultMessage({
                  toolName: result.toolName,
                  content: result.message.content,
                }));
              }
              continue;
            }

            workingMessages.push({
              role: 'assistant',
              content: cleanedContent,
              ...(reasoningPayload ? { reasoning_content: reasoningPayload } : {}),
              tool_calls: effectiveToolCalls,
            });

            for (const toolCall of effectiveToolCalls) {
              const toolName = toolCall?.function?.name || '';
              let result = null as Awaited<ReturnType<typeof toolRegistry.handleToolCall>> | null;
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function?.arguments ?? '{}');
              } catch {
                args = {};
              }
              if (toolName && allowedToolNames.has(toolName)) {
                result = await toolRegistry.handleToolCall(
                  toolName,
                  toolCall as ToolCall,
                  args,
                  {
                    sessionId,
                    emitReasoning,
                    sendToolEvent,
                  },
                );
              }
              if (!result) {
                sendUnsupportedToolError(toolName || 'unknown', toolCall.id, sendToolEvent);
                result = buildUnsupportedToolResult(toolCall.id, toolName || 'unknown');
              }
              result = normalizeToolHandlerResult(result, toolCall.id);
              workingMessages.push(result.message);
            }

            continue;
          }

          finalContent = cleanedContent.trim();
          if (!finalContent) {
            throw new Error('Model finished without producing a final answer');
          }

          if (iterationReasoningStartedAt && reasoningStartedAt) {
            reasoningDurationSeconds = Math.max(0, Math.round((Date.now() - reasoningStartedAt) / 1000));
          }

          finalUsageSnapshot = providerUsage;
          break;
        }

        if (checkCancelled()) {
          await persistAssistantProgress({ force: true, status: 'cancelled' });
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
        reasoningBuffer = reasoningText;
        if (reasoningText) {
          safeEnqueue({
            type: 'reasoning',
            done: true,
            duration: reasoningDurationSeconds,
            meta: { kind: 'model', stage: 'final' },
          });
        }

        let completionTokensFallback = 0;
        try {
          completionTokensFallback = await Tokenizer.countTokens(finalContent);
        } catch (error) {
          log.warn('Tokenizer countTokens failed in agent web search, fallback to 0', {
            sessionId,
            error: error instanceof Error ? error.message : error,
          });
          completionTokensFallback = 0;
        }
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
        traceMetadataExtras.finalUsage = finalUsagePayload;
        traceMetadataExtras.providerUsageSource = providerUsageValid ? 'provider' : 'fallback';

        const completedAt = Date.now();
        const firstTokenLatencyMs =
          firstChunkAt != null ? Math.max(0, firstChunkAt - startedAt) : null;
        const responseTimeMs = Math.max(0, completedAt - startedAt);
        const speedWindowMs = completedAt - (firstChunkAt ?? startedAt);
        const tokensPerSecond =
          finalUsageNumbers.completion > 0 && speedWindowMs > 0
            ? finalUsageNumbers.completion / (speedWindowMs / 1000)
            : null;

        let persistedAssistantMessageId: number | null = activeAssistantMessageId;
        try {
          const sessionStillExists = async () => {
            const count = await prisma.chatSession.count({ where: { id: sessionId } });
            return count > 0;
          };

          if (finalContent && (await sessionStillExists())) {
            const reasoningTrimmed = reasoningText.trim();
            const streamReasoningPayload = reasoningTrimmed.length > 0 ? reasoningTrimmed : null;
            const shouldPersistReasoning =
              reasoningEnabled && reasoningSaveToDb && reasoningTrimmed.length > 0;
            const providerHost = (() => {
              try {
                const u = new URL(baseUrl);
                return u.hostname;
              } catch {
                return null;
              }
            })();
            const finalToolLogsJson = toolLogs.length > 0 ? JSON.stringify(toolLogs) : null;
            const persistedId = await persistAssistantFinalResponse({
              sessionId,
              existingMessageId: activeAssistantMessageId,
              assistantClientMessageId,
              fallbackClientMessageId: clientMessageId,
              parentMessageId: userMessageRecord?.id ?? null,
              replyHistoryLimit: assistantReplyHistoryLimit,
              content: finalContent,
              streamReasoning: streamReasoningPayload,
              reasoning: shouldPersistReasoning ? reasoningText.trim() : null,
              reasoningDurationSeconds: shouldPersistReasoning ? reasoningDurationSeconds : null,
              streamError: null,
              toolLogsJson: finalToolLogsJson,
              usage: {
                promptTokens: finalUsageNumbers.prompt,
                completionTokens: finalUsageNumbers.completion,
                totalTokens: finalUsageNumbers.total,
                contextLimit,
              },
              metrics: {
                firstTokenLatencyMs,
                responseTimeMs,
                tokensPerSecond,
              },
              model: session.modelRawId,
              provider: providerHost ?? undefined,
            });
            if (persistedId) {
              persistedAssistantMessageId = persistedId;
              activeAssistantMessageId = persistedId;
              toolLogsDirty = false;
              if (streamMeta) {
                streamMeta.assistantMessageId = persistedId;
                persistStreamMeta(streamMeta);
              }
              traceRecorder.log('db:persist_final', {
                messageId: persistedId,
                length: finalContent.length,
                promptTokens: finalUsageNumbers.prompt,
                completionTokens: finalUsageNumbers.completion,
                totalTokens: finalUsageNumbers.total,
                source: 'agent_web_search',
              });
            }
          } else if (!finalContent) {
            log.warn('Agent response empty, skip persistence');
          } else {
            log.debug('Session missing when persisting agent response, skip insert', { sessionId });
          }
          traceStatus = 'completed';
          traceMetadataExtras.toolEvents = toolLogs.length;
          traceMetadataExtras.reasoningDurationSeconds = reasoningDurationSeconds;
        } catch (persistErr) {
          console.warn('Persist agent response failed', persistErr);
        }

        if (persistedAssistantMessageId) {
          traceRecorder.setMessageContext(
            persistedAssistantMessageId,
            assistantClientMessageId ?? clientMessageId,
          );
        }
      } catch (error: any) {
        if (checkCancelled()) {
          await persistAssistantProgress({ force: true, status: 'cancelled' });
          log.debug('Agent stream aborted after client cancellation', {
            sessionId,
            streamKey,
          });
          traceStatus = 'cancelled';
          traceRecorder.log('stream:cancelled', { sessionId, streamKey });
          return;
        }
        traceStatus = 'error';
        const parsedError = parseApiError(error);
        traceErrorMessage = getFriendlyErrorMessage(error);
        traceRecorder.log('stream:error', {
          message: traceErrorMessage,
          errorType: parsedError.type,
          originalMessage: parsedError.originalMessage,
        });
        log.error('Agent web search failed', error);
        safeEnqueue({
          type: 'error',
          error: traceErrorMessage,
          errorType: parsedError.type,
          suggestion: parsedError.suggestion,
        });
        const persistErrorStatus = async () => {
          const reasoningSnapshot = reasoningBuffer.trim().length ? reasoningBuffer.trim() : null;
          const payload = {
            content: aiResponseContent,
            streamCursor: aiResponseContent.length,
            streamStatus: 'error' as const,
            streamError: traceErrorMessage,
            streamReasoning: reasoningSnapshot,
          };
          try {
            if (activeAssistantMessageId) {
              await prisma.message.update({
                where: { id: activeAssistantMessageId },
                data: payload,
              });
              return;
            }
          } catch (persistError) {
            const isMissing =
              persistError instanceof Prisma.PrismaClientKnownRequestError &&
              persistError.code === 'P2025';
            if (!isMissing) {
              log.warn('Persist agent error status failed', {
                sessionId,
                error: persistError instanceof Error ? persistError.message : persistError,
              });
              return;
            }
          }
          try {
            await upsertAssistantMessageByClientId({
              sessionId,
              clientMessageId: assistantPlaceholderClientMessageId,
              data: payload,
            });
          } catch (persistError) {
            log.warn('Upsert agent error status failed', {
              sessionId,
              error: persistError instanceof Error ? persistError.message : persistError,
            });
          }
        };
        await persistErrorStatus();
        const agentError =
          error instanceof Error ? error : new Error(traceErrorMessage || 'Web search agent failed');
        if (agentError instanceof Error && traceErrorMessage) {
          (agentError as Error).message = traceErrorMessage;
        }
        (agentError as any).handled = 'agent_error';
        (agentError as any).status = error?.status ?? 500;
        throw agentError;
      } finally {
        try {
          controller.close();
        } catch { }
        if (idleWatchTimer) {
          clearInterval(idleWatchTimer);
          idleWatchTimer = null;
        }
        setStreamController(null);
        releaseStreamMetaHandle();
        const toolLogSummary = toolLogs.slice(0, 50).map((item) => ({
          id: item.id,
          tool: item.tool,
          stage: item.stage,
          query: item.query,
          hits: Array.isArray(item.hits) ? item.hits.length : undefined,
          summary: item.summary,
          error: item.error,
          createdAt: new Date(item.createdAt).toISOString(),
        }));
        const finalMetadata = {
          ...traceMetadataExtras,
          toolLogs: toolLogSummary,
          messageId: activeAssistantMessageId,
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

  return new Response(stream, { headers: sseHeaders });
};
