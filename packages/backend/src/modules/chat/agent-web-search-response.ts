import { randomUUID } from 'node:crypto';
import { Prisma, type ChatSession, type Connection } from '@prisma/client';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import { convertOpenAIReasoningPayload } from '../../utils/providers';
import { convertChatCompletionsRequestToResponses } from '../../utils/openai-responses';
import { Tokenizer } from '../../utils/tokenizer';
import { formatHitsForModel, runWebSearch, type WebSearchHit } from '../../utils/web-search';
import { runPythonSnippet } from '../../utils/python-runner';
import { serializeQuotaSnapshot } from '../../utils/quota';
import { truncateText } from '../../utils/parsers';
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
import {
  documentToolDefinitions,
  documentToolNames,
  DocumentToolHandler,
  formatDocumentToolReasoning,
} from './document-tools';
import {
  kbToolDefinitions,
  kbToolNames,
  KBToolHandler,
  formatKBToolReasoning,
} from './kb-tools';
import { KnowledgeBaseService } from '../../services/knowledge-base';
import type { RAGService } from '../../services/document/rag-service';
import { ToolLogManager } from './tool-log-manager';
import { StreamEventEmitter } from './stream-event-emitter';
import {
  type AgentWebSearchConfig,
  type AgentPythonToolConfig,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
} from './agent-tool-config';

