import { randomUUID } from 'node:crypto';
import { Prisma, type ChatSession } from '@prisma/client';
import { shouldIgnoreReasoningMeta } from '@aichat/shared/strip-tool-progress-from-reasoning';
import { computeStreamMetrics } from '@aichat/shared/stream-metrics';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import { buildChatProviderRequest } from '../../utils/chat-provider';
import { adaptProviderResponse } from '../../utils/anthropic';
import { supportsSseStreaming } from '../../utils/providers';
import { Tokenizer } from '../../services/tokenizer/legacy-utils';
import { serializeQuotaSnapshot } from '../../services/quota/legacy-utils';
import { getFriendlyErrorMessage, parseApiError } from '../../utils/api-error-parser';
import type { UsageQuotaSnapshot } from '../../types';
import type { ExtensionInstallServiceLike } from '../extensions/types';
import { summarizeSsePayload } from '../../utils/task-trace';
import type { TaskTraceRecorder, TaskTraceStatus } from '../../utils/task-trace';
import { createToolWallTimer } from './agent-tool-wall-time';
import { ToolLogManager } from './tool-log-manager';
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
  shouldStopTools,
} from './stream-state';
import type { RAGService } from '../../services/document/rag-service';
import { enrichToolEventReasoningOffsets } from '@aichat/shared/tool-events';
import { normalizeToolCallEventPayload } from '../../agent-runtime/tool-call-event';
import {
  sendUnsupportedToolError,
  type PdfExportHandlerConfig,
  type DeepResearchPlanHandlerConfig,
  type ResearchPlanApprovalGate,
} from './tool-handlers';
import {
  registerResearchPlanApproval,
  waitForResearchPlanApproval,
  type ResearchPlanApprovalOutcome,
} from './research-plan-approval';
import { RESEARCH_PLAN_TOOL_NAME } from './research-plan-tool';
import {
  buildBlockedResearchToolResult,
  buildResearchPlanRequiredResult,
  buildResearchPlanTerminalChunk,
  createResearchPlanGateState,
  decideResearchToolBlock,
  markResearchPlanApproved,
  markResearchPlanRevised,
  markResearchPlanSubmitted,
  type ResearchPlanGateState,
} from './research-plan-flow';
import {
  type ToolSchema,
  buildSkippedToolSummary,
  buildToolRequest,
} from '../../agent-runtime/tool-protocol';
import {
  runToolOrchestration,
  type ToolOrchestrationStopReason,
} from '../../agent-runtime/tool-orchestrator';
import {
  buildAnswerOutcomeTracePayload,
  type AnswerOutcome,
} from '../../agent-runtime/answer-outcome';
import {
  addUsageNumbers,
  readUsageNumbers,
  type UsageNumbers,
} from '../../agent-runtime/usage-numbers';
import {
  createRetrievalEvidenceTally,
  evaluateRetrievalChain,
  isReadEvidenceRetained,
  parseRetrievalOutcome,
  recordWebSearchOutcome,
  tallyHasRetainedEvidence,
  type RetrievalEvidenceTally,
} from '../../agent-runtime/retrieval-outcome';
import { guardToolLoopMessages } from './services/tool-loop-context-guard';
import {
  extractMissingFunctionCallOutputId,
  pruneMissingToolCallReferences,
} from './services/tool-call-repair';
import {
  type AgentWebSearchConfig,
  type AgentPythonToolConfig,
  type AgentUrlReaderConfig,
  type AgentWorkspaceToolConfig,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
  buildAgentWorkspaceToolConfig,
} from '../../agent-runtime/agent-tool-config';
import type { ProviderType } from '../../utils/providers';
import { resolveModelCapabilitiesForSession } from '../../utils/model-capabilities';
import { createSkillRegistry } from '../skills/skill-registry';
import type { RequestedSkillsPayload } from '../skills/types';
import type { McpService } from '../../services/mcp/mcp-service';
import type { ResolvedConnection } from '../../repositories/model-resolver-repository';
/**
 * 本次运行的收尾结果。
 * - 停止工具 / 预算收尾：带 stopReason
 * - 上游未交付（内容过滤 / 拒答 / 已知固定话术）：只带 finalAnswerGenerated=false，不冒充取消或成功
 */
/**
 * 本次运行的收尾结果：随工具日志信封落库（runResult），并驱动 SSE 的终态字段。
 *
 * stopReason 只接受对外原因 stop_tools / budget_exhausted（前端按它们出终态文案）。
 * 内部收尾（例如来源提前用尽）不进这里，只体现在追踪事件 agent:retrieval_chain_ended。
 */
type PersistedRunResult = {
  stopReason?: ToolOrchestrationStopReason;
  finalAnswerGenerated: boolean;
};

// Re-export for backwards compatibility
export {
  AgentWebSearchConfig,
  AgentPythonToolConfig,
  AgentUrlReaderConfig,
  AgentWorkspaceToolConfig,
  buildAgentWebSearchConfig,
  buildAgentPythonToolConfig,
  buildAgentUrlReaderConfig,
  buildAgentWorkspaceToolConfig,
};

