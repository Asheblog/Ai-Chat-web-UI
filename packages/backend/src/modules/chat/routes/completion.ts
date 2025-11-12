import type { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import type { Actor, ApiResponse, UsageQuotaSnapshot } from '../../../types';
import { persistChatImages, cleanupExpiredChatImages } from '../../../utils/chat-images';
import { consumeActorQuota, inspectActorQuota, serializeQuotaSnapshot } from '../../../utils/quota';
import { cleanupAnonymousSessions } from '../../../utils/anonymous-cleanup';
import { resolveContextLimit } from '../../../utils/context-window';
import { Tokenizer } from '../../../utils/tokenizer';
import { AuthUtils } from '../../../utils/auth';
import { BackendLogger as log } from '../../../utils/logger';
import { logTraffic } from '../../../utils/traffic-logger';
import {
  BACKOFF_429_MS,
  BACKOFF_5XX_MS,
  MESSAGE_DEDUPE_WINDOW_MS,
  ProviderChatCompletionResponse,
  QuotaExceededError,
  extendAnonymousSession,
  sendMessageSchema,
  sessionOwnershipClause,
} from '../chat-common';
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../../config/storage';

export const registerChatCompletionRoutes = (router: Hono) => {
  router.post('/completion', actorMiddleware, zValidator('json', sendMessageSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const userId = actor.type === 'user' ? actor.id : null;
      const payload = c.req.valid('json') as any;
      const { sessionId, content, images } = payload;

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
      });

      const session = await prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          ...sessionOwnershipClause(actor),
        },
        include: { connection: true },
      });
      if (!session) {
        return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
      }
      if (!session.connectionId || !session.connection || !session.modelRawId) {
        return c.json<ApiResponse>({ success: false, error: 'Session model not selected' }, 400);
      }

      await extendAnonymousSession(actor, sessionId);

      const clientMessageIdInput = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : '';
      const clientMessageId = clientMessageIdInput || null;
      const now = new Date();

      let userMessageRecord: any = null;
      let messageWasReused = false;
      let quotaSnapshot: UsageQuotaSnapshot | null = null;

      try {
        await prisma.$transaction(async (tx) => {
          if (clientMessageId) {
            const existing = await tx.message.findUnique({
              where: { sessionId_clientMessageId: { sessionId, clientMessageId } },
            });
            if (existing) {
              userMessageRecord = existing;
              messageWasReused = true;
              quotaSnapshot = await inspectActorQuota(actor, { tx, now });
              return;
            }
          } else {
            const existing = await tx.message.findFirst({
              where: { sessionId, role: 'user', content },
              orderBy: { createdAt: 'desc' },
            });
            if (existing) {
              const createdAt = existing.createdAt instanceof Date
                ? existing.createdAt
                : new Date(existing.createdAt as any);
              if (now.getTime() - createdAt.getTime() <= MESSAGE_DEDUPE_WINDOW_MS) {
                userMessageRecord = existing;
                messageWasReused = true;
                quotaSnapshot = await inspectActorQuota(actor, { tx, now });
                return;
              }
            }
          }

          const consumeResult = await consumeActorQuota(actor, { tx, now });
          if (!consumeResult.success) {
            throw new QuotaExceededError(consumeResult.snapshot);
          }
          quotaSnapshot = consumeResult.snapshot;

          userMessageRecord = await tx.message.create({
            data: {
              sessionId,
              role: 'user',
              content,
              ...(clientMessageId ? { clientMessageId } : {}),
            },
          });
        });
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return c.json({
            success: false,
            error: 'Daily quota exhausted',
            quota: serializeQuotaSnapshot(error.snapshot),
            requiredLogin: actor.type !== 'user',
          }, 429);
        }
        throw error;
      }

      if (!userMessageRecord) {
        return c.json<ApiResponse>({ success: false, error: 'Failed to persist user message' }, 500);
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
        : '';

      const messagesPayload: any[] = truncated.map((m: any) => ({ role: m.role, content: m.content }));
      const parts: any[] = [];
      if (content?.trim()) parts.push({ type: 'text', text: content });
      if (images && images.length) {
        for (const img of images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } });
      }
      const last = messagesPayload[messagesPayload.length - 1];
      if (last && last.role === 'user' && last.content === content) messagesPayload[messagesPayload.length - 1] = { role: 'user', content: parts };
      else messagesPayload.push({ role: 'user', content: parts });

      const provider = session.connection.provider as 'openai' | 'azure_openai' | 'ollama';
      const baseUrl = session.connection.baseUrl.replace(/\/$/, '');
      const extraHeaders = session.connection.headersJson ? JSON.parse(session.connection.headersJson) : {};
      let body: any = { model: session.modelRawId, messages: messagesPayload, stream: false, temperature: 0.7 };
      const settingsRows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
      const settingsMap = settingsRows.reduce((m, r) => { (m as any)[r.key] = r.value; return m; }, {} as Record<string, string>);
      const retentionDaysRaw = settingsMap.chat_image_retention_days || process.env.CHAT_IMAGE_RETENTION_DAYS || `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`;
      const retentionDaysParsed = Number.parseInt(retentionDaysRaw, 10);
      cleanupExpiredChatImages(Number.isFinite(retentionDaysParsed) ? retentionDaysParsed : CHAT_IMAGE_DEFAULT_RETENTION_DAYS).catch((error) => {
        console.warn('[chat] cleanupExpiredChatImages', error);
      });
      const providerTimeoutMs = parseInt(settingsMap.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000');
      const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { reasoningEnabled: true, reasoningEffort: true, ollamaThink: true } });
      const ren = typeof payload?.reasoningEnabled === 'boolean'
        ? payload.reasoningEnabled
        : (sess?.reasoningEnabled ?? ((settingsMap.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false'));
      const ref = (payload?.reasoningEffort || sess?.reasoningEffort || (settingsMap.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || '')).toString();
      const otk = typeof payload?.ollamaThink === 'boolean'
        ? payload.ollamaThink
        : ((sess?.ollamaThink ?? ((settingsMap.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true')) as boolean);
      if (ren && ref) body.reasoning_effort = ref;
      if (ren && otk) body.think = true;

      let url = '';
      if (provider === 'openai') {
        url = `${baseUrl}/chat/completions`;
      } else if (provider === 'azure_openai') {
        const v = session.connection.azureApiVersion || '2024-02-15-preview';
        url = `${baseUrl}/openai/deployments/${encodeURIComponent(session.modelRawId!)}/chat/completions?api-version=${encodeURIComponent(v)}`;
      } else if (provider === 'ollama') {
        url = `${baseUrl}/api/chat`;
        body = {
          model: session.modelRawId,
          messages: messagesPayload.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content?.map((p: any) => p.text).filter(Boolean).join('\n') })),
          stream: false,
        };
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(session.connection.authType === 'bearer' && decryptedApiKey ? { Authorization: `Bearer ${decryptedApiKey}` } : {}),
        ...extraHeaders,
      };
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
        });
        try {
          const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
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
          });
          return response;
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
          });
          throw error;
        }
      };
      const requestWithBackoff = async () => {
        const ac = new AbortController();
        const tout = setTimeout(() => ac.abort(new Error('provider timeout')), providerTimeoutMs);
        try {
          let r = await doOnce(ac.signal);
          if (r.status === 429) { await new Promise((rz) => setTimeout(rz, BACKOFF_429_MS)); r = await doOnce(ac.signal); }
          else if (r.status >= 500) { await new Promise((rz) => setTimeout(rz, BACKOFF_5XX_MS)); r = await doOnce(ac.signal); }
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
        });
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
      });
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
          if (typeof payload?.saveReasoning === 'boolean') return payload.saveReasoning;
          return true;
        })();
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
      });

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
            try { return (c.get('actor') as Actor | undefined)?.identifier; }
            catch { return undefined; }
          })(),
        },
        payload: {
          status: 500,
          error: (error as Error)?.message || String(error),
        },
      });
      return c.json<ApiResponse>({ success: false, error: 'Failed to process non-stream completion' }, 500);
    }
  });
};
