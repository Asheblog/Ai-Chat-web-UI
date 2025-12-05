import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import { ensureAssistantClientMessageId, STREAMING_PLACEHOLDER_STATUSES } from './stream-state';

export type AssistantMessageWriteData = Omit<
  Prisma.MessageUncheckedCreateInput,
  'id' | 'sessionId' | 'role' | 'clientMessageId'
>;

type DbClient = Prisma.TransactionClient | typeof prisma;

const cleanupStaleAssistantPlaceholders = async ({
  sessionId,
  keepMessageId,
  clientMessageId,
  db = prisma,
}: {
  sessionId: number;
  keepMessageId: number;
  clientMessageId: string;
  db?: DbClient;
}) => {
  try {
    const { count } = await db.message.deleteMany({
      where: {
        sessionId,
        role: 'assistant',
        id: { not: keepMessageId },
        streamStatus: { in: STREAMING_PLACEHOLDER_STATUSES },
        OR: [
          { clientMessageId },
          { clientMessageId: null },
        ],
      },
    });
    if (count > 0) {
      log.warn('Removed stale assistant placeholders', {
        sessionId,
        clientMessageId,
        removed: count,
      });
    }
  } catch (cleanupError) {
    log.warn('Failed to cleanup assistant placeholders', {
      sessionId,
      clientMessageId,
      error: cleanupError instanceof Error ? cleanupError.message : cleanupError,
    });
  }
};

export const upsertAssistantMessageByClientId = async ({
  sessionId,
  clientMessageId,
  data,
  db = prisma,
}: {
  sessionId: number;
  clientMessageId?: string | null;
  data: AssistantMessageWriteData;
  db?: DbClient;
}): Promise<number | null> => {
  const normalizedClientMessageId = ensureAssistantClientMessageId(clientMessageId);
  try {
    const upserted = await db.message.upsert({
      where: {
        sessionId_clientMessageId: {
          sessionId,
          clientMessageId: normalizedClientMessageId,
        },
      },
      update: data,
      create: {
        sessionId,
        role: 'assistant',
        clientMessageId: normalizedClientMessageId,
        ...data,
      },
    });
    await cleanupStaleAssistantPlaceholders({
      sessionId,
      keepMessageId: upserted.id,
      clientMessageId: normalizedClientMessageId,
      db,
    });
    return upserted.id;
  } catch (error) {
    log.warn('Upsert assistant message failed', {
      sessionId,
      clientMessageId: normalizedClientMessageId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
};

export interface PersistAssistantFinalResponseParams {
  sessionId: number;
  existingMessageId: number | null;
  assistantClientMessageId?: string | null;
  fallbackClientMessageId?: string | null;
  parentMessageId?: number | null;
  replyHistoryLimit?: number | null;
  content: string;
  streamReasoning?: string | null;
  reasoning?: string | null;
  reasoningDurationSeconds?: number | null;
  streamError?: string | null;
  toolLogsJson?: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    contextLimit?: number | null;
  };
  metrics?: {
    firstTokenLatencyMs?: number | null;
    responseTimeMs?: number | null;
    tokensPerSecond?: number | null;
  };
  model?: string | null;
  provider?: string | null;
}

const clampReplyHistoryLimit = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    return Math.max(1, Math.min(20, normalized))
  }
  return 5
}

const ensureVariantWindow = async ({
  db,
  sessionId,
  parentMessageId,
  targetMessageId,
  replyHistoryLimit,
}: {
  db: DbClient
  sessionId: number
  parentMessageId: number
  targetMessageId: number
  replyHistoryLimit?: number | null
}) => {
  const limit = clampReplyHistoryLimit(replyHistoryLimit)
  const siblings = await db.message.findMany({
    where: { sessionId, parentMessageId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, createdAt: true, variantIndex: true },
  })

  if (!siblings.some((msg) => msg.id === targetMessageId)) {
    const target = await db.message.findUnique({
      where: { id: targetMessageId },
      select: { id: true, createdAt: true, variantIndex: true },
    })
    if (target) {
      siblings.push(target)
      siblings.sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime()
        if (diff !== 0) return diff
        return a.id - b.id
      })
    }
  }

  if (siblings.length === 0) {
    return
  }

  const overflow = Math.max(0, siblings.length - limit)
  const removalIds: number[] = []
  if (overflow > 0) {
    const removable = siblings.filter((s) => s.id !== targetMessageId).slice(0, overflow)
    removalIds.push(...removable.map((s) => s.id))
  }

  const survivors = siblings.filter((s) => !removalIds.includes(s.id))
  let index = 1
  for (const survivor of survivors) {
    if (survivor.variantIndex !== index) {
      await db.message.update({
        where: { id: survivor.id },
        data: { variantIndex: index },
      })
    }
    index += 1
  }

  if (removalIds.length > 0) {
    await db.usageMetric.deleteMany({ where: { messageId: { in: removalIds } } })
    await db.message.deleteMany({ where: { id: { in: removalIds } } })
  }
}