type ChatSessionWithConnection = ChatSession & { connection: ResolvedConnection | null };

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
  workspaceToolConfig: AgentWorkspaceToolConfig;
  agentMaxToolIterations: number;
  allowDynamicRuntime?: boolean;
  pdfExportConfig?: PdfExportHandlerConfig | null;
  toolFlags: {
    webSearch: boolean;
    python: boolean;
    urlReader?: boolean;
    document?: boolean;
    knowledgeBase?: boolean;
    workspace?: boolean;
    pdfExport?: boolean;
    deepResearch?: boolean;
    extensionInstall?: boolean;
  };
  requestedSkills: RequestedSkillsPayload;
  knowledgeBaseIds?: number[];
  provider: string;
  baseUrl: string;
  authHeader: Record<string, string>;
  extraHeaders: Record<string, string>;
  reasoningEnabled: boolean;
  reasoningSaveToDb: boolean;
  clientMessageId?: string | null;
  actorIdentifier: string;
  actorUserId?: number | null;
  requestSignal?: AbortSignal;
  assistantMessageId: number | null;
  assistantClientMessageId?: string | null;
  streamProgressPersistIntervalMs: number;
  traceRecorder: TaskTraceRecorder;
  idleTimeoutMs: number;
  maxConcurrentStreams: number;
  concurrencyErrorMessage: string;
  ragService?: RAGService | null;
  mcpService?: McpService;
  extensionInstallService?: ExtensionInstallServiceLike;
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
    workspaceToolConfig,
    agentMaxToolIterations,
    allowDynamicRuntime,
    pdfExportConfig,
    toolFlags,
    requestedSkills,
    provider,
    baseUrl,
    authHeader,
    extraHeaders,
    reasoningEnabled,
    reasoningSaveToDb,
    clientMessageId,
    actorIdentifier,
    actorUserId,
    requestSignal,
    assistantMessageId,
    assistantClientMessageId,
    streamProgressPersistIntervalMs,
    traceRecorder,
    idleTimeoutMs,
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
    engines: agentConfig.engines,
    model: session.modelRawId,
    tools: {
      web_search: toolFlags.webSearch,
      python_runner: toolFlags.python,
      url_reader: Boolean(toolFlags.urlReader),
      workspace_tools: Boolean(toolFlags.workspace),
      document_tools: Boolean(toolFlags.document),
      knowledge_base_tools: Boolean(toolFlags.knowledgeBase),
      export_pdf: Boolean(toolFlags.pdfExport),
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
      let assistantProgressPersistChain: Promise<void> = Promise.resolve();
      const idleTimeout = idleTimeoutMs > 0 ? idleTimeoutMs : null;
      let idleWatchTimer: ReturnType<typeof setInterval> | null = null;
      let lastChunkAt = Date.now();
      let idleWarned = false;
      const startedAt = Date.now();
      let firstChunkAt: number | null = null;

      // 工具台账唯一写入点：身份 / 来源 / 父子 / 时间字段的映射与合并由 manager 负责，
      // 本文件只负责把已归一化的工具事件送进去（SSE 载荷保持不变）。
      const toolLogManager = new ToolLogManager({
        sessionId,
        onLogDirty: () => {
          // 立即异步持久化工具事件，刷新页面也能看到最新工具日志
          persistAssistantProgress({ includeReasoning: false }).catch(() => { });
        },
      });

      const persistAssistantProgress = async (
        options: {
          force?: boolean
          includeReasoning?: boolean
          status?: 'streaming' | 'done' | 'error' | 'cancelled'
          errorMessage?: string | null
          /** 只在最终持久化时传入，保证 runResult 不会被后续进度写覆盖 */
          runResult?: PersistedRunResult
        } = {},
      ) => {
        if (!activeAssistantMessageId) return;
        const force = options.force === true;
        const includeReasoning = options.includeReasoning !== false;
        const currentReasoning =
          includeReasoning && reasoningBuffer.trim().length ? reasoningBuffer : null;
        const hasToolLogDelta = toolLogManager.isDirty();
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
        const shouldPersistToolLogs = toolLogManager.isDirty() || force;
        const toolLogsJson = shouldPersistToolLogs
          ? toolLogManager.toJson(options.runResult ? { runResult: options.runResult } : undefined)
          : undefined;
        const updateData: Prisma.MessageUpdateInput = {
          content: aiResponseContent,
          streamCursor: aiResponseContent.length,
          streamStatus,
          streamReasoning: reasoningPayload,
        };
        if (toolLogsJson !== undefined) {
          updateData.toolLogsJson = toolLogsJson;
          // 同步清脏，避免 fire-and-forget 期间新工具事件被旧写回覆盖清脏
          toolLogManager.markClean();
        }
        const messageIdForPersist = activeAssistantMessageId;
        const contentLength = aiResponseContent.length;
        const reasoningLength = reasoningPayload?.length ?? 0;
        const toolLogsCount = toolLogsJson ? toolLogManager.getLogs().length : 0;
        const runPersist = async () => {
          await prisma.message.update({
            where: { id: messageIdForPersist },
            data: updateData,
          });
          traceRecorder.log('db:persist_progress', {
            messageId: messageIdForPersist,
            length: contentLength,
            reasoningLength,
            force,
            toolLogsPersisted: toolLogsCount,
            toolLogsPending: 0,
          });
        };
        try {
          const queued = assistantProgressPersistChain.then(runPersist, runPersist);
          assistantProgressPersistChain = queued.catch((error) => {
            traceRecorder.log('db:persist_progress_error', {
              messageId: messageIdForPersist,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          // 流式增量不阻塞调用方；force 等待串行队列，避免旧快照覆盖终态
          if (force) {
            await queued;
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
                toolLogManager.markClean();
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
                toolLogsPersisted: toolLogsJson ? toolLogManager.getLogs().length : 0,
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

      const resolveToolLogLookupId = (payload: Record<string, unknown>) => {
        if (typeof payload.id === 'string' && payload.id.trim()) {
          return (payload.id as string).trim();
        }
        if (typeof payload.callId === 'string' && payload.callId.trim()) {
          return (payload.callId as string).trim();
        }
        return null;
      };

      const recordToolLog = (payload: Record<string, unknown>) => {
        toolLogManager.record(payload);
        traceRecorder.log('tool:event_buffer', {
          messageId: activeAssistantMessageId ?? null,
          tool: typeof payload.tool === 'string' ? payload.tool : null,
          stage: typeof payload.stage === 'string' ? payload.stage : null,
          totalBuffered: toolLogManager.getLogs().length,
        });
      };

      const sendToolEvent = (payload: Record<string, unknown>) => {
        const normalized = normalizeToolCallEventPayload(payload);
        const lookupId = resolveToolLogLookupId(normalized);
        const isFirstSight = lookupId
          ? toolLogManager.getLogs().findIndex((log) => log.id === lookupId) === -1
          : true;
        const enriched = enrichToolEventReasoningOffsets(
          normalized,
          reasoningBuffer.length,
          isFirstSight,
        );
        safeEnqueue(enriched);
        recordToolLog(enriched);
        traceRecorder.log('tool:event', summarizeSsePayload(enriched));
      };

      const sendStreamEvent = (payload: Record<string, unknown>) => {
        safeEnqueue(payload);
        traceRecorder.log('skill:event', summarizeSsePayload(payload));
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
        if (!text || shouldIgnoreReasoningMeta(meta)) return;
        reasoningBuffer += text;
      };

      const emitReasoning = (content: string, meta?: Record<string, unknown>) => {
        if (shouldIgnoreReasoningMeta(meta)) return;
        const text = typeof content === 'string' ? content : '';
        // Preserve provider delta exactly (including newlines/leading spaces)
        // to keep streaming CoT layout consistent with persisted rendering.
        if (text.length === 0) return;
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
      const modelCapabilities = await resolveModelCapabilitiesForSession(prisma, session);
      const knowledgeBaseIds = params.knowledgeBaseIds || [];
      const deepResearchRequested = toolFlags.deepResearch === true;
      const deepResearchPlanRequired = deepResearchRequested && toolFlags.webSearch === true;
      const researchPlanApprovalTimeoutMs = 5 * 60_000;
      const researchPlanGate: ResearchPlanGateState = createResearchPlanGateState();
      const researchPlanApprovalGate: ResearchPlanApprovalGate = {
        waitForDecision: async ({ toolCallId, revision }) => {
          markResearchPlanSubmitted(researchPlanGate);
          const entry = registerResearchPlanApproval({
            sessionId,
            actorId: actorIdentifier,
            kind: 'plan',
            toolCallId,
            messageId: activeAssistantMessageId,
            clientMessageId: streamMeta?.clientMessageId ?? null,
            assistantClientMessageId: streamMeta?.assistantClientMessageId ?? null,
            revision,
          });
          const outcome: ResearchPlanApprovalOutcome = await waitForResearchPlanApproval(
            entry,
            {
              timeoutMs: researchPlanApprovalTimeoutMs,
              signal: requestSignal ?? undefined,
            },
          );
          if (outcome.decision === 'approve') {
            markResearchPlanApproved(researchPlanGate);
            return { decision: 'approve', revision: researchPlanGate.revision };
          }
          if (outcome.decision === 'adjust') {
            const nextRevision = Math.min(2, researchPlanGate.revision + 1);
            markResearchPlanRevised(researchPlanGate, nextRevision);
            return {
              decision: 'adjust',
              feedback: outcome.feedback,
              revision: nextRevision,
            };
          }
          if (outcome.decision === 'continue') {
            markResearchPlanApproved(researchPlanGate);
            return { decision: 'approve', revision: researchPlanGate.revision };
          }
          return {
            decision: outcome.decision === 'expired' ? 'expired' : 'cancel',
            revision: researchPlanGate.revision,
          };
        },
      };
      const deepResearchPlanConfig: DeepResearchPlanHandlerConfig | null =
        deepResearchPlanRequired
          ? {
              enabled: true,
              approvalGate: researchPlanApprovalGate,
              approvalTimeoutMs: researchPlanApprovalTimeoutMs,
              resolveRevision: () => researchPlanGate.revision,
            }
          : null;
      const toolRegistry = await createSkillRegistry({
        requestedSkills,
        sessionId,
        actorUserId,
        builtins: {
          // 自动阅读复用完整 url reader 配置，避免自动路径落回读取器默认值
          webSearch: toolFlags.webSearch ? { ...agentConfig, urlReader: urlReaderConfig } : null,
          python: toolFlags.python ? pythonToolConfig : null,
          urlReader: toolFlags.urlReader ? {
            enableDeepseekFallback: urlReaderConfig.enableDeepseekFallback,
            deepseekApiKey: urlReaderConfig.deepseekApiKey,
            enabled: true,
            timeout: urlReaderConfig.timeout,
            maxContentLength: urlReaderConfig.maxContentLength,
            maxBodyBytes: urlReaderConfig.maxBodyBytes,
            enableBrowser: urlReaderConfig.enableBrowser,
            browserExecutablePath: urlReaderConfig.browserExecutablePath,
            renderWaitMs: urlReaderConfig.renderWaitMs,
          } : null,
          workspace: toolFlags.workspace ? {
            enabled: true,
            listMaxEntries: workspaceToolConfig.listMaxEntries,
            readMaxChars: workspaceToolConfig.readMaxChars,
            gitCloneTimeoutMs: workspaceToolConfig.gitCloneTimeoutMs,
          } : null,
          document: ragService && toolFlags.document
            ? { enabled: true, sessionId, ragService }
            : null,
          knowledgeBase: ragService && toolFlags.knowledgeBase
            ? { enabled: true, knowledgeBaseIds, ragService }
            : null,
          pdfExport: toolFlags.pdfExport && pdfExportConfig
            ? pdfExportConfig
            : null,
          deepResearchPlan: deepResearchPlanConfig,
          extensionInstall: toolFlags.extensionInstall && params.extensionInstallService
            ? { enabled: true, service: params.extensionInstallService }
            : null,
        },
        allowDynamicRuntime: allowDynamicRuntime === true,
        mcpService: params.mcpService,
      });
      const toolDefinitions = toolRegistry.getToolDefinitions();
      const allowedToolNames = toolRegistry.getAllowedToolNames();
      if (toolDefinitions.length === 0) {
        throw new Error('Agent 工具未启用');
      }
      const maxIterations =
        agentMaxToolIterations > 0 ? agentMaxToolIterations : Number.POSITIVE_INFINITY;
      let currentProviderController: AbortController | null = null;
      const streamEnabled = supportsSseStreaming(provider);

      const callProvider = async (
        messages: any[],
        schema: ToolSchema,
        iteration: number,
        toolsEnabled = true,
      ) => {
        const { body: chatBody, messages: preparedMessages, textPromptAdded } = buildToolRequest({
          requestData,
          messages,
          toolDefinitions: toolsEnabled ? toolDefinitions : [],
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
          stream: streamEnabled,
        });

        const headers = {
          'Content-Type': 'application/json',
          ...authHeader,
          ...extraHeaders,
        };

        const providerInput = provider === 'openai_responses' ? body.input : body.messages;
        const countImages = (blocks: unknown): number => Array.isArray(blocks)
          ? blocks.reduce((count, part) => {
              if (part?.type === 'input_image' || part?.type === 'image_url' || part?.type === 'image') return count + 1;
              return count + (part?.type === 'tool_result' ? countImages(part.content) : 0);
            }, 0)
          : 0;
        const imagePartCount = Array.isArray(providerInput)
          ? providerInput.reduce((count, item) => count + countImages(
              item?.type === 'function_call_output' ? item.output : item?.content,
            ), 0)
          : 0;
        traceRecorder.log('agent:provider_request', {
          provider,
          imagePartCount,
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
          iteration,
          toolsEnabled,
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
          return await adaptProviderResponse(response, provider, streamEnabled);
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
      let contextLengthRetryCount = 0;
      let missingToolCallRetryCount = 0;

      // 逐轮用量快照：同一轮的多份 usage 只保留最后一份，绝不重复相加
      type UsageRoundSnapshot = {
        iteration: number;
        attempt: number;
        toolsEnabled: boolean;
        numbers: UsageNumbers;
      };
      const usageRounds = new Map<string, UsageRoundSnapshot>();
      const usageRoundOrder: string[] = [];
      let usageRoundsEmitted = 0;
      let firstVisibleContent: {
        elapsedMs: number;
        length: number;
        iteration: number;
        toolsEnabled: boolean;
      } | null = null;
      let currentTurnContext = { iteration: 0, toolsEnabled: true };
      const toolWallTimer = createToolWallTimer();
      const retrievalTally: RetrievalEvidenceTally = createRetrievalEvidenceTally();
      let otherToolEvidenceCount = 0;

      const emitUsageRound = (key: string) => {
        const snapshot = usageRounds.get(key);
        if (!snapshot) return;
        traceRecorder.log('agent:provider_usage', {
          iteration: snapshot.iteration,
          attempt: snapshot.attempt,
          toolsEnabled: snapshot.toolsEnabled,
          prompt: snapshot.numbers.prompt,
          completion: snapshot.numbers.completion,
          total: snapshot.numbers.total,
          cacheHitTokens: snapshot.numbers.cacheHit,
          cacheMissTokens: snapshot.numbers.cacheMiss,
          source: 'provider',
        });
      };

      /** 把一个已结算的轮次顺序写出；重复调用只补未写出的部分 */
      const flushUsageRounds = () => {
        while (usageRoundsEmitted < usageRoundOrder.length) {
          emitUsageRound(usageRoundOrder[usageRoundsEmitted]);
          usageRoundsEmitted += 1;
        }
      };

      const usageTotals = (): UsageNumbers | null => {
        let totals: UsageNumbers | null = null;
        for (const key of usageRoundOrder) {
          const snapshot = usageRounds.get(key);
          if (!snapshot) continue;
          totals = addUsageNumbers(totals, snapshot.numbers);
        }
        return totals;
      };

      const hasRetainedEvidence = () =>
        tallyHasRetainedEvidence(retrievalTally) || otherToolEvidenceCount > 0;

      const readToolContent = (result: any): string | null => {
        const content = result?.message?.content;
        if (typeof content === 'string') return content;
        if (content && typeof content === 'object') {
          try {
            return JSON.stringify(content);
          } catch {
            return null;
          }
        }
        return null;
      };

      /** 工具结果只用于判断「是否留有可用证据」，不改写任何内容 */
      const noteToolEvidence = (toolName: string, result: any, iteration?: number) => {
        const content = readToolContent(result);
        if (!content || !content.trim()) return;
        // 检索侧结果（web_search，以及 read_url 的失败/取消）都带 retrievalOutcome：
        // 按工具轮归组结算，read_url 失败不会被误算成拿到证据。
        if (parseRetrievalOutcome(content)) {
          recordWebSearchOutcome(retrievalTally, content, iteration);
          return;
        }
        // read_url 成功：正文 + 「## 检索摘要」尾块，只按计数判定
        if (isReadEvidenceRetained(content)) {
          otherToolEvidenceCount += 1;
          return;
        }
        if (toolName === 'read_url') return;
        const trimmed = content.trim();
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && 'error' in parsed) return;
          } catch {
            // 非 JSON 正文按原文证据处理
          }
        }
        otherToolEvidenceCount += 1;
      };

      /**
       * 非流式 provider 不逐个 delta 推送正文：终态 turn 的正文要补进已产出内容，
       * 否则未交付的原结果会凭空消失。流式路径已有正文时不做重复追加。
       */
      const ensureTerminalContentVisible = (content: string) => {
        if (!content) return;
        if (aiResponseContent === content) return;
        if (aiResponseContent.trim().length > 0) return;
        aiResponseContent = content;
        safeEnqueue({ type: 'content', content });
      };

      const handleResearchPlanTermination = async (
        code: 'research_plan_cancelled' | 'research_plan_expired',
      ): Promise<void> => {
        const terminalChunk = buildResearchPlanTerminalChunk(code);
        aiResponseContent = terminalChunk.content;
        safeEnqueue({
          type: 'complete',
          content: terminalChunk.content,
          streamStatus: terminalChunk.streamStatus,
        });
        await persistAssistantProgress({ force: true, status: 'cancelled' });
        traceStatus = 'cancelled';
        traceRecorder.log('deep_research:plan_terminated', { code, sessionId });
      };

      /**
       * 未交付终态：停止工具 / 预算收尾 / 上游未交付。
       * 保留已产出的内容与终态，明确反馈「未生成最终回答」，
       * 绝不伪造模型回答，也不写 error 状态或取消状态。
       */
      const finishWithoutFinalAnswer = async (
        runResult: PersistedRunResult | null,
        answerOutcome?: AnswerOutcome | null,
      ): Promise<void> => {
        const partialContent = aiResponseContent;
        await persistAssistantProgress({
          force: true,
          status: 'done',
          runResult: runResult ?? undefined,
        });
        flushUsageRounds();
        safeEnqueue({
          type: 'complete',
          content: partialContent,
          ...(runResult?.stopReason ? { stopReason: runResult.stopReason } : {}),
          finalAnswerGenerated: false,
        });
        traceStatus = 'completed';
        traceMetadataExtras.stopReason = runResult?.stopReason ?? null;
        traceMetadataExtras.finalAnswerGenerated = false;
        if (answerOutcome) {
          traceRecorder.log('agent:answer_outcome', {
            ...buildAnswerOutcomeTracePayload(answerOutcome),
            finalAnswerGenerated: false,
            stopReason: runResult?.stopReason ?? null,
            retrievalRounds: retrievalTally.rounds,
            retrievalEvidenceRounds: retrievalTally.evidenceRounds,
          });
        }
        traceRecorder.log('agent:stopped_without_answer', {
          sessionId,
          stopReason: runResult?.stopReason ?? null,
          contentLength: partialContent.length,
        });
      };

      const waitForNoSearchChoice = async (
        callId: string,
      ): Promise<ResearchPlanApprovalOutcome> => {
        const expiresAt = Date.now() + researchPlanApprovalTimeoutMs;
        sendToolEvent({
          id: callId,
          tool: RESEARCH_PLAN_TOOL_NAME,
          stage: 'start',
          status: 'pending',
          phase: 'pending_approval',
          summary: '联网搜索不可用，是否基于已有知识继续？',
          details: {
            approval: { kind: 'search_unavailable', expiresAt },
          },
        });
        const entry = registerResearchPlanApproval({
          sessionId,
          actorId: actorIdentifier,
          kind: 'search_unavailable',
          toolCallId: callId,
          messageId: activeAssistantMessageId,
          clientMessageId: streamMeta?.clientMessageId ?? null,
          assistantClientMessageId: streamMeta?.assistantClientMessageId ?? null,
          revision: 0,
        });
        return waitForResearchPlanApproval(entry, {
          timeoutMs: researchPlanApprovalTimeoutMs,
          signal: requestSignal ?? undefined,
        });
      };

      if (deepResearchRequested && !toolFlags.webSearch) {
        const choiceCallId = `research-choice:${randomUUID()}`;
        const choice = await waitForNoSearchChoice(choiceCallId);
        if (choice.decision === 'continue') {
          sendToolEvent({
            id: choiceCallId,
            tool: RESEARCH_PLAN_TOOL_NAME,
            stage: 'result',
            status: 'success',
            phase: 'result',
            summary: '已选择基于已有知识继续',
            details: {
              approval: { kind: 'search_unavailable', decision: 'continue' },
            },
          });
        } else {
          const decision = choice.decision === 'expired' ? 'expired' : 'cancel';
          sendToolEvent({
            id: choiceCallId,
            tool: RESEARCH_PLAN_TOOL_NAME,
            stage: 'error',
            status: decision === 'expired' ? 'aborted' : 'rejected',
            phase: decision === 'expired' ? 'aborted' : 'rejected',
            summary: decision === 'expired' ? '研究计划已过期' : '深度研究已取消',
            error: decision === 'expired' ? '研究计划已过期' : '深度研究已取消',
            details: {
              approval: { kind: 'search_unavailable', decision },
            },
          });
          await handleResearchPlanTermination(
            decision === 'expired'
              ? 'research_plan_expired'
              : 'research_plan_cancelled',
          );
          return;
        }
      }

      try {
        const orchestration = await runToolOrchestration({
          provider,
          requestData,
          initialMessages: workingMessages,
          toolDefinitions,
          allowedToolNames,
          maxIterations,
          stream: streamEnabled,
          includeReasoningInToolMessage: true,
          emptyContentErrorMessage: 'Model finished without producing a final answer',
          // 停止工具 / 预算耗尽后最多一轮无工具收尾，让模型基于已有结果作答
          onBudgetExhausted: 'finish',
          // 没有留存检索证据时不再花一轮收尾：预算收尾只服务「有证据可答」的情况
          hasRetainedEvidence,
          // 纯检索链明确用尽（来源冷却 / 无可用引擎 / 连续全失败）：不再重复派发检索
          shouldEndToolChain: ({ toolNames }) => {
            const cause = evaluateRetrievalChain(
              retrievalTally,
              currentTurnContext.iteration,
              toolNames,
            );
            if (!cause) return null;
            traceRecorder.log('agent:retrieval_chain_ended', {
              cause,
              iteration: currentTurnContext.iteration,
              retrievalRounds: retrievalTally.rounds,
              retrievalEvidenceRounds: retrievalTally.evidenceRounds,
              consecutiveNoProgressRounds: retrievalTally.consecutiveNoProgressRounds,
              lastStatus: retrievalTally.lastStatus,
              lastReason: retrievalTally.lastReason,
            });
            return { cause };
          },
          shouldStopTools: () => shouldStopTools(streamMeta),
          checkAbort: () => {
            if (checkCancelled()) {
              throw new Error('Agent stream cancelled by client');
            }
          },
          onSchemaFallback: (schema) => {
            traceRecorder.log('agent:tool_schema_fallback', {
              provider,
              model: session.modelRawId,
              schema,
            });
          },
          onStreamChunk: () => {
            lastChunkAt = Date.now();
            idleWarned = false;
          },
          onFirstResponseEvent: () => {
            if (firstChunkAt == null) {
              firstChunkAt = Date.now();
            }
          },
          onContentDelta: async (delta) => {
            aiResponseContent += delta;
            if (!firstVisibleContent && delta.length > 0) {
              // 只记时间与长度，不记正文
              firstVisibleContent = {
                elapsedMs: Date.now() - startedAt,
                length: delta.length,
                iteration: currentTurnContext.iteration,
                toolsEnabled: currentTurnContext.toolsEnabled,
              };
              traceRecorder.log('agent:first_visible_content', firstVisibleContent);
            }
            safeEnqueue({ type: 'content', content: delta });
            await persistAssistantProgress();
          },
          onReasoningDelta: async (delta) => {
            if (!reasoningStartedAt) {
              reasoningStartedAt = Date.now();
            }
            emitReasoning(delta, { kind: 'model', stage: 'stream' });
            await persistAssistantProgress();
          },
          onUsage: (usage, context) => {
            providerUsageSeen = true;
            safeEnqueue({ type: 'usage', usage });
            const numbers = readUsageNumbers(usage);
            // provider 未返回用量：不写事件、不计入累计（与显式 0 区分）
            if (!numbers) return;
            const key = `${context.iteration}:${context.attempt}`;
            const isNewRound = !usageRounds.has(key);
            if (isNewRound) {
              // 新轮开始即结算上一轮，保证每轮只写一条事件
              flushUsageRounds();
              usageRoundOrder.push(key);
            }
            usageRounds.set(key, {
              iteration: context.iteration,
              attempt: context.attempt,
              toolsEnabled: context.toolsEnabled,
              numbers,
            });
          },
          requestTurn: async ({ schema, messages, iteration, toolsEnabled }) => {
            currentTurnContext = { iteration, toolsEnabled };
            const guardResult = await guardToolLoopMessages({
              messages,
              contextLimit,
              mode: 'normal',
            });
            if (guardResult.changed) {
              messages.splice(0, messages.length, ...guardResult.messages);
              traceRecorder.log('agent:tool_context_guard', {
                mode: 'normal',
                iteration,
                beforeTokens: guardResult.beforeTokens,
                afterTokens: guardResult.afterTokens,
                targetTokens: guardResult.targetTokens,
                messageCount: messages.length,
              });
            }
            const response = await callProvider(messages, schema, iteration, toolsEnabled);
            return {
              response,
              onDone: () => {
                currentProviderController = null;
                setStreamController(null);
              },
            };
          },
          onOptionalImageRetry: (details) => {
            traceRecorder.log('agent:optional_image_retry', details);
          },
          onTurnError: async ({ error, iteration, messages }) => {
            const missingToolCallId = extractMissingFunctionCallOutputId(error);
            if (missingToolCallId) {
              if (missingToolCallRetryCount >= 1) {
                return false;
              }
              const repairResult = pruneMissingToolCallReferences(messages, missingToolCallId);
              if (repairResult.changed) {
                missingToolCallRetryCount += 1;
                traceRecorder.log('agent:tool_call_repair_retry', {
                  iteration,
                  retryCount: missingToolCallRetryCount,
                  callId: missingToolCallId,
                  removedAssistantCalls: repairResult.removedAssistantCalls,
                  removedToolMessages: repairResult.removedToolMessages,
                  messageCount: messages.length,
                });
                return true;
              }
            }
            const parsed = parseApiError(error);
            if (parsed.type !== 'context_length') {
              return false;
            }
            if (contextLengthRetryCount >= 1) {
              return false;
            }
            const guardResult = await guardToolLoopMessages({
              messages,
              contextLimit,
              mode: 'aggressive',
            });
            if (!guardResult.changed) {
              return false;
            }
            contextLengthRetryCount += 1;
            messages.splice(0, messages.length, ...guardResult.messages);
            traceRecorder.log('agent:tool_context_guard_retry', {
              mode: 'aggressive',
              iteration,
              retryCount: contextLengthRetryCount,
              beforeTokens: guardResult.beforeTokens,
              afterTokens: guardResult.afterTokens,
              targetTokens: guardResult.targetTokens,
              reason: parsed.message,
            });
            return true;
          },
          handleToolCall: async (toolName, toolCall, args, iteration) => {
            if (!toolName || !allowedToolNames.has(toolName)) return null;
            const toolCallId =
              (toolCall?.id && typeof toolCall.id === 'string' && toolCall.id.trim()) ||
              `session:${sessionId}:tool:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
            if (deepResearchPlanRequired && toolName !== RESEARCH_PLAN_TOOL_NAME) {
              const blockDecision = decideResearchToolBlock(
                researchPlanGate,
                toolName,
                typeof iteration === 'number' ? iteration : 0,
              );
              if (blockDecision.block) {
                const message = '深度研究计划尚未确认，不能执行其它工具。请先调用 research_plan 提交计划。';
                sendToolEvent({
                  id: toolCallId,
                  tool: toolName,
                  stage: 'error',
                  status: 'error',
                  phase: 'error',
                  error: message,
                });
                return blockDecision.terminal
                  ? buildResearchPlanRequiredResult(toolCall, toolName)
                  : buildBlockedResearchToolResult(toolCall, toolName, message);
              }
            }
            const finishTiming = toolWallTimer.start();
            const toolResult = await toolRegistry.handleToolCall(
              toolName,
              toolCall,
              args,
              {
                sessionId,
                actorIdentifier,
                actorUserId: actorUserId ?? null,
                messageId: activeAssistantMessageId,
                provider,
                connectionId: session.connection?.id ?? null,
                modelRawId: session.modelRawId ?? null,
                modelCapabilities,
                requestSignal,
                emitReasoning,
                sendToolEvent,
                sendStreamEvent,
              },
            ).finally(finishTiming);
            // 只清点证据，不改写工具结果
            noteToolEvidence(toolName, toolResult, typeof iteration === 'number' ? iteration : 0);
            return toolResult;
          },
          onUnsupportedTool: (toolName, toolCallId) => {
            sendUnsupportedToolError(toolName || 'unknown', toolCallId, sendToolEvent);
          },
          onToolCallSkipped: ({ toolCall, toolName, reason }) => {
            const callId =
              (toolCall?.id && toolCall.id.trim()) ||
              `session:${sessionId}:tool:skipped:${Date.now().toString(36)}:${Math.random()
                .toString(36)
                .slice(2, 8)}`;
            // 已宣告但未执行：补一条 result/aborted 记录，不伪造成功
            // 文案按原因区分：预算耗尽不是"被停止"
            sendToolEvent({
              id: callId,
              callId,
              tool: toolName || 'unknown',
              stage: 'result',
              status: 'aborted',
              phase: 'aborted',
              summary: buildSkippedToolSummary(reason),
              details: { stopReason: reason, skipped: true },
            });
          },
        });

        if (orchestration.status === 'terminated') {
          const { termination } = orchestration;
          if (
            termination.code === 'research_plan_cancelled' ||
            termination.code === 'research_plan_expired'
          ) {
            await handleResearchPlanTermination(termination.code);
            return;
          }
          throw new Error(termination.message);
        }

        if (orchestration.status === 'max_iterations') {
          const iterationLabel = Number.isFinite(maxIterations)
            ? String(maxIterations)
            : '无限制';
          throw new Error(`工具调用次数已达上限（${iterationLabel}），未生成最终答案`);
        }

        // 停止/预算收尾带 stopReason；上游未交付只带 finalAnswerGenerated=false
        const runResult: PersistedRunResult | null =
          orchestration.stopReason != null || orchestration.finalAnswerGenerated === false
            ? {
                ...(orchestration.stopReason != null
                  ? { stopReason: orchestration.stopReason }
                  : {}),
                finalAnswerGenerated: orchestration.finalAnswerGenerated,
              }
            : null;

        // 取消优先于任何终态判定：客户端已取消时不得把这次运行记成交付或未交付
        if (checkCancelled()) {
          await persistAssistantProgress({ force: true, status: 'cancelled' });
          log.debug('Agent stream cancelled by client', {
            sessionId,
            streamKey,
          });
          return;
        }

        if (orchestration.status === 'stopped_without_answer') {
          await finishWithoutFinalAnswer(runResult);
          return;
        }

        if (orchestration.status === 'answer_not_delivered') {
          // 上游只给了一句非空提示：保留原文，按未交付收尾（不重试、不换模型、不改写）
          ensureTerminalContentVisible(orchestration.content);
          await finishWithoutFinalAnswer(runResult, orchestration.answerOutcome);
          return;
        }

        if (orchestration.status !== 'completed') {
          throw new Error('AI provider did not return a response');
        }
        finalContent = orchestration.content.trim();
        if (!finalContent) {
          throw new Error('Model finished without producing a final answer');
        }
        reasoningChunks.push(...orchestration.reasoningChunks);
        if (reasoningStartedAt && orchestration.reasoningChunks.length > 0) {
          reasoningDurationSeconds = Math.max(
            0,
            Math.round((Date.now() - reasoningStartedAt) / 1000),
          );
        }
        finalUsageSnapshot = orchestration.usage;

        if (!finalContent) {
          throw new Error('AI provider did not return a response');
        }

        // 使用 reasoningBuffer（原始 delta 累积）而非 join('\n\n')，
        // 避免 tool log offsets（基于 reasoningBuffer.length）与最终持久化文本不一致导致断字。
        reasoningText = reasoningBuffer;
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
        // 末轮用量沿用既有口径：provider 值有效就用 provider，否则本地 fallback
        const providerUsageNumbers =
          providerUsageSeen && finalUsageSnapshot ? readUsageNumbers(finalUsageSnapshot) : null;
        const providerUsageValid =
          providerUsageNumbers != null &&
          (providerUsageNumbers.prompt > 0 ||
            providerUsageNumbers.completion > 0 ||
            providerUsageNumbers.total > 0);
        const fallbackUsageNumbers = {
          prompt: promptTokens,
          completion: completionTokensFallback,
          total: promptTokens + completionTokensFallback,
          cacheHit: 0,
          cacheMiss: 0,
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
        safeEnqueue({
          type: 'complete',
          content: finalContent,
          usage: finalUsagePayload,
          ...(runResult?.stopReason ? { stopReason: runResult.stopReason } : {}),
          ...(runResult ? { finalAnswerGenerated: runResult.finalAnswerGenerated } : {}),
        });
        traceMetadataExtras.stopReason = runResult?.stopReason ?? null;
        traceMetadataExtras.finalAnswerGenerated = runResult?.finalAnswerGenerated ?? true;
        traceMetadataExtras.finalUsage = finalUsagePayload;
        traceMetadataExtras.providerUsageSource = providerUsageValid ? 'provider' : 'fallback';
        traceMetadataExtras.providerUsageLastRound = providerUsageValid ? providerUsageNumbers : null;

        if (orchestration.answerOutcome) {
          traceRecorder.log('agent:answer_outcome', {
            ...buildAnswerOutcomeTracePayload(orchestration.answerOutcome),
            finalAnswerGenerated: true,
            stopReason: runResult?.stopReason ?? null,
            retrievalRounds: retrievalTally.rounds,
            retrievalEvidenceRounds: retrievalTally.evidenceRounds,
          });
        }

        const completedAt = Date.now();
        const streamMetrics = computeStreamMetrics({
          timing: {
            requestStartedAt: startedAt,
            firstChunkAt,
            completedAt,
          },
          completionTokens: finalUsageNumbers.completion,
        });
        const firstTokenLatencyMs = streamMetrics.firstTokenLatencyMs;
        const responseTimeMs = streamMetrics.responseTimeMs;
        const tokensPerSecond =
          finalUsageNumbers.completion > 0 ? streamMetrics.tokensPerSecond : null;

        let persistedAssistantMessageId: number | null = activeAssistantMessageId;
        try {
          const sessionStillExists = async () => {
            const count = await prisma.chatSession.count({ where: { id: sessionId } });
            return count > 0;
          };

          if (finalContent && (await sessionStillExists())) {
            // 排空未完成的进度写，避免旧快照覆盖 finalize
            await assistantProgressPersistChain;
            // 不再对 reasoningText 做 trim，保持与 tool event offsets 的一致性
            const streamReasoningPayload = reasoningText.length > 0 ? reasoningText : null;
            const shouldPersistReasoning =
              reasoningEnabled && reasoningSaveToDb && reasoningText.length > 0;
            const providerHost = (() => {
              try {
                const u = new URL(baseUrl);
                return u.hostname;
              } catch {
                return null;
              }
            })();
            const finalToolLogsJson = toolLogManager.toJson(runResult ? { runResult } : undefined);
            const persistedId = await persistAssistantFinalResponse({
              sessionId,
              existingMessageId: activeAssistantMessageId,
              assistantClientMessageId,
              fallbackClientMessageId: clientMessageId,
              parentMessageId: userMessageRecord?.id ?? null,
              content: finalContent,
              streamReasoning: streamReasoningPayload,
              reasoning: shouldPersistReasoning ? reasoningText : null,
              reasoningDurationSeconds: shouldPersistReasoning ? reasoningDurationSeconds : null,
              streamError: null,
              toolLogsJson: finalToolLogsJson,
              usage: {
                promptTokens: finalUsageNumbers.prompt,
                completionTokens: finalUsageNumbers.completion,
                totalTokens: finalUsageNumbers.total,
                contextLimit,
                promptCacheHitTokens: finalUsageNumbers.cacheHit,
                promptCacheMissTokens: finalUsageNumbers.cacheMiss,
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
              toolLogManager.markClean();
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
          traceMetadataExtras.toolEvents = toolLogManager.getLogs().length;
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
        // 最后一轮的用量事件在这里结算；逐轮累计只进追踪元数据，不参与计费
        try {
          flushUsageRounds();
        } catch { }
        traceMetadataExtras.providerUsageRounds = usageRounds.size;
        traceMetadataExtras.providerUsageTotals = usageTotals();
        traceMetadataExtras.toolWallTimeMs = toolWallTimer.elapsedMs();
        traceMetadataExtras.retrievalRounds = retrievalTally.rounds;
        traceMetadataExtras.retrievalEvidenceRounds = retrievalTally.evidenceRounds;
        const toolLogSummary = toolLogManager.getSummary(50);
        const finalMetadata = {
          ...traceMetadataExtras,
          toolLogs: toolLogSummary,
          // 裁剪前真实条数：recorder 用它写 metadataOmissions，避免只看得到前 50 条
          toolLogsTotal: toolLogManager.getCount(),
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
