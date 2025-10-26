import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { convertOpenAIReasoningPayload } from '../utils/providers'
import { Tokenizer } from '../utils/tokenizer';
import { authMiddleware } from '../middleware/auth';
import type { ApiResponse, Message } from '../types';
import { BackendLogger as log } from '../utils/logger';
import { createReasoningState, DEFAULT_REASONING_TAGS, extractByTags } from '../utils/reasoning-tags';

const chat = new Hono();

// ---- 流式/网络稳定性相关可调参数（环境变量控制） ----
// SSE 心跳间隔（毫秒），用于穿透代理连接空闲关闭，默认 15s
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000');
// 厂商流式连接最大空闲时长（毫秒），超过则中止并按退避策略重试，默认 60s
const PROVIDER_MAX_IDLE_MS = parseInt(process.env.PROVIDER_MAX_IDLE_MS || '60000');
// 厂商请求总体超时（毫秒），默认 5 分钟
const PROVIDER_TIMEOUT_MS = parseInt(process.env.PROVIDER_TIMEOUT_MS || '300000');
// 429 退避（毫秒）与 5xx/超时 退避（毫秒）
const BACKOFF_429_MS = 15000;
const BACKOFF_5XX_MS = 2000;
// 前端出现失败重试/降级时，避免同一条用户消息被重复写入数据库
const MESSAGE_DEDUPE_WINDOW_MS = parseInt(process.env.MESSAGE_DEDUPE_WINDOW_MS || '30000');

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
});

