import type { LatexTrace, PrismaClient, TaskTrace } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { unlink as defaultUnlink } from 'node:fs/promises'

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
  private unlink: typeof defaultUnlink

  constructor(deps: TaskTraceServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.unlink = defaultUnlink
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

  async getLatexTrace(taskTraceId: number): Promise<LatexTrace & { metadata: Record<string, any> | null } | null> {
    const latex = await this.prisma.latexTrace.findUnique({
      where: { taskTraceId },
      select: {
        id: true,
        taskTraceId: true,
        matchedBlocks: true,
        unmatchedBlocks: true,
        status: true,
        metadata: true,
        logFilePath: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!latex) return null
    return {
      ...latex,
      metadata: parseJsonColumn(latex.metadata),
    }
  }

  async deleteLatexTrace(taskTraceId: number): Promise<{ deleted: boolean }> {
    const latex = await this.prisma.latexTrace.findUnique({
      where: { taskTraceId },
      select: { id: true, logFilePath: true },
    })
    if (!latex) {
      return { deleted: false }
    }
    await this.prisma.latexTrace.delete({ where: { taskTraceId } })
    if (latex.logFilePath) {
      await this.safeUnlink(latex.logFilePath)
    }
    return { deleted: true }
  }

  async deleteTrace(id: number): Promise<{ deleted: boolean }> {
    const trace = await this.prisma.taskTrace.findUnique({
      where: { id },
      select: { logFilePath: true, latexTrace: { select: { logFilePath: true } } },
    })
    if (!trace) {
      return { deleted: false }
    }
    await this.prisma.taskTrace.delete({ where: { id } })
    if (trace.logFilePath) {
      await this.safeUnlink(trace.logFilePath)
    }
    if (trace.latexTrace?.logFilePath) {
      await this.safeUnlink(trace.latexTrace.logFilePath)
    }
    return { deleted: true }
  }

  async deleteAllTraces(): Promise<{ deleted: number }> {
    const targets = await this.prisma.taskTrace.findMany({
      select: {
        id: true,
        logFilePath: true,
        latexTrace: { select: { logFilePath: true } },
      },
    })
    if (targets.length === 0) {
      return { deleted: 0 }
    }
    await this.prisma.taskTrace.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } })
    await this.removeFiles(
      targets.flatMap((item) => [item.logFilePath, item.latexTrace?.logFilePath]),
    )
    return { deleted: targets.length }
  }

  async cleanupTraces(retentionDays: number, now: () => number = () => Date.now()): Promise<{
    deleted: number
    retentionDays: number
  }> {
    const cutoff = new Date(now() - retentionDays * 24 * 60 * 60 * 1000)
    const targets = await this.prisma.taskTrace.findMany({
      where: { startedAt: { lt: cutoff } },
      select: {
        id: true,
        logFilePath: true,
        latexTrace: { select: { logFilePath: true } },
      },
    })
    if (targets.length === 0) {
      return { deleted: 0, retentionDays }
    }
    await this.prisma.taskTrace.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } })
    await this.removeFiles(
      targets.flatMap((item) => [item.logFilePath, item.latexTrace?.logFilePath]),
    )
    return { deleted: targets.length, retentionDays }
  }

  private async removeFiles(paths: Array<string | null | undefined>) {
    const valid = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    await Promise.all(valid.map((file) => this.safeUnlink(file)))
  }

  private async safeUnlink(file: string) {
    try {
      await this.unlink(file)
    } catch {
      // ignore file removal errors
    }
  }
}

let taskTraceService = new TaskTraceService()

export const setTaskTraceService = (service: TaskTraceService) => {
  taskTraceService = service
}

export { taskTraceService }
