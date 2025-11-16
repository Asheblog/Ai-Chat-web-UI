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
  model?: string | null;
  provider?: string | null;
}

export const persistAssistantFinalResponse = async ({
  sessionId,
  existingMessageId,
  assistantClientMessageId,
  fallbackClientMessageId,
  content,
  streamReasoning,
  reasoning,
  reasoningDurationSeconds,
  streamError,
  toolLogsJson,
  usage,
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
        },
      });

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
