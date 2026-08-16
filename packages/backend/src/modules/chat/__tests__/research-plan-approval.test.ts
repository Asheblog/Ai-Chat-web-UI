import {
  cancelResearchPlanApprovalByMessage,
  cancelResearchPlanApprovalsForSession,
  registerResearchPlanApproval,
  respondResearchPlanApproval,
  ResearchPlanApprovalError,
  waitForResearchPlanApproval,
} from '../research-plan-approval'

const flushTimers = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  jest.useRealTimers()
  cancelResearchPlanApprovalsForSession(1)
  cancelResearchPlanApprovalsForSession(2)
})

describe('research-plan-approval', () => {
  it('resolves approve decisions from the registry', async () => {
    const entry = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-plan-1',
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 5000 })

    const responded = respondResearchPlanApproval({
      sessionId: 1,
      toolCallId: 'call-plan-1',
      actorIdentifier: 'actor:1',
      decision: 'approve',
    })

    await expect(waiting).resolves.toEqual({ decision: 'approve', revision: 0 })
    expect(responded).toEqual({ sessionId: 1, toolCallId: 'call-plan-1', revision: 0 })
  })

  it('returns typed not-found for unknown approvals', () => {
    expect(() =>
      respondResearchPlanApproval({
        sessionId: 1,
        toolCallId: 'missing',
        actorIdentifier: 'actor:1',
        decision: 'approve',
      }),
    ).toThrow(ResearchPlanApprovalError)
  })

  it('rejects duplicate pending approvals for the same tool call', () => {
    registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-dup',
    })
    expect(() =>
      registerResearchPlanApproval({
        sessionId: 1,
        actorId: 'actor:1',
        toolCallId: 'call-dup',
      }),
    ).toThrow(ResearchPlanApprovalError)
  })

  it('forbids a different actor from responding', async () => {
    const entry = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-owner',
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 5000 })
    expect(() =>
      respondResearchPlanApproval({
        sessionId: 1,
        toolCallId: 'call-owner',
        actorIdentifier: 'actor:2',
        decision: 'approve',
      }),
    ).toThrow(ResearchPlanApprovalError)
    cancelResearchPlanApprovalsForSession(1)
    await expect(waiting).resolves.toMatchObject({ decision: 'cancel' })
  })

  it('requires feedback for adjust decisions', async () => {
    const entry = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-adjust',
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 5000 })
    expect(() =>
      respondResearchPlanApproval({
        sessionId: 1,
        toolCallId: 'call-adjust',
        actorIdentifier: 'actor:1',
        decision: 'adjust',
        feedback: '  ',
      }),
    ).toThrow(ResearchPlanApprovalError)
    respondResearchPlanApproval({
      sessionId: 1,
      toolCallId: 'call-adjust',
      actorIdentifier: 'actor:1',
      decision: 'adjust',
      feedback: '重点补充成本数据',
    })
    await expect(waiting).resolves.toMatchObject({
      decision: 'adjust',
      feedback: '重点补充成本数据',
    })
  })

  it('cancels all pending approvals for a session', async () => {
    const first = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-a',
    })
    const second = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-b',
    })
    const firstWait = waitForResearchPlanApproval(first, { timeoutMs: 5000 })
    const secondWait = waitForResearchPlanApproval(second, { timeoutMs: 5000 })
    expect(cancelResearchPlanApprovalsForSession(1)).toBe(2)
    await expect(firstWait).resolves.toMatchObject({ decision: 'cancel' })
    await expect(secondWait).resolves.toMatchObject({ decision: 'cancel' })
  })

  it('cancels approvals by assistant message id', async () => {
    const entry = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'actor:1',
      toolCallId: 'call-msg',
      messageId: 42,
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 5000 })
    expect(
      cancelResearchPlanApprovalByMessage({
        sessionId: 1,
        messageId: 42,
      }),
    ).toBe(1)
    await expect(waiting).resolves.toMatchObject({ decision: 'cancel' })
  })

  it('expires a pending approval after the timeout', async () => {
    jest.useFakeTimers()
    const entry = registerResearchPlanApproval({
      sessionId: 2,
      actorId: 'actor:1',
      toolCallId: 'call-expire',
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 1000 })
    jest.advanceTimersByTime(1000)
    await expect(waiting).resolves.toMatchObject({ decision: 'expired' })
    expect(() =>
      respondResearchPlanApproval({
        sessionId: 2,
        toolCallId: 'call-expire',
        actorIdentifier: 'actor:1',
        decision: 'approve',
      }),
    ).toThrow(ResearchPlanApprovalError)
    jest.useRealTimers()
  })
})
