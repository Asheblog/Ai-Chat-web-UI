import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { BackendLogger as log } from '../../utils/logger';
import { ensureAssistantClientMessageId, STREAMING_PLACEHOLDER_STATUSES } from './stream-state';

export type AssistantMessageWriteData = Omit<
  Prisma.MessageUncheckedCreateInput,
  'id' | 'sessionId' | 'role' | 'clientMessageId'
>;

const cleanupStaleAssistantPlaceholders = async ({
  sessionId,
  keepMessageId,
  clientMessageId,
}: {
  sessionId: number;
  keepMessageId: number;
  clientMessageId: string;
}) => {
  try {
    const { count } = await prisma.message.deleteMany({
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
}: {
  sessionId: number;
  clientMessageId?: string | null;
  data: AssistantMessageWriteData;
}): Promise<number | null> => {
  const normalizedClientMessageId = ensureAssistantClientMessageId(clientMessageId);
  try {
    const upserted = await prisma.message.upsert({
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
