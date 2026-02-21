import { prisma as defaultPrisma } from '../../db'

export interface SkillApprovalServiceDeps {
  prisma?: typeof defaultPrisma
}

export interface CreateApprovalRequestInput {
  skillId: number
  versionId?: number | null
  bindingId?: number | null
  sessionId?: number | null
  battleRunId?: number | null
  messageId?: number | null
  toolName: string
  toolCallId?: string | null
  reason?: string | null
  requestPayloadJson?: string
  requestedByActor: string
  expiresInMs?: number
}

export class SkillApprovalService {
  private prisma: typeof defaultPrisma

  constructor(deps: SkillApprovalServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
  }

  async createRequest(input: CreateApprovalRequestInput) {
    const expiresInMs = Math.max(5_000, input.expiresInMs ?? 90_000)
    const expiresAt = new Date(Date.now() + expiresInMs)
    return (this.prisma as any).skillApprovalRequest.create({
      data: {
        skillId: input.skillId,
        versionId: input.versionId ?? null,
        bindingId: input.bindingId ?? null,
        sessionId: input.sessionId ?? null,
        battleRunId: input.battleRunId ?? null,
        messageId: input.messageId ?? null,
        toolName: input.toolName,
        toolCallId: input.toolCallId ?? null,
        reason: input.reason ?? null,
        requestPayloadJson: input.requestPayloadJson ?? '{}',
        requestedByActor: input.requestedByActor,
        status: 'pending',
        expiresAt,
      },
    })
  }

  async respondApproval(input: {
    requestId: number
    approved: boolean
    decidedByUserId: number
    note?: string
  }) {
    const now = new Date()
    return (this.prisma as any).skillApprovalRequest.update({
      where: { id: input.requestId },
      data: {
        status: input.approved ? 'approved' : 'denied',
        decidedAt: now,
        decidedByUserId: input.decidedByUserId,
        decisionNote: input.note ?? null,
      },
    })
  }

  async markExpiredPendingRequests() {
    const now = new Date()
    await (this.prisma as any).skillApprovalRequest.updateMany({
      where: {
        status: 'pending',
        expiresAt: { not: null, lte: now },
      },
      data: {
        status: 'expired',
        decidedAt: now,
      },
    })
  }

  async hasSessionApprovedSkill(sessionId: number, skillId: number): Promise<boolean> {
    const record = await (this.prisma as any).skillApprovalRequest.findFirst({
      where: {
        sessionId,
        skillId,
        status: 'approved',
      },
      select: { id: true },
      orderBy: { decidedAt: 'desc' },
    })
    return Boolean(record)
  }

  async waitForDecision(input: {
    requestId: number
    pollIntervalMs?: number
    timeoutMs?: number
  }): Promise<'approved' | 'denied' | 'expired'> {
    const pollIntervalMs = Math.max(200, input.pollIntervalMs ?? 1000)
    const timeoutMs = Math.max(1000, input.timeoutMs ?? 95_000)
    const startedAt = Date.now()

    while (Date.now() - startedAt <= timeoutMs) {
      const row = await (this.prisma as any).skillApprovalRequest.findUnique({
        where: { id: input.requestId },
        select: { status: true, expiresAt: true },
      })
      if (!row) return 'expired'
      if (row.status === 'approved') return 'approved'
      if (row.status === 'denied') return 'denied'
      if (row.status === 'expired') return 'expired'

      const isExpired = row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()
      if (isExpired) {
        await (this.prisma as any).skillApprovalRequest.updateMany({
          where: { id: input.requestId, status: 'pending' },
          data: {
            status: 'expired',
            decidedAt: new Date(),
          },
        })
        return 'expired'
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    await (this.prisma as any).skillApprovalRequest.updateMany({
      where: { id: input.requestId, status: 'pending' },
      data: {
        status: 'expired',
        decidedAt: new Date(),
      },
    })
    return 'expired'
  }
}

export const skillApprovalService = new SkillApprovalService()
