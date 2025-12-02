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
      const idleTimeout = idleTimeoutMs > 0 ? idleTimeoutMs : null;
      let idleWatchTimer: ReturnType<typeof setInterval> | null = null;
      let lastChunkAt = Date.now();
      let idleWarned = false;

      const persistAssistantProgress = async (force = false) => {
        if (!activeAssistantMessageId) return;
        if (!aiResponseContent && !force) return;
        const now = Date.now();
        const deltaLength = aiResponseContent.length - assistantProgressLastPersistedLength;
        if (!force) {
          if (deltaLength < 24 && now - assistantProgressLastPersistAt < streamProgressPersistIntervalMs) {
            return;
          }
        }
        assistantProgressLastPersistAt = now;
        assistantProgressLastPersistedLength = aiResponseContent.length;
        try {
          await prisma.message.update({
            where: { id: activeAssistantMessageId },
            data: {
              content: aiResponseContent,
            },
          });
          traceRecorder.log('db:persist_progress', {
            messageId: activeAssistantMessageId,
            length: aiResponseContent.length,
            force,
          });
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
                streamStatus: 'streaming',
                streamReasoning: null,
                streamError: null,
              },
            });
            if (recoveredId) {
              activeAssistantMessageId = recoveredId;
              if (streamMeta) {
                streamMeta.assistantMessageId = recoveredId;
                persistStreamMeta(streamMeta);
              }
              log.warn('Assistant progress target missing, upserted placeholder record', {
                sessionId,
                recoveredId,
              });
              traceRecorder.log('db:persist_progress', {
                messageId: recoveredId,
                length: aiResponseContent.length,
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
        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          entry.summary = payload.summary.trim();
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
          summary: entry.summary ?? existing.summary,
          createdAt: existing.createdAt,
        };
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

      const emitReasoning = (content: string, meta?: Record<string, unknown>) => {
        const text = (content || '').trim();
        if (!text) return;
        const payload: Record<string, unknown> = { type: 'reasoning', content: text };
        if (meta && Object.keys(meta).length > 0) {
          payload.meta = meta;
        }
        safeEnqueue(payload);
      };

      const truncateText = (text: string, limit = 160) => {
        const normalized = (text || '').trim();
        if (!normalized) return '';
        return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
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
        emitReasoning('执行 Python 代码', { ...reasoningMetaBase, stage: 'start', summary: preview });
        sendToolEvent({
          id: callId,
          tool: 'python_runner',
          stage: 'start',
          summary: preview,
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
          sendToolEvent({
            id: callId,
            tool: 'python_runner',
            stage: 'result',
            summary: resultPreview,
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
      if (toolDefinitions.length === 0) {
        throw new Error('Agent 工具未启用');
      }
      const maxIterations = 4;
      let currentProviderController: AbortController | null = null;

      const callProvider = async (messages: any[]) => {
        const body = convertOpenAIReasoningPayload({
          ...requestData,
          stream: true,
          messages,
          tools: toolDefinitions,
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
      let aiResponseContent = '';
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
              toolLogsJson: toolLogs.length > 0 ? JSON.stringify(toolLogs) : null,
              usage: {
                promptTokens: finalUsageNumbers.prompt,
                completionTokens: finalUsageNumbers.completion,
                totalTokens: finalUsageNumbers.total,
                contextLimit,
              },
              model: session.modelRawId,
              provider: providerHost ?? undefined,
            });
            if (persistedId) {
              persistedAssistantMessageId = persistedId;
              activeAssistantMessageId = persistedId;
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
        if (streamMeta?.cancelled) {
          log.debug('Agent stream aborted after client cancellation', {
            sessionId,
            streamKey,
          });
          traceStatus = 'cancelled';
          traceRecorder.log('stream:cancelled', { sessionId, streamKey });
          return;
        }
        traceStatus = 'error';
        traceErrorMessage = error?.message || 'Web search agent failed';
        traceRecorder.log('stream:error', { message: traceErrorMessage });
        log.error('Agent web search failed', error);
        safeEnqueue({
          type: 'error',
          error: error?.message || 'Web search agent failed',
        });
        const persistErrorStatus = async () => {
          const payload = {
            content: aiResponseContent,
            streamCursor: aiResponseContent.length,
            streamStatus: 'error' as const,
            streamError: traceErrorMessage,
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
          error instanceof Error ? error : new Error(error?.message || 'Web search agent failed');
        (agentError as any).handled = 'agent_error';
        (agentError as any).status = error?.status ?? 500;
        throw agentError;
      } finally {
        try {
          controller.close();
        } catch {}
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

export const buildAgentWebSearchConfig = (sysMap: Record<string, string>): AgentWebSearchConfig => {
  const enabled = parseBooleanSetting(
    sysMap.web_search_agent_enable ?? process.env.WEB_SEARCH_AGENT_ENABLE,
    false,
  );
  const engine = (
    sysMap.web_search_default_engine ||
    process.env.WEB_SEARCH_DEFAULT_ENGINE ||
    'tavily'
  ).toLowerCase();
  const engineUpper = engine.toUpperCase();
  const apiKey =
    sysMap[`web_search_api_key_${engine}`] ||
    process.env[`WEB_SEARCH_API_KEY_${engineUpper}`] ||
    '';
  const limitRaw = sysMap.web_search_result_limit ?? process.env.WEB_SEARCH_RESULT_LIMIT ?? '4';
  const parsedLimit = Number.parseInt(String(limitRaw), 10);
  const resultLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(10, parsedLimit)) : 4;
  const sysDomains = parseDomainListSetting(sysMap.web_search_domain_filter);
  const envDomains = parseDomainListSetting(process.env.WEB_SEARCH_DOMAIN_FILTER);
  const domainList = sysDomains.length > 0 ? sysDomains : envDomains;
  const endpoint = sysMap.web_search_endpoint || process.env.WEB_SEARCH_ENDPOINT;
  const scopeRaw = (sysMap.web_search_scope || process.env.WEB_SEARCH_SCOPE || '').trim().toLowerCase();
  const scope =
    scopeRaw && ['webpage', 'document', 'paper', 'image', 'video', 'podcast'].includes(scopeRaw)
      ? scopeRaw
      : undefined;
  const includeSummary = parseBooleanSetting(
    sysMap.web_search_include_summary ?? process.env.WEB_SEARCH_INCLUDE_SUMMARY,
    false,
  );
  const includeRawContent = parseBooleanSetting(
    sysMap.web_search_include_raw ?? process.env.WEB_SEARCH_INCLUDE_RAW,
    false,
  );
  return {
    enabled,
    engine,
    apiKey,
    resultLimit,
    domains: domainList,
    endpoint,
    scope,
    includeSummary,
    includeRawContent,
  };
};

export const buildAgentPythonToolConfig = (sysMap: Record<string, string>): AgentPythonToolConfig => {
  const enabled = parseBooleanSetting(
    sysMap.python_tool_enable ?? process.env.PYTHON_TOOL_ENABLE,
    false,
  );
  const command =
    (sysMap.python_tool_command || process.env.PYTHON_TOOL_COMMAND || 'python3').trim() ||
    'python3';
  const argsRaw = sysMap.python_tool_args || process.env.PYTHON_TOOL_ARGS;
  const args = parseDomainListSetting(argsRaw)?.map((arg) => arg.replace(/\s+$/g, '')) || [];
  const parseNumber = (
    value: string | undefined,
    envValue: string | undefined,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const raw = value ?? envValue;
    if (!raw) return fallback;
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  const timeoutMs = parseNumber(
    sysMap.python_tool_timeout_ms,
    process.env.PYTHON_TOOL_TIMEOUT_MS,
    1000,
    60000,
    8000,
  );
  const maxOutputChars = parseNumber(
    sysMap.python_tool_max_output_chars,
    process.env.PYTHON_TOOL_MAX_OUTPUT_CHARS,
    256,
    20000,
    4000,
  );
  const maxSourceChars = parseNumber(
    sysMap.python_tool_max_source_chars,
    process.env.PYTHON_TOOL_MAX_SOURCE_CHARS,
    256,
    20000,
    4000,
  );
  return {
    enabled,
    command,
    args,
    timeoutMs,
    maxOutputChars,
    maxSourceChars,
  };
};
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import { convertOpenAIReasoningPayload } from '../../utils/providers';
import { Tokenizer } from '../../utils/tokenizer';
import { formatHitsForModel, runWebSearch, type WebSearchHit } from '../../utils/web-search';
import { runPythonSnippet } from '../../utils/python-runner';
import { serializeQuotaSnapshot } from '../../utils/quota';
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
} from './stream-state';

export interface AgentWebSearchConfig {
  enabled: boolean;
  engine: string;
  apiKey?: string;
  resultLimit: number;
  domains: string[];
  endpoint?: string;
  scope?: string;
  includeSummary?: boolean;
  includeRawContent?: boolean;
}

export interface AgentPythonToolConfig {
  enabled: boolean;
  command: string;
  args: string[];
  timeoutMs: number;
  maxOutputChars: number;
  maxSourceChars: number;
}

export type AgentResponseParams = {
  session: typeof prisma.chatSession.$inferSelect;
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
  toolFlags: { webSearch: boolean; python: boolean };
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
};