export const persistAssistantFinalResponse = async ({
  sessionId,
  existingMessageId,
  assistantClientMessageId,
  fallbackClientMessageId,
  parentMessageId,
  replyHistoryLimit,
  content,
  streamReasoning,
  reasoning,
  reasoningDurationSeconds,
  streamError,
  toolLogsJson,
  usage,
  metrics,
  model,
  provider,
}: PersistAssistantFinalResponseParams): Promise<number | null> => {
  const trimmedContent = typeof content === 'string' ? content.trim() : '';
  if (!trimmedContent) {
    return existingMessageId;
  }

  const data: AssistantMessageWriteData = {
    content: trimmedContent,
    streamStatus: 'done',
    streamCursor: trimmedContent.length,
    streamReasoning: streamReasoning?.trim().length ? streamReasoning.trim() : null,
    streamError: streamError ?? null,
    reasoning: reasoning?.trim().length ? reasoning.trim() : null,
    reasoningDurationSeconds:
      reasoning && reasoning.trim().length ? reasoningDurationSeconds ?? null : null,
    toolLogsJson: toolLogsJson ?? null,
    parentMessageId: parentMessageId ?? null,
  };

  try {
    const persistedId = await prisma.$transaction(async (tx) => {
      let targetId = existingMessageId;
      if (targetId) {
        try {
          await tx.message.update({
            where: { id: targetId },
            data,
          });
        } catch (error) {
          const isMissing =
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
          if (isMissing) {
            targetId = null;
          } else {
            throw error;
          }
        }
      }

      if (!targetId) {
        targetId =
          (await upsertAssistantMessageByClientId({
            sessionId,
            clientMessageId: assistantClientMessageId ?? fallbackClientMessageId,
            data,
            db: tx,
          })) ?? null;
      }

      if (!targetId) {
        return null;
      }

      await tx.usageMetric.deleteMany({ where: { messageId: targetId } });
      await tx.usageMetric.create({
        data: {
          sessionId,
          messageId: targetId,
          model: model || 'unknown',
          provider: provider ?? undefined,
          promptTokens: Math.max(0, usage.promptTokens || 0),
          completionTokens: Math.max(0, usage.completionTokens || 0),
          totalTokens: Math.max(0, usage.totalTokens || 0),
          contextLimit:
            typeof usage.contextLimit === 'number' ? usage.contextLimit : usage.contextLimit ?? null,
          firstTokenLatencyMs:
            typeof metrics?.firstTokenLatencyMs === 'number'
              ? Math.max(0, Math.round(metrics.firstTokenLatencyMs))
              : null,
          responseTimeMs:
            typeof metrics?.responseTimeMs === 'number'
              ? Math.max(0, Math.round(metrics.responseTimeMs))
              : null,
          tokensPerSecond:
            typeof metrics?.tokensPerSecond === 'number' && Number.isFinite(metrics.tokensPerSecond)
              ? metrics.tokensPerSecond
              : null,
        },
      });

      if (parentMessageId) {
        await ensureVariantWindow({
          db: tx,
          sessionId,
          parentMessageId,
          targetMessageId: targetId,
          replyHistoryLimit,
        });
      } else {
        await tx.message.update({
          where: { id: targetId },
          data: { variantIndex: null, parentMessageId: null },
        });
      }

      return targetId;
    });

    return persistedId;
  } catch (error) {
    log.error('Persist assistant final response failed', {
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
};
