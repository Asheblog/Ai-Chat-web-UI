import {
  buildBlockedResearchToolResult,
  buildResearchPlanRequiredResult,
  buildResearchPlanTerminalChunk,
  createResearchPlanGateState,
  decideResearchToolBlock,
  markResearchPlanApproved,
} from '../research-plan-flow'

describe('research-plan-flow helpers', () => {
  it('blocks non-plan tools before approval and counts distinct iterations', () => {
    const state = createResearchPlanGateState()
    expect(decideResearchToolBlock(state, 'web_search', 0)).toEqual({ block: true, terminal: false })
    expect(decideResearchToolBlock(state, 'read_url', 0)).toEqual({ block: true, terminal: false })
    expect(state.blockedIterations.size).toBe(1)
    expect(decideResearchToolBlock(state, 'web_search', 1)).toEqual({ block: true, terminal: true })
  })

  it('never blocks research_plan itself or tools after approval', () => {
    const state = createResearchPlanGateState()
    expect(decideResearchToolBlock(state, 'research_plan', 0)).toEqual({ block: false, terminal: false })
    markResearchPlanApproved(state)
    expect(decideResearchToolBlock(state, 'web_search', 1)).toEqual({ block: false, terminal: false })
  })

  it('builds blocked and terminal tool results', () => {
    const toolCall = { id: 'call-1', function: { name: 'web_search', arguments: '{}' } }
    const blocked = buildBlockedResearchToolResult(toolCall, 'web_search')
    expect(blocked.message.tool_call_id).toBe('call-1')
    expect(JSON.parse(blocked.message.content)).toMatchObject({ error: expect.any(String) })

    const terminal = buildResearchPlanRequiredResult(toolCall, 'web_search')
    expect(terminal.termination?.code).toBe('research_plan_required')
  })

  it('builds terminal complete payloads', () => {
    expect(buildResearchPlanTerminalChunk('research_plan_cancelled')).toEqual({
      content: '深度研究已取消',
      streamStatus: 'cancelled',
    })
    expect(buildResearchPlanTerminalChunk('research_plan_expired').streamStatus).toBe('cancelled')
  })
})