// Re-export for backwards compatibility
export { AgentWebSearchConfig, AgentPythonToolConfig, buildAgentWebSearchConfig, buildAgentPythonToolConfig };

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
  agentMaxToolIterations: number;
  toolFlags: { webSearch: boolean; python: boolean; document?: boolean; knowledgeBase?: boolean };
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

      const handleWebSearchToolCall = async (
        toolCall: { id?: string; function?: { arguments?: string } },
        args: { query?: string; num_results?: number },
      ) => {
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
          return;
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
            scope: agentConfig.scope,
            includeSummary: agentConfig.includeSummary,
            includeRawContent: agentConfig.includeRawContent,
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
      };

      const handlePythonToolCall = async (
        toolCall: { id?: string; function?: { arguments?: string } },
        args: { code?: string; input?: string },
      ) => {
        const source = typeof args?.code === 'string' ? args.code : '';
        const stdin = typeof args?.input === 'string' ? args.input : undefined;
        const callId = toolCall.id || randomUUID();
        const reasoningMetaBase = { kind: 'tool', tool: 'python_runner', callId };
        if (!source.trim()) {
          const error = '模型未提供 Python code';
          emitReasoning(error, { ...reasoningMetaBase, stage: 'error' });
          sendToolEvent({
            id: callId,
            tool: 'python_runner',
            stage: 'error',
            error,
          });
          workingMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'python_runner',
            content: JSON.stringify({ error }),
          });
          return;
        }
        const preview = truncateText(source.replace(/\s+/g, ' '), 160);
        const baseDetails: Record<string, unknown> = {
          code: source,
        };
        if (stdin !== undefined) {
          baseDetails.input = stdin;
        }
        emitReasoning('执行 Python 代码', { ...reasoningMetaBase, stage: 'start', summary: preview });
        sendToolEvent({
          id: callId,
          tool: 'python_runner',
          stage: 'start',
          summary: preview,
          details: baseDetails,
        });
        try {
          const result = await runPythonSnippet({
            code: source,
            input: stdin,
            command: pythonToolConfig.command,
            args: pythonToolConfig.args,
            timeoutMs: pythonToolConfig.timeoutMs,
            maxOutputChars: pythonToolConfig.maxOutputChars,
            maxSourceChars: pythonToolConfig.maxSourceChars,
          });
          const resultPreview = truncateText(
            result.stdout.trim() || (result.stderr ? `stderr: ${result.stderr.trim()}` : 'Python 运行完成'),
            200,
          );
          emitReasoning('Python 执行完成，准备综合结果。', {
            ...reasoningMetaBase,
            stage: 'result',
            summary: resultPreview,
          });
          const resultDetails: Record<string, unknown> = {
            ...baseDetails,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
          };
          if (result.truncated) {
            resultDetails.truncated = true;
          }
          sendToolEvent({
            id: callId,
            tool: 'python_runner',
            stage: 'result',
            summary: resultPreview,
            details: resultDetails,
          });
          workingMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'python_runner',
            content: JSON.stringify({
              stdout: result.stdout,
              stderr: result.stderr,
              exit_code: result.exitCode,
              duration_ms: result.durationMs,
              truncated: result.truncated || undefined,
            }),
          });
        } catch (pythonError: any) {
          const message = pythonError?.message || 'Python 执行失败';
          emitReasoning(`Python 执行失败：${message}`, {
            ...reasoningMetaBase,
            stage: 'error',
          });
          sendToolEvent({
            id: callId,
            tool: 'python_runner',
            stage: 'error',
            error: message,
            details: baseDetails,
          });
          workingMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'python_runner',
            content: JSON.stringify({ error: message }),
          });
        }
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
      const toolDefinitions: any[] = [];
      const allowedToolNames = new Set<string>();
      if (toolFlags.webSearch) {
        allowedToolNames.add('web_search');
        toolDefinitions.push({
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
        });
      }
      if (toolFlags.python && pythonToolConfig.enabled) {
        allowedToolNames.add('python_runner');
        toolDefinitions.push({
          type: 'function',
          function: {
            name: 'python_runner',
            description:
              'Execute short Python 3 code snippets for calculations or data processing. Use print() to output the final answer.',
            parameters: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Python code to execute. Keep it concise and deterministic.',
                },
                input: {
                  type: 'string',
                  description: 'Optional standard input passed to the Python process.',
                },
              },
              required: ['code'],
            },
          },
        });
      }
      // 添加文档工具（如果启用且有 ragService）
      const documentToolHandler = ragService && toolFlags.document
        ? new DocumentToolHandler(ragService, sessionId)
        : null;
      if (documentToolHandler) {
        for (const toolDef of documentToolDefinitions) {
          allowedToolNames.add(toolDef.function.name);
          toolDefinitions.push(toolDef);
        }
      }
      // 添加知识库工具（如果启用知识库且有 ragService）
      const knowledgeBaseIds = params.knowledgeBaseIds || [];
      const kbToolHandler = ragService && toolFlags.knowledgeBase && knowledgeBaseIds.length > 0
        ? new KBToolHandler(new KnowledgeBaseService(prisma), ragService, knowledgeBaseIds)
        : null;
      if (kbToolHandler) {
        for (const toolDef of kbToolDefinitions) {
          allowedToolNames.add(toolDef.function.name);
          toolDefinitions.push(toolDef);
        }
      }
      if (toolDefinitions.length === 0) {
        throw new Error('Agent 工具未启用');
      }
      const maxIterations =
        agentMaxToolIterations > 0 ? agentMaxToolIterations : Number.POSITIVE_INFINITY;
      let currentProviderController: AbortController | null = null;

      const callProvider = async (messages: any[]) => {
        const chatBody = convertOpenAIReasoningPayload({
          ...requestData,
          stream: true,
          messages,
          tools: toolDefinitions,
          tool_choice: 'auto',
        });
        const body = provider === 'openai_responses'
          ? convertChatCompletionsRequestToResponses(chatBody)
          : chatBody

        let url = '';
        if (provider === 'openai') {
          url = `${baseUrl}/chat/completions`;
        } else if (provider === 'openai_responses') {
          url = `${baseUrl}/responses`;
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

        traceRecorder.log('agent:provider_request', {
          provider,
          model: session.modelRawId,
          url,
          headerKeys: Object.keys(headers || {}),
          authHeaderProvided: Object.keys(authHeader || {}).length > 0,
          extraHeaderKeys: Object.keys(extraHeaders || {}),
          toolsRequested: Array.isArray(body.tools) ? body.tools.map((t: any) => t?.function?.name || t?.type || 'unknown') : [],
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
          const responsesToolCallBuffers = new Map<
            string,
            { callId: string; name?: string; arguments: string; order: number }
          >();

          const aggregateToolCalls = () =>
            (responsesToolCallBuffers.size > 0
              ? Array.from(responsesToolCallBuffers.values())
                  .sort((a, b) => a.order - b.order)
                  .map((entry) => ({
                    id: entry.callId,
                    type: 'function',
                    function: {
                      name: entry.name || 'web_search',
                      arguments: entry.arguments || '{}',
                    },
                  }))
              : Array.from(toolCallBuffers.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([_, entry]) => ({
                    id: entry.id || randomUUID(),
                    type: entry.type || 'function',
                    function: {
                      name: entry.function.name || 'web_search',
                      arguments: entry.function.arguments || '{}',
                    },
                  })));

          let streamFinished = false;
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
                  aiResponseContent += parsed.delta;
                  safeEnqueue({ type: 'content', content: parsed.delta });
                  await persistAssistantProgress();
                } else if (
                  (parsed.type === 'response.reasoning_text.delta' || parsed.type === 'response.reasoning_summary_text.delta') &&
                  typeof parsed.delta === 'string'
                ) {
                  if (!reasoningStartedAt) reasoningStartedAt = Date.now();
                  if (!iterationReasoningStartedAt) iterationReasoningStartedAt = Date.now();
                  iterationReasoning += parsed.delta;
                  emitReasoning(parsed.delta, { kind: 'model', stage: 'stream' });
                  await persistAssistantProgress();
                } else if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
                  const item = parsed.item;
                  if (item?.type === 'function_call') {
                    const callId = typeof item.call_id === 'string' ? item.call_id : null;
                    if (callId) {
                      const existing = responsesToolCallBuffers.get(callId) || {
                        callId,
                        name: undefined,
                        arguments: '',
                        order: typeof parsed.output_index === 'number' ? parsed.output_index : responsesToolCallBuffers.size,
                      };
                      if (typeof item.name === 'string' && item.name) existing.name = item.name;
                      if (typeof item.arguments === 'string') existing.arguments = item.arguments || existing.arguments;
                      responsesToolCallBuffers.set(callId, existing);
                    }
                  }
                } else if (parsed.type === 'response.function_call_arguments.delta') {
                  const callId = typeof parsed.call_id === 'string' ? parsed.call_id : null;
                  const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
                  if (callId && delta) {
                    const existing = responsesToolCallBuffers.get(callId) || {
                      callId,
                      name: undefined,
                      arguments: '',
                      order: responsesToolCallBuffers.size,
                    };
                    existing.arguments = `${existing.arguments || ''}${delta}`;
                    responsesToolCallBuffers.set(callId, existing);
                  }
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
                aiResponseContent += delta.content;
                safeEnqueue({ type: 'content', content: delta.content });
                await persistAssistantProgress();
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
                    existing.function.arguments = `${existing.function.arguments || ''}${toolDelta.function.arguments
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
          await reader.cancel().catch(() => { });
          currentProviderController = null;
          setStreamController(null);

          const aggregatedToolCalls = aggregateToolCalls();

          if (iterationReasoning.trim()) {
            reasoningChunks.push(iterationReasoning.trim());
          }

          if (finishReason === 'tool_calls' && aggregatedToolCalls.length > 0) {
            const reasoningPayload = iterationReasoning.trim();
            workingMessages.push({
              role: 'assistant',
              content: iterationContent,
              ...(reasoningPayload ? { reasoning_content: reasoningPayload } : {}),
              tool_calls: aggregatedToolCalls,
            });

            for (const toolCall of aggregatedToolCalls) {
              const toolName = toolCall?.function?.name || 'web_search';
              if (!allowedToolNames.has(toolName)) {
                sendToolEvent({
                  id: toolCall.id || randomUUID(),
                  tool: toolName,
                  stage: 'error',
                  error: 'Unsupported tool requested by the model',
                });
                continue;
              }
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function?.arguments ?? '{}');
              } catch {
                args = {};
              }
              if (toolName === 'web_search') {
                await handleWebSearchToolCall(toolCall, args as { query?: string; num_results?: number });
              } else if (toolName === 'python_runner') {
                await handlePythonToolCall(toolCall, args as { code?: string; input?: string });
              } else if (documentToolNames.has(toolName) && documentToolHandler) {
                // 处理文档工具调用
                const callId = toolCall.id || randomUUID();
                const reasoningMeta = { kind: 'tool', tool: toolName, callId };

                emitReasoning(formatDocumentToolReasoning(toolName, args, 'start'), {
                  ...reasoningMeta,
                  stage: 'start',
                });
                sendToolEvent({
                  id: callId,
                  tool: toolName,
                  stage: 'start',
                  query: (args.query as string) || (args.page_number ? `第 ${args.page_number} 页` : undefined),
                });

                const result = await documentToolHandler.handleToolCall(toolName, args);

                if (result.success) {
                  emitReasoning(formatDocumentToolReasoning(toolName, args, 'result'), {
                    ...reasoningMeta,
                    stage: 'result',
                  });
                  sendToolEvent({
                    id: callId,
                    tool: toolName,
                    stage: 'result',
                    summary: JSON.stringify(result.result).slice(0, 200),
                  });
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify(result.result),
                  });
                } else {
                  emitReasoning(`文档工具失败：${result.error}`, {
                    ...reasoningMeta,
                    stage: 'error',
                  });
                  sendToolEvent({
                    id: callId,
                    tool: toolName,
                    stage: 'error',
                    error: result.error,
                  });
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify({ error: result.error }),
                  });
                }
              } else if (kbToolNames.has(toolName) && kbToolHandler) {
                // 处理知识库工具调用
                const callId = toolCall.id || randomUUID();
                const reasoningMeta = { kind: 'tool', tool: toolName, callId };

                emitReasoning(formatKBToolReasoning(toolName, args, 'start'), {
                  ...reasoningMeta,
                  stage: 'start',
                });
                sendToolEvent({
                  id: callId,
                  tool: toolName,
                  stage: 'start',
                  query: (args.query as string) || (args.kb_id ? `知识库 ${args.kb_id}` : undefined),
                });

                const result = await kbToolHandler.handleToolCall(toolName, args);

                if (result.success) {
                  emitReasoning(formatKBToolReasoning(toolName, args, 'result'), {
                    ...reasoningMeta,
                    stage: 'result',
                  });
                  sendToolEvent({
                    id: callId,
                    tool: toolName,
                    stage: 'result',
                    summary: JSON.stringify(result.result).slice(0, 200),
                  });
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify(result.result),
                  });
                } else {
                  emitReasoning(`知识库工具失败：${result.error}`, {
                    ...reasoningMeta,
                    stage: 'error',
                  });
                  sendToolEvent({
                    id: callId,
                    tool: toolName,
                    stage: 'error',
                    error: result.error,
                  });
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify({ error: result.error }),
                  });
                }
              } else {
                sendToolEvent({
                  id: toolCall.id || randomUUID(),
                  tool: toolName,
                  stage: 'error',
                  error: 'Unsupported tool requested by the model',
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
