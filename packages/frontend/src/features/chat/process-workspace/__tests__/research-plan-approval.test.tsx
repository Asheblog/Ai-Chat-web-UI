import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProcessOperationDetail } from '../views/operation-detail'
import { buildProcessIndex } from '../model/process-model'
import type { ResearchPlanApprovalState, ResearchPlanPayload } from '@aichat/shared/chat-stream-contract'
import type { ToolEvent } from '@/types'

const plan: ResearchPlanPayload = {
  title: '中国新闻深度研究',
  objective: '按政策、经济、社会梳理本轮新闻',
  sub_questions: Array.from({ length: 8 }, (_, index) => ({ question: '子问题 ' + (index + 1), keywords: ['关键词' + index] })),
  estimated_tool_rounds: { min: 2, max: 4 },
}

const record = (approval: ResearchPlanApprovalState, override: Partial<ToolEvent> = {}) =>
  buildProcessIndex([
    {
      id: 'plan-call',
      callId: 'plan-call',
      sessionId: 1,
      messageId: 1,
      tool: 'research_plan',
      stage: 'start',
      status: 'pending',
      phase: 'pending_approval',
      createdAt: 1,
      details: { plan, approval },
      ...override,
    },
  ]).records[0]

afterEach(() => cleanup())

describe('研究计划审批（新工作区唯一入口）', () => {
  it('批准：透传 callId 与 revision', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn()
    render(
      <ProcessOperationDetail
        record={record({ kind: 'plan', revision: 2 })}
        canCommand
        commands={{ onResearchPlanDecision }}
      />,
    )
    expect(screen.getByText('中国新闻深度研究')).toBeInTheDocument()
    expect(screen.getByText('按政策、经济、社会梳理本轮新闻')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText(/其余 2 个子问题未在此展开/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '批准计划' }))
    expect(onResearchPlanDecision).toHaveBeenCalledWith({ callId: 'plan-call', decision: 'approve', revision: 2 })
  })

  it('调整：反馈必填，提交后带 feedback 且限长 2000', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn()
    render(
      <ProcessOperationDetail record={record({ kind: 'plan' })} canCommand commands={{ onResearchPlanDecision }} />,
    )
    await user.click(screen.getByRole('button', { name: '调整计划' }))
    const textarea = screen.getByLabelText('要调整的方向')
    expect(textarea).toHaveAttribute('maxLength', '2000')
    await user.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请先写清要调整的方向')
    expect(onResearchPlanDecision).not.toHaveBeenCalled()
    await user.type(textarea, '只保留政策与产业两条主线')
    await user.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))
    expect(onResearchPlanDecision).toHaveBeenCalledWith({
      callId: 'plan-call',
      decision: 'adjust',
      feedback: '只保留政策与产业两条主线',
      revision: undefined,
    })
  })

  it('搜索不可用：基于已有知识继续 → decision continue', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn()
    render(
      <ProcessOperationDetail
        record={record({ kind: 'search_unavailable' })}
        canCommand
        commands={{ onResearchPlanDecision }}
      />,
    )
    expect(screen.getByText('深度研究：联网搜索不可用')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '基于已有知识继续' }))
    expect(onResearchPlanDecision).toHaveBeenCalledWith({ callId: 'plan-call', decision: 'continue', revision: undefined })
  })

  it('取消：decision cancel，revision 原样透传', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn()
    render(
      <ProcessOperationDetail
        record={record({ kind: 'plan', revision: 3 })}
        canCommand
        commands={{ onResearchPlanDecision }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onResearchPlanDecision).toHaveBeenCalledWith({ callId: 'plan-call', decision: 'cancel', revision: 3 })
  })

  it('过期后重新发起：reason expired + 计划标题', async () => {
    const user = userEvent.setup()
    const onReissuePlan = vi.fn()
    render(
      <ProcessOperationDetail
        record={record({ kind: 'plan', decision: 'expired' }, { status: 'success', stage: 'result', phase: 'result' })}
        canCommand
        commands={{ onResearchPlanDecision: vi.fn(), onReissuePlan }}
      />,
    )
    expect(screen.getByText('审批结果：已过期')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新发起（使用原问题）' }))
    expect(onReissuePlan).toHaveBeenCalledWith({ reason: 'expired', planTitle: '中国新闻深度研究' })
  })

  it('调用中止后重新发起：reason aborted', async () => {
    const user = userEvent.setup()
    const onReissuePlan = vi.fn()
    render(
      <ProcessOperationDetail
        record={record({ kind: 'plan' }, { status: 'aborted', stage: 'error' })}
        canCommand
        commands={{ onReissuePlan }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '重新发起（使用原问题）' }))
    expect(onReissuePlan).toHaveBeenCalledWith({ reason: 'aborted', planTitle: '中国新闻深度研究' })
  })

  it('联网搜索不可用时后端不发 plan，仍然能选择基于已有知识继续', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn()
    const recordWithoutPlan = buildProcessIndex([
      {
        id: 'no-plan',
        callId: 'no-plan',
        sessionId: 1,
        messageId: 1,
        tool: 'research_plan',
        stage: 'start',
        status: 'pending',
        phase: 'pending_approval',
        createdAt: 1,
        details: { approval: { kind: 'search_unavailable', expiresAt: 9_999_999_999 } },
      },
    ]).records[0]
    render(
      <ProcessOperationDetail
        record={recordWithoutPlan}
        canCommand
        commands={{ onResearchPlanDecision }}
      />,
    )
    expect(screen.getByText('深度研究：联网搜索不可用')).toBeInTheDocument()
    expect(screen.queryByText('按政策、经济、社会梳理本轮新闻')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '基于已有知识继续' }))
    expect(onResearchPlanDecision).toHaveBeenCalledWith({ callId: 'no-plan', decision: 'continue', revision: undefined })
  })

  it('审批被拒时把真实错误显示出来，不静默失败', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn().mockRejectedValueOnce(new Error('计划操作未受理，请刷新运行状态'))
    render(
      <ProcessOperationDetail record={record({ kind: 'plan' })} canCommand commands={{ onResearchPlanDecision }} />,
    )
    await user.click(screen.getByRole('button', { name: '批准计划' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('计划操作未受理，请刷新运行状态')
  })

  it('调整提交被拒时同样显示错误并保留输入', async () => {
    const user = userEvent.setup()
    const onResearchPlanDecision = vi.fn().mockRejectedValueOnce(new Error('计划操作未受理，请刷新运行状态'))
    render(
      <ProcessOperationDetail record={record({ kind: 'plan' })} canCommand commands={{ onResearchPlanDecision }} />,
    )
    await user.click(screen.getByRole('button', { name: '调整计划' }))
    await user.type(screen.getByLabelText('要调整的方向'), '只要政策线')
    await user.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('计划操作未受理，请刷新运行状态')
  })
  it('只读：不渲染任何审批按钮，也不谎称入口在别处', () => {
    render(
      <ProcessOperationDetail
        record={record({ kind: 'plan' })}
        canCommand={false}
        commands={{ onResearchPlanDecision: vi.fn() }}
      />,
    )
    expect(screen.queryByRole('button', { name: '批准计划' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '调整计划' })).not.toBeInTheDocument()
    expect(screen.getByText('计划待确认；当前视图为只读，不提供审批操作。')).toBeInTheDocument()
    expect(screen.queryByText(/正文计划卡/)).not.toBeInTheDocument()
  })

  it('没有审批回调时说明无法在此批准', () => {
    render(<ProcessOperationDetail record={record({ kind: 'plan' })} canCommand commands={{}} />)
    expect(screen.getByText('计划待确认；当前视图没有审批回调，无法在此批准。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '批准计划' })).not.toBeInTheDocument()
  })
})
