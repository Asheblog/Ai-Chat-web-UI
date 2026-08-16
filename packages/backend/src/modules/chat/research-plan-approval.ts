/**
 * 深度研究计划审批的内存注册表。
 *
 * 审批等待与当前 HTTP SSE 流同生命周期：不落库、不跨断线恢复。
 * 断线/取消/超时后条目被消费并从注册表移除。
 */

export type ResearchPlanApprovalDecision =
  | 'approve'
  | 'adjust'
  | 'cancel'
  | 'continue'
  | 'expired'

export interface ResearchPlanApprovalOutcome {
  decision: ResearchPlanApprovalDecision
  feedback?: string
  revision?: number
}

export interface PendingResearchPlanApproval {
  sessionId: number
  actorId: string
  toolCallId: string
  messageId: number | string | null
  clientMessageId: string | null
  assistantClientMessageId: string | null
  revision: number
  /** 由 waitForResearchPlanApproval 注入；endpoint 响应前必须已就绪 */
  resolve: ((outcome: ResearchPlanApprovalOutcome) => void) | null
  resolved: boolean
}

export class ResearchPlanApprovalError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode: number, code = 'RESEARCH_PLAN_APPROVAL_ERROR') {
    super(message)
    this.name = 'ResearchPlanApprovalError'
    this.statusCode = statusCode
    this.code = code
  }
}

const buildKey = (sessionId: number, toolCallId: string) =>
  `${sessionId}:${toolCallId}`

const pendingApprovals = new Map<string, PendingResearchPlanApproval>()

const settle = (
  entry: PendingResearchPlanApproval,
  outcome: ResearchPlanApprovalOutcome,
): boolean => {
  if (entry.resolved) return false
  entry.resolved = true
  pendingApprovals.delete(buildKey(entry.sessionId, entry.toolCallId))
  entry.resolve?.(outcome)
  return true
}

export const registerResearchPlanApproval = (input: {
  sessionId: number
  actorId: string
  toolCallId: string
  messageId?: number | string | null
  clientMessageId?: string | null
  assistantClientMessageId?: string | null
  revision?: number
}): PendingResearchPlanApproval => {
  const sessionId = Number(input.sessionId)
  const toolCallId = String(input.toolCallId || '').trim()
  if (!Number.isFinite(sessionId) || sessionId <= 0 || !toolCallId) {
    throw new ResearchPlanApprovalError(
      'sessionId and toolCallId are required',
      400,
      'RESEARCH_PLAN_APPROVAL_INVALID',
    )
  }
  const key = buildKey(sessionId, toolCallId)
  if (pendingApprovals.has(key)) {
    throw new ResearchPlanApprovalError(
      'A research plan approval is already pending for this tool call',
      409,
      'RESEARCH_PLAN_APPROVAL_DUPLICATE',
    )
  }
  const entry: PendingResearchPlanApproval = {
    sessionId,
    actorId: input.actorId,
    toolCallId,
    messageId: input.messageId ?? null,
    clientMessageId: input.clientMessageId ?? null,
    assistantClientMessageId: input.assistantClientMessageId ?? null,
    revision: Math.max(0, Math.min(2, Number(input.revision) || 0)),
    resolve: null,
    resolved: false,
  }
  pendingApprovals.set(key, entry)
  return entry
}

export const respondResearchPlanApproval = (input: {
  sessionId: number
  toolCallId: string
  actorIdentifier: string
  decision: 'approve' | 'adjust' | 'cancel' | 'continue'
  feedback?: string
}): { sessionId: number; toolCallId: string; revision: number } => {
  const entry = pendingApprovals.get(
    buildKey(Number(input.sessionId), String(input.toolCallId || '').trim()),
  )
  if (!entry) {
    throw new ResearchPlanApprovalError(
      'Research plan approval not found or already expired',
      404,
      'RESEARCH_PLAN_APPROVAL_NOT_FOUND',
    )
  }
  if (entry.actorId !== input.actorIdentifier) {
    throw new ResearchPlanApprovalError(
      'Only the session owner can respond to this research plan',
      403,
      'RESEARCH_PLAN_APPROVAL_FORBIDDEN',
    )
  }
  const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : ''
  if (input.decision === 'adjust' && !feedback) {
    throw new ResearchPlanApprovalError(
      'feedback is required when adjusting a research plan',
      400,
      'RESEARCH_PLAN_APPROVAL_FEEDBACK_REQUIRED',
    )
  }
  settle(entry, {
    decision: input.decision,
    feedback: feedback || undefined,
    revision: entry.revision,
  })
  return {
    sessionId: entry.sessionId,
    toolCallId: entry.toolCallId,
    revision: entry.revision,
  }
}

/**
 * 等待审批结果；超时/断线都返回终态，调用方自行决定如何收尾。
 */
export const waitForResearchPlanApproval = (
  entry: PendingResearchPlanApproval,
  options: { timeoutMs: number; signal?: AbortSignal | null },
): Promise<ResearchPlanApprovalOutcome> =>
  new Promise((resolve) => {
    let settled = false
    const finish = (outcome: ResearchPlanApprovalOutcome) => {
      if (settled) return
      settled = true
      settle(entry, outcome)
      cleanup()
      resolve(outcome)
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort)
      }
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = () => finish({ decision: 'cancel', revision: entry.revision })
    if (options.signal?.aborted) {
      finish({ decision: 'cancel', revision: entry.revision })
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      finish({ decision: 'expired', revision: entry.revision })
    }, options.timeoutMs)
    entry.resolve = finish
  })

export const cancelResearchPlanApprovalsForSession = (sessionId: number): number => {
  let cancelled = 0
  for (const [key, entry] of Array.from(pendingApprovals.entries())) {
    if (entry.sessionId !== Number(sessionId)) continue
    pendingApprovals.delete(key)
    if (settle(entry, { decision: 'cancel', revision: entry.revision })) {
      cancelled += 1
    }
  }
  return cancelled
}

export const cancelResearchPlanApprovalByMessage = (input: {
  sessionId: number
  messageId?: number | string | null
  clientMessageId?: string | null
  assistantClientMessageId?: string | null
}): number => {
  const sessionId = Number(input.sessionId)
  const targetMessageId =
    typeof input.messageId === 'number' || typeof input.messageId === 'string'
      ? String(input.messageId)
      : null
  const clientMessageId = input.clientMessageId ?? null
  const assistantClientMessageId = input.assistantClientMessageId ?? null
  let cancelled = 0
  for (const [key, entry] of Array.from(pendingApprovals.entries())) {
    if (entry.sessionId !== sessionId) continue
    const matchesMessage =
      targetMessageId != null && entry.messageId != null
        ? String(entry.messageId) === targetMessageId
        : false
    const matchesClient =
      Boolean(clientMessageId) &&
      (entry.clientMessageId === clientMessageId ||
        entry.assistantClientMessageId === clientMessageId)
    const matchesAssistant =
      Boolean(assistantClientMessageId) &&
      entry.assistantClientMessageId === assistantClientMessageId
    if (!matchesMessage && !matchesClient && !matchesAssistant) continue
    pendingApprovals.delete(key)
    if (settle(entry, { decision: 'cancel', revision: entry.revision })) {
      cancelled += 1
    }
  }
  return cancelled
}

export const getPendingResearchPlanApprovalCount = (): number =>
  pendingApprovals.size