// 获取会话消息历史
chat.get('/sessions/:sessionId/messages', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
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
        userId: user.id,
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

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { sessionId },
        select: {
          id: true,
          sessionId: true,
          role: true,
          content: true,
          clientMessageId: true,
          reasoning: true,
          reasoningDurationSeconds: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.message.count({
        where: { sessionId },
      }),
    ]);

    return c.json<ApiResponse<{
      messages: Array<{ id: number; sessionId: number; role: string; content: string; clientMessageId: string | null; createdAt: Date }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>>({
      success: true,
      data: {
        messages,
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

// 发送消息并获取AI响应（流式）
chat.post('/stream', authMiddleware, zValidator('json', sendMessageSchema), async (c) => {
  try {
    const user = c.get('user');
    const { sessionId, content, images } = c.req.valid('json');

    // 验证会话是否存在且属于当前用户
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
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

    if (session.userId !== user.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Access denied',
      }, 403);
    }

    // 新模型选择：要求存在 connection + modelRawId
    if (!session.connectionId || !session.connection || !session.modelRawId) {
      return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400)
    }

    // 保存用户消息（优先使用 clientMessageId 幂等；无ID时使用时间窗去重）
    const clientMessageId = (c.req.valid('json') as any).clientMessageId as string | undefined
    let userMessage: any
    if (clientMessageId && clientMessageId.trim()) {
      userMessage = await prisma.message.upsert({
        where: { sessionId_clientMessageId: { sessionId, clientMessageId } },
        update: {},
        create: { sessionId, role: 'user', content, clientMessageId },
      });
    } else {
      userMessage = await prisma.message.findFirst({
        where: { sessionId, role: 'user', content },
        orderBy: { createdAt: 'desc' },
      });
      if (!userMessage || (Date.now() - new Date(userMessage.createdAt as any).getTime()) > MESSAGE_DEDUPE_WINDOW_MS) {
        userMessage = await prisma.message.create({ data: { sessionId, role: 'user', content } });
      }
    }

    // 获取用户上下文token限制
    const defaultLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000');
    let contextTokenLimit = defaultLimit;

    // 这里可以从用户设置中获取个性化限制，暂时使用默认值
    // TODO: 实现用户个性化设置功能

    // 获取历史消息并构建上下文
    const recentMessages = await prisma.message.findMany({
      where: { sessionId },
      select: {
        role: true,
        content: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // 最多获取50条历史消息
    });

    // 构建对话历史（不包括刚保存的用户消息）
    const conversationHistory = recentMessages
      .filter((msg: { role: string; content: string }) => msg.role !== 'user' || msg.content !== content)
      .reverse(); // 按时间正序

    // 添加当前用户消息
    const fullConversation = [
      ...conversationHistory,
      { role: 'user', content },
    ];

    // 使用tokenizer截断上下文
    const truncatedContext = await Tokenizer.truncateMessages(
      fullConversation,
      contextTokenLimit
    );

    // 统计上下文使用量（估算）
    const promptTokens = await Tokenizer.countConversationTokens(truncatedContext);
    const contextLimit = contextTokenLimit;
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

    log.debug('Chat stream request', { sessionId, userId: user.id, provider, baseUrl, model: session.modelRawId })

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
    const reqReasoningEnabled = (c.req.valid('json') as any).reasoningEnabled
    const reqReasoningEffort = (c.req.valid('json') as any).reasoningEffort
    const reqOllamaThink = (c.req.valid('json') as any).ollamaThink

    const effectiveReasoningEnabled = typeof reqReasoningEnabled === 'boolean'
      ? reqReasoningEnabled
      : (sessionDefaults?.reasoningEnabled ?? ((sysMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false'))

    const effectiveReasoningEffort = (reqReasoningEffort || sessionDefaults?.reasoningEffort || (sysMap.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || '')).toString()

    const effectiveOllamaThink = typeof reqOllamaThink === 'boolean'
      ? reqOllamaThink
      : ((sessionDefaults?.ollamaThink ?? ((sysMap.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true')) as boolean)

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
    const REASONING_SAVE_TO_DB = (sysMap.reasoning_save_to_db ?? (process.env.REASONING_SAVE_TO_DB ?? 'true')).toString().toLowerCase() === 'true';
    const REASONING_TAGS_MODE = (sysMap.reasoning_tags_mode ?? (process.env.REASONING_TAGS_MODE ?? 'default')).toString();
    const REASONING_CUSTOM_TAGS = (() => {
      try {
        const raw = sysMap.reasoning_custom_tags || process.env.REASONING_CUSTOM_TAGS || '';
        const arr = raw ? JSON.parse(raw) : null;
        if (Array.isArray(arr) && arr.length === 2 && typeof arr[0] === 'string' && typeof arr[1] === 'string') return [[arr[0], arr[1]] as [string, string]];
      } catch {}
      return null;
    })();
    const STREAM_DELTA_CHUNK_SIZE = parseInt(sysMap.stream_delta_chunk_size || process.env.STREAM_DELTA_CHUNK_SIZE || '1');

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

      return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
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
        try {
          // 发送开始事件
          const startEvent = `data: ${JSON.stringify({
            type: 'start',
            messageId: userMessage.id,
          })}\n\n`;
          controller.enqueue(encoder.encode(startEvent));

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
            controller.enqueue(encoder.encode(usageEvent));
          }

          // 调用第三方AI API（带退避）
          const response = await providerRequestWithBackoff();

          log.debug('AI provider response', { status: response.status, ok: response.ok })
          if (!response.ok) {
            throw new Error(`AI API request failed: ${response.status} ${response.statusText}`);
          }

          // 处理流式响应
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body reader');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          // 心跳&空闲监控
          let lastChunkAt = Date.now();
          const heartbeat = setInterval(() => {
            try {
              // SSE 注释心跳（客户端忽略），同时也可用 data: keepalive
              controller.enqueue(encoder.encode(': ping\n\n'));
            } catch {}
            if (providerMaxIdleMs > 0 && Date.now() - lastChunkAt > providerMaxIdleMs) {
              // 厂商连接空闲过久，主动中止
              try { (response as any)?.body?.cancel?.(); } catch {}
            }
          }, Math.max(1000, heartbeatIntervalMs));

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            lastChunkAt = Date.now();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const l = line.replace(/\r$/, '');
              if (l.startsWith('data: ')) {
                const data = l.slice(6);
                log.debug('SSE line', data?.slice(0, 120))

                if (data === '[DONE]') {
                  // 流结束
                  const endEvent = `data: ${JSON.stringify({
                    type: 'end',
                  })}\n\n`;
                  controller.enqueue(encoder.encode(endEvent));
                  break;
                }

                try {
                  const parsed = JSON.parse(data);

                  // 提取AI响应内容
                  const deltaContent: string | undefined = parsed.choices?.[0]?.delta?.content;
                  const deltaReasoning: string | undefined = parsed.choices?.[0]?.delta?.reasoning_content;

                  // 供应商原生 reasoning_content（OpenAI 等）
                  if (REASONING_ENABLED && deltaReasoning) {
                    if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                    reasoningBuffer += deltaReasoning;
                    const reasoningEvent = `data: ${JSON.stringify({ type: 'reasoning', content: deltaReasoning })}\n\n`;
                    controller.enqueue(encoder.encode(reasoningEvent));
                  }

                  if (deltaContent) {
                    let visible = deltaContent;
                    if (REASONING_ENABLED && REASONING_TAGS_MODE !== 'off') {
                      const tags = REASONING_TAGS_MODE === 'custom' && REASONING_CUSTOM_TAGS ? REASONING_CUSTOM_TAGS : DEFAULT_REASONING_TAGS;
                      const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState);
                      visible = visibleDelta;
                      if (reasoningDelta) {
                        if (!reasoningState.startedAt) reasoningState.startedAt = Date.now();
                        reasoningBuffer += reasoningDelta;
                        const reasoningEvent = `data: ${JSON.stringify({ type: 'reasoning', content: reasoningDelta })}\n\n`;
                        controller.enqueue(encoder.encode(reasoningEvent));
                      }
                    }

                    if (visible) {
                      aiResponseContent += visible;
                      const contentEvent = `data: ${JSON.stringify({ type: 'content', content: visible })}\n\n`;
                      controller.enqueue(encoder.encode(contentEvent));
                    }
                  }

                  // 结束原因（如果可用）
                  const fr = parsed.choices?.[0]?.finish_reason;
                  if (fr) {
                    const stopEvent = `data: ${JSON.stringify({
                      type: 'stop',
                      reason: fr,
                    })}\n\n`;
                    controller.enqueue(encoder.encode(stopEvent));
                  }

          // 厂商 usage 透传（优先级更高）
          if (USAGE_EMIT && parsed.usage) {
            // 仅当厂商 usage 含有效数值时，才标记为已接收，避免空对象/全0 覆盖本地估算
            const n = (u: any) => ({
              prompt: Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0,
              completion: Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0,
              total: Number(u?.total_tokens ?? 0) || 0,
            })
            const nn = n(parsed.usage)
            const valid = (nn.prompt > 0) || (nn.completion > 0) || (nn.total > 0)
            if (valid) {
              providerUsageSeen = true;
              providerUsageSnapshot = parsed.usage;
            }
            const providerUsageEvent = `data: ${JSON.stringify({
              type: 'usage',
              usage: parsed.usage,
            })}\n\n`;
            controller.enqueue(encoder.encode(providerUsageEvent));
          }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', data, parseError);
                }
              }
            }
          }

          clearInterval(heartbeat);

          // 推理结束事件（若产生过推理）
          if (REASONING_ENABLED && !reasoningDoneEmitted && reasoningBuffer.trim()) {
            const endedAt = Date.now();
            if (reasoningState.startedAt) {
              reasoningDurationSeconds = Math.max(0, Math.round((endedAt - reasoningState.startedAt) / 1000));
            }
            const reasoningDoneEvent = `data: ${JSON.stringify({ type: 'reasoning', done: true, duration: reasoningDurationSeconds })}\n\n`;
            controller.enqueue(encoder.encode(reasoningDoneEvent));
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
            controller.enqueue(encoder.encode(finalUsageEvent));
          }

          // 发送完成事件
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
          })}\n\n`;
          controller.enqueue(encoder.encode(completeEvent));

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
                    ...(REASONING_ENABLED && (typeof (c.req.valid('json') as any)?.saveReasoning === 'boolean' ? (c.req.valid('json') as any).saveReasoning : REASONING_SAVE_TO_DB) && reasoningBuffer.trim()
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
                const j = await resp.json();
                const text = j?.choices?.[0]?.message?.content || '';
                if (text) {
                  aiResponseContent = text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: text })}\n\n`));
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`));
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
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          controller.close();
        }
      },
    });

    return c.newResponse(stream as any, 200, sseHeaders);

  } catch (error) {
    console.error('Chat stream error:', error);
    log.error('Chat stream error detail', (error as Error)?.message, (error as Error)?.stack)
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to process chat request',
    }, 500);
  }
});

// 非流式：同步返回完整回复
chat.post('/completion', authMiddleware, zValidator('json', sendMessageSchema), async (c) => {
  try {
    const user = c.get('user');
    const { sessionId, content, images } = c.req.valid('json');

    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { connection: true },
    });
    if (!session) {
      return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
    }
    if (session.userId !== user.id) {
      return c.json<ApiResponse>({ success: false, error: 'Access denied' }, 403);
    }
    if (!session.connectionId || !session.connection || !session.modelRawId) {
      return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400);
    }

    // 保存用户消息（优先使用 clientMessageId 幂等；无ID时使用时间窗去重）
    {
      const clientMessageId = (c.req.valid('json') as any).clientMessageId as string | undefined
      if (clientMessageId && clientMessageId.trim()) {
        await prisma.message.upsert({
          where: { sessionId_clientMessageId: { sessionId, clientMessageId } },
          update: {},
          create: { sessionId, role: 'user', content, clientMessageId },
        });
      } else {
        const existing = await prisma.message.findFirst({
          where: { sessionId, role: 'user', content },
          orderBy: { createdAt: 'desc' },
        });
        if (!existing || (Date.now() - new Date(existing.createdAt as any).getTime()) > MESSAGE_DEDUPE_WINDOW_MS) {
          await prisma.message.create({ data: { sessionId, role: 'user', content } });
        }
      }
    }

    // 构建历史上下文
    const defaultLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000');
    const recent = await prisma.message.findMany({
      where: { sessionId },
      select: { role: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const conversation = recent.reverse();
    const truncated = await Tokenizer.truncateMessages(conversation.concat([{ role: 'user', content }]), defaultLimit);
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
    // 非流式补全请求的超时（毫秒），优先系统设置，其次环境变量，默认 5 分钟
    const providerTimeoutMs = parseInt(settingsMap.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000');
    const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { reasoningEnabled: true, reasoningEffort: true, ollamaThink: true } })
    const reqJson = c.req.valid('json') as any
    const ren = typeof reqJson?.reasoningEnabled === 'boolean' ? reqJson.reasoningEnabled : (sess?.reasoningEnabled ?? ((settingsMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false'))
    const ref = (reqJson?.reasoningEffort || sess?.reasoningEffort || (settingsMap.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || '')).toString()
    const otk = typeof reqJson?.ollamaThink === 'boolean' ? reqJson.ollamaThink : ((sess?.ollamaThink ?? ((settingsMap.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true')) as boolean)
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
    const doOnce = async (signal: AbortSignal) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
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
      return c.json<ApiResponse>({ success: false, error: `AI API request failed: ${resp.status} ${resp.statusText}` }, 502);
    }
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || '';
    const fallbackReasoning: string | undefined = json?.choices?.[0]?.message?.reasoning_content || json?.message?.thinking || undefined;
    const u = json?.usage || {};
    const usage = {
      prompt_tokens: Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? promptTokens) || promptTokens,
      completion_tokens: Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0,
      total_tokens: Number(u?.total_tokens ?? 0) || (promptTokens + (Number(u?.completion_tokens ?? 0) || 0)),
      context_limit: defaultLimit,
      context_remaining: Math.max(0, defaultLimit - promptTokens),
    };

    let assistantMsgId: number | null = null;
    if (text) {
      const saveFlag = (() => {
        const reqJson = c.req.valid('json') as any
        if (typeof reqJson?.saveReasoning === 'boolean') return reqJson.saveReasoning
        return true
      })()
      const saved = await prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: text,
          ...((fallbackReasoning && saveFlag) ? { reasoning: String(fallbackReasoning) } : {}),
        },
      });
      assistantMsgId = saved.id;
    }
    await (prisma as any).usageMetric.create({
      data: {
        sessionId,
        messageId: assistantMsgId ?? undefined,
        model: session.modelRawId || 'unknown',
        provider: (() => { try { const u = new URL(baseUrl); return u.hostname; } catch { return null; } })() ?? undefined,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        contextLimit: defaultLimit,
      },
    });

    return c.json<ApiResponse<{ content: string; usage: typeof usage }>>({ success: true, data: { content: text, usage } });
  } catch (error) {
    console.error('Chat completion error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to process non-stream completion' }, 500);
  }
});

// 停止生成（前端可通过关闭连接实现，这里提供确认接口）
chat.post('/stop', authMiddleware, zValidator('json', z.object({
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
chat.post('/regenerate', authMiddleware, zValidator('json', z.object({
  sessionId: z.number().int().positive(),
  messageId: z.number().int().positive(), // 要重新生成的消息ID
})), async (c) => {
  try {
    const user = c.get('user');
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
chat.post('/generate', authMiddleware, zValidator('json', z.object({
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
      conn = await prisma.connection.findFirst({ where: { id: body.connectionId, OR: [ { ownerUserId: null }, { ownerUserId: user.id } ] } })
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
      return c.text(text, res.status)
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
      return c.json(json, res.status)
    }
    return c.json<ApiResponse>({ success: false, error: 'Unsupported provider' }, 400)
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e?.message || 'Generate failed' }, 500)
  }
})

export default chat;

// 用量聚合查询
chat.get('/usage', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.query('sessionId') || '0');
    if (!sessionId || Number.isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400);
    }

    // 验证归属
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== user.id) {
      return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
    }

    // 聚合
    const [metrics, last] = await Promise.all([
      (prisma as any).usageMetric.findMany({ where: { sessionId } }),
      (prisma as any).usageMetric.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const totals = metrics.reduce((acc, m: any) => {
      acc.prompt_tokens += Number(m.promptTokens || 0);
      acc.completion_tokens += Number(m.completionTokens || 0);
      acc.total_tokens += Number(m.totalTokens || 0);
      return acc;
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

    // 即时上下文占用（估算）
    const defaultLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000');
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
      context_limit: defaultLimit,
      context_remaining: Math.max(0, defaultLimit - used),
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
chat.get('/sessions/usage', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    // 获取当前用户的会话列表
    const sessions = await prisma.chatSession.findMany({
      where: { userId: user.id },
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
chat.get('/usage/daily', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
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
