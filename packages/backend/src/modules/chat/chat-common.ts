import { z } from 'zod';
import { prisma } from '../../db';
import { ensureAnonymousSession } from '../../utils/actor';
import type { Actor, UsageQuotaSnapshot } from '../../types';
import { getAppConfig } from '../../config/app-config';

const appConfig = getAppConfig();

export const BACKOFF_429_MS = appConfig.retry.upstream429Ms;
export const BACKOFF_5XX_MS = appConfig.retry.upstream5xxMs;
export const MESSAGE_DEDUPE_WINDOW_MS = appConfig.chat.messageDedupeWindowMs;

export const sendMessageSchema = z.object({
  sessionId: z.number().int().positive(),
  content: z.string().max(10000).optional(),
  replyToMessageId: z.number().int().positive().optional(),
  replyToClientMessageId: z.string().min(1).max(128).optional(),
  images: z.array(z.object({ data: z.string().min(1), mime: z.string().min(1) })).max(4).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  ollamaThink: z.boolean().optional(),
  saveReasoning: z.boolean().optional(),
  clientMessageId: z.string().min(1).max(128).optional(),
  contextEnabled: z.boolean().optional(),
  features: z
    .object({
      web_search: z.boolean().optional(),
    })
    .optional(),
  traceEnabled: z.boolean().optional(),
}).refine((value) => {
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0
  const hasReference =
    typeof value.replyToMessageId === 'number' ||
    (typeof value.replyToClientMessageId === 'string' && value.replyToClientMessageId.trim().length > 0)
  return hasContent || hasReference
}, { message: 'content or replyToMessageId is required' });

export const cancelStreamSchema = z.object({
  sessionId: z.number().int().positive(),
  clientMessageId: z.string().min(1).max(128).optional(),
  messageId: z.number().int().positive().optional(),
});

export const sessionOwnershipClause = (actor: Actor) =>
  actor.type === 'user'
    ? { userId: actor.id }
    : { anonymousKey: actor.key };

export const extendAnonymousSession = async (actor: Actor, sessionId: number | null) => {
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

export class QuotaExceededError extends Error {
  snapshot: UsageQuotaSnapshot;

  constructor(snapshot: UsageQuotaSnapshot) {
    super('Daily quota exceeded');
    this.name = 'QuotaExceededError';
    this.snapshot = snapshot;
  }
}

export type ProviderChatCompletionResponse = {
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
