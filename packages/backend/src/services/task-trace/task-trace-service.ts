import type { LatexTrace, PrismaClient, TaskTrace } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'

export interface TaskTraceServiceDeps {
  prisma?: PrismaClient
}

export interface TaskTraceListParams {
  page: number
  pageSize: number
  sessionId?: number | null
  status?: string | null
  keyword?: string | null
}

export interface TaskTraceSummary {
  id: number
  sessionId: number | null
  messageId: number | null
  clientMessageId: string | null
  actor: string | null
  status: string | null
  traceLevel: string | null
  startedAt: Date | null
  endedAt: Date | null
  durationMs: number | null
  metadata: Record<string, any> | null
  eventCount: number | null
  latexTrace: {
    id: number
    status: string | null
    matchedBlocks: number | null
    unmatchedBlocks: number | null
    updatedAt: Date | null
  } | null
}

export interface TaskTraceDetail {
  trace: TaskTraceSummary & { logFilePath: string | null }
  latexTrace: (Omit<LatexTrace, 'metadata'> & { metadata: Record<string, any> | null }) | null
}

const parseJsonColumn = <T = any>(value: string | null | undefined): T | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export class TaskTraceService {
  private prisma: PrismaClient

  constructor(deps: TaskTraceServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
  }

  async listTraces(params: TaskTraceListParams): Promise<{ items: TaskTraceSummary[]; total: number }> {
    const where: any = {}
    if (params.sessionId) {
      where.sessionId = params.sessionId
    }
    if (params.status) {
      where.status = params.status
    }
    if (params.keyword) {
      where.OR = [
        { actor: { contains: params.keyword } },
        { clientMessageId: { contains: params.keyword } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.taskTrace.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          sessionId: true,
          messageId: true,
          clientMessageId: true,
          actor: true,
          status: true,
          traceLevel: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          metadata: true,
          eventCount: true,
          latexTrace: {
            select: {
              id: true,
              status: true,
              matchedBlocks: true,
              unmatchedBlocks: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.prisma.taskTrace.count({ where }),
    ])

    const items = rows.map<TaskTraceSummary>((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      messageId: row.messageId,
      clientMessageId: row.clientMessageId,
      actor: row.actor,
      status: row.status,
      traceLevel: row.traceLevel,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationMs: row.durationMs,
      metadata: parseJsonColumn(row.metadata),
      eventCount: row.eventCount,
      latexTrace: row.latexTrace
        ? {
            id: row.latexTrace.id,
            status: row.latexTrace.status,
            matchedBlocks: row.latexTrace.matchedBlocks,
            unmatchedBlocks: row.latexTrace.unmatchedBlocks,
            updatedAt: row.latexTrace.updatedAt,
          }
        : null,
    }))

    return { items, total }
  }

  async getTraceWithLatex(id: number): Promise<TaskTraceDetail | null> {
    const trace = await this.prisma.taskTrace.findUnique({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        messageId: true,
        clientMessageId: true,
        actor: true,
        status: true,
        traceLevel: true,
        startedAt: true,
        endedAt: true,
        durationMs: true,
        metadata: true,
        eventCount: true,
        logFilePath: true,
        latexTrace: {
          select: {
            id: true,
            status: true,
            matchedBlocks: true,
            unmatchedBlocks: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })
    if (!trace) return null

    return {
      trace: {
        id: trace.id,
        sessionId: trace.sessionId,
        messageId: trace.messageId,
        clientMessageId: trace.clientMessageId,
        actor: trace.actor,
        status: trace.status,
        traceLevel: trace.traceLevel,
        startedAt: trace.startedAt,
        endedAt: trace.endedAt,
        durationMs: trace.durationMs,
        metadata: parseJsonColumn(trace.metadata),
        eventCount: trace.eventCount,
        latexTrace: trace.latexTrace
          ? {
              id: trace.latexTrace.id,
              status: trace.latexTrace.status,
              matchedBlocks: trace.latexTrace.matchedBlocks,
              unmatchedBlocks: trace.latexTrace.unmatchedBlocks,
              updatedAt: trace.latexTrace.updatedAt,
            }
          : null,
        logFilePath: trace.logFilePath,
      },
      latexTrace: trace.latexTrace
        ? ({
            ...trace.latexTrace,
            metadata: parseJsonColumn(trace.latexTrace.metadata),
          } as TaskTraceDetail['latexTrace'])
        : null,
    }
  }
}

export const taskTraceService = new TaskTraceService()
