import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import { upsertAssistantMessageByClientId as defaultUpsert } from '../assistant-message-service'
import { BackendLogger as defaultLogger } from '../../../utils/logger'
import type { TaskTraceRecorder } from '../../../utils/task-trace'

export interface PersistProgressParams {
  assistantMessageId: number
  sessionId: number
  clientMessageId?: string | null
  content: string
  reasoning?: string | null
  status?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled'
  errorMessage?: string | null
  traceRecorder?: TaskTraceRecorder
}

export interface AssistantProgressServiceDeps {
  prisma?: typeof defaultPrisma
  upsertAssistantMessageByClientId?: typeof defaultUpsert
  logger?: Pick<typeof console, 'warn'>
}

export class AssistantProgressService {
  private prisma: typeof defaultPrisma
  private upsertAssistantMessageByClientId: typeof defaultUpsert
  private logger: Pick<typeof console, 'warn'>

  constructor(deps: AssistantProgressServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.upsertAssistantMessageByClientId =
      deps.upsertAssistantMessageByClientId ?? defaultUpsert
    this.logger = deps.logger ?? defaultLogger
  }

  async persistProgress(params: PersistProgressParams): Promise<{ messageId: number; recovered?: boolean }> {
    try {
      await this.prisma.message.update({
        where: { id: params.assistantMessageId },
        data: {
          content: params.content,
          streamCursor: params.content.length,
          streamStatus: params.status ?? 'streaming',
          streamReasoning:
            params.reasoning && params.reasoning.trim().length > 0 ? params.reasoning : null,
          streamError: params.errorMessage ?? null,
        },
      })
      params.traceRecorder?.log('db:persist_progress', {
        messageId: params.assistantMessageId,
        length: params.content.length,
        reasoningLength: params.reasoning?.length ?? 0,
        status: params.status ?? 'streaming',
      })
      return { messageId: params.assistantMessageId }
    } catch (error) {
      const isRecordMissing =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') ||
        (error as any)?.code === 'P2025'
      if (isRecordMissing) {
        const recoveredId = await this.upsertAssistantMessageByClientId({
          sessionId: params.sessionId,
          clientMessageId: params.clientMessageId,
          data: {
            content: params.content,
            streamCursor: params.content.length,
            streamStatus: params.status ?? 'streaming',
            streamReasoning:
              params.reasoning && params.reasoning.trim().length > 0 ? params.reasoning : null,
            streamError: params.errorMessage ?? null,
          },
        })
        if (recoveredId) {
          this.logger.warn?.('Assistant progress target missing, upserted placeholder record', {
            sessionId: params.sessionId,
            recoveredId,
          })
          params.traceRecorder?.log('db:persist_progress', {
            messageId: recoveredId,
            length: params.content.length,
            reasoningLength: params.reasoning?.length ?? 0,
            status: params.status ?? 'streaming',
            recovered: true,
          })
          return { messageId: recoveredId, recovered: true }
        }
      }
      this.logger.warn?.('Persist assistant progress failed', {
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : error,
      })
      return { messageId: params.assistantMessageId }
    }
  }
}

export const assistantProgressService = new AssistantProgressService()
