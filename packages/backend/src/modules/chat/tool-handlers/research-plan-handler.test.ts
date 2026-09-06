import { ResearchPlanToolHandler } from './research-plan-handler'
import { parseResearchPlanArgs } from '../research-plan-tool'
import type {
  DeepResearchPlanHandlerConfig,
  ResearchPlanApprovalGateInput,
  ResearchPlanApprovalGateResult,
  ToolCallContext,
} from '../../../agent-runtime/tool-handler-types'

const makeContext = (): ToolCallContext & { events: Record<string, unknown>[] } => {
  const events: Record<string, unknown>[] = []
  return {
    sessionId: 1,
    actorIdentifier: 'actor:1',
    messageId: 10,
    requestSignal: undefined,
    emitReasoning: () => {},
    sendToolEvent: (payload) => events.push(payload),
    events,
  } as any
}

const validArgs = {
  title: '2026 年 AI 芯片竞争格局',
  objective: '梳理主要厂商的路线图、产能与市场格局',
  sub_questions: [
    { question: '头部厂商的路线图是什么？', keywords: ['AI 芯片', '路线图'] },
    { question: '产能与供应链如何分布？', keywords: ['产能', '台积电'] },
    { question: '市场格局与份额如何？', keywords: ['市场份额'] },
  ],
  estimated_tool_rounds: { min: 3, max: 6 },
}

const makeHandler = (
  gate: DeepResearchPlanHandlerConfig['approvalGate'],
): ResearchPlanToolHandler =>
  new ResearchPlanToolHandler({
    enabled: true,
    approvalGate: gate,
    approvalTimeoutMs: 300000,
    resolveRevision: () => 0,
  })

const gateWith = (
  result: ResearchPlanApprovalGateResult,
): { gate: DeepResearchPlanHandlerConfig['approvalGate']; calls: ResearchPlanApprovalGateInput[] } => {
  const calls: ResearchPlanApprovalGateInput[] = []
  return {
    gate: {
      waitForDecision: async (input) => {
        calls.push(input)
        return result
      },
    },
    calls,
  }
}

describe('parseResearchPlanArgs', () => {
  it('parses a valid plan', () => {
    const result = parseResearchPlanArgs(validArgs)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.sub_questions).toHaveLength(3)
    expect(result.plan.estimated_tool_rounds).toEqual({ min: 3, max: 6 })
    expect(result.plan.deliverable).toBe('markdown_report_with_citations_pdf')
  })

  it('rejects too few subquestions', () => {
    const result = parseResearchPlanArgs({
      ...validArgs,
      sub_questions: validArgs.sub_questions.slice(0, 2),
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects too many subquestions instead of silently truncating', () => {
    const result = parseResearchPlanArgs({
      ...validArgs,
      sub_questions: [
        ...validArgs.sub_questions,
        { question: 'q4', keywords: ['k4'] },
        { question: 'q5', keywords: ['k5'] },
        { question: 'q6', keywords: ['k6'] },
        { question: 'q7', keywords: ['k7'] },
      ],
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects missing estimated_tool_rounds', () => {
    const { estimated_tool_rounds, ...withoutRounds } = validArgs as any
    const result = parseResearchPlanArgs(withoutRounds)
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects empty keywords', () => {
    const result = parseResearchPlanArgs({
      ...validArgs,
      sub_questions: [
        { question: 'q1', keywords: [] },
        { question: 'q2', keywords: ['k'] },
        { question: 'q3', keywords: ['k'] },
      ],
    })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('ResearchPlanToolHandler', () => {
  it('emits a pending event and approves', async () => {
    const { gate } = gateWith({ decision: 'approve', revision: 0 })
    const handler = makeHandler(gate)
    const context = makeContext()

    const result = await handler.handle(
      { id: 'call-1', function: { name: 'research_plan', arguments: JSON.stringify(validArgs) } },
      validArgs,
      context,
    )

    expect(result.termination).toBeUndefined()
    expect(JSON.parse(result.message.content)).toMatchObject({ status: 'approved' })
    expect(context.events[0]).toMatchObject({
      id: 'call-1',
      tool: 'research_plan',
      stage: 'start',
      status: 'pending',
      phase: 'pending_approval',
    })
    expect((context.events[0] as any).details.plan.title).toBe(validArgs.title)
    expect(context.events[1]).toMatchObject({
      stage: 'result',
      status: 'success',
      phase: 'result',
    })
  })

  it('returns revision feedback for adjust', async () => {
    const { gate, calls } = gateWith({
      decision: 'adjust',
      feedback: '请补充成本数据',
      revision: 0,
    })
    const handler = makeHandler(gate)
    const result = await handler.handle(
      { id: 'call-2', function: { name: 'research_plan', arguments: JSON.stringify(validArgs) } },
      validArgs,
      makeContext(),
    )

    expect(JSON.parse(result.message.content)).toMatchObject({
      status: 'revision_requested',
      feedback: '请补充成本数据',
    })
    expect(calls).toHaveLength(1)
  })

  it('terminates when cancelled', async () => {
    const { gate } = gateWith({ decision: 'cancel', revision: 0 })
    const handler = makeHandler(gate)
    const context = makeContext()

    const result = await handler.handle(
      { id: 'call-3', function: { name: 'research_plan', arguments: JSON.stringify(validArgs) } },
      validArgs,
      context,
    )

    expect(result.termination).toEqual({
      code: 'research_plan_cancelled',
      message: '深度研究已取消',
    })
    expect(context.events[1]).toMatchObject({
      stage: 'error',
      status: 'rejected',
      phase: 'rejected',
    })
  })

  it('terminates when expired', async () => {
    const { gate } = gateWith({ decision: 'expired', revision: 0 })
    const handler = makeHandler(gate)
    const result = await handler.handle(
      { id: 'call-4', function: { name: 'research_plan', arguments: JSON.stringify(validArgs) } },
      validArgs,
      makeContext(),
    )

    expect(result.termination?.code).toBe('research_plan_expired')
  })

  it('returns an error for invalid plans', async () => {
    const { gate } = gateWith({ decision: 'approve', revision: 0 })
    const handler = makeHandler(gate)
    const context = makeContext()
    const result = await handler.handle(
      { id: 'call-5', function: { name: 'research_plan', arguments: '{}' } },
      {},
      context,
    )

    expect(JSON.parse(result.message.content)).toMatchObject({ error: expect.any(String) })
    expect(context.events[0]).toMatchObject({ stage: 'error', status: 'error' })
  })
})
