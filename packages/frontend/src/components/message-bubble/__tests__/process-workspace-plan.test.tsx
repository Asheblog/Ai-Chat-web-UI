import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CotTimeline } from '../cot-timeline'
import type { ProcessWorkspaceCommands, ResearchPlanDecision } from '@/features/chat/process-workspace/types'
import type { ToolEvent } from '@/types'
import { buildPlan, completeCoverage, createMeta, toolEvent } from './process-fixtures'

/**
 * 研究计划审批：旧 research-plan-card 的入口迁到调用详情，语义是"只转发真实审批通道"。
 * approve / cancel / adjust（必填反馈）/ continue（搜索不可用）各自对应真实决定；
 * 过期或中止后提供按原问题重新发起；只读或没有回调时不渲染可执行控件。
 */
const plan = buildPlan(8)

const planEvent = (override: Partial<ToolEvent> = {}): ToolEvent =>
  toolEvent({
    id: 'plan-1',
    callId: 'call-plan-1',
    tool: 'research_plan',
    stage: 'start',
    status: 'pending',
    phase: 'pending_approval',
    details: { plan, approval: { kind: 'plan', revision: 0 } },
    ...override,
  })

interface RenderPlanOptions {
  readOnly?: boolean
  commands?: ProcessWorkspaceCommands
  event?: ToolEvent
}

const renderPlan = ({ readOnly, commands, event }: RenderPlanOptions = {}) =>
  render(
    <CotTimeline
      meta={createMeta()}
      reasoningRaw=""
      toolEvents={[event ?? planEvent()]}
      defaultExpanded
      readOnly={readOnly}
      coverage={completeCoverage}
      commands={commands}
    />,
  )

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('研究计划审批（迁移自旧计划卡）', () => {
  it('呈现标题、目标与前六个子问题，并给出剩余数量', () => {
    renderPlan()

    expect(screen.getByText('AI 芯片竞争格局')).toBeInTheDocument()
    expect(screen.getByText('梳理厂商路线图、产能与市场份额')).toBeInTheDocument()
    expect(screen.getByText('子问题 1')).toBeInTheDocument()
    expect(screen.getByText('子问题 6')).toBeInTheDocument()
    expect(screen.queryByText('子问题 7')).toBeNull()
    expect(screen.getByText(/其余 2 个子问题/)).toBeInTheDocument()
  })

  it('批准计划把真实决定、调用 id 与修订号交给宿主回调', async () => {
    const decide = vi.fn()
    renderPlan({ commands: { onResearchPlanDecision: decide } })

    fireEvent.click(screen.getByRole('button', { name: /批准计划/ }))

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1))
    expect(decide).toHaveBeenCalledWith({
      callId: 'call-plan-1',
      decision: 'approve',
      revision: 0,
    } satisfies ResearchPlanDecision)
  })

  it('取消计划走同一个真实审批通道', async () => {
    const decide = vi.fn()
    renderPlan({ commands: { onResearchPlanDecision: decide } })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({ callId: 'call-plan-1', decision: 'cancel', revision: 0 }),
    )
  })

  it('已经给出审批结果时只陈述结果，不再提供可执行按钮', () => {
    const decide = vi.fn()
    renderPlan({
      commands: { onResearchPlanDecision: decide },
      event: planEvent({
        status: 'success',
        stage: 'result',
        phase: 'result',
        details: { plan, approval: { kind: 'plan', decision: 'approve', revision: 0 } },
      }),
    })

    expect(screen.getByText('审批结果：已批准')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批准计划/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    expect(decide).not.toHaveBeenCalled()
  })

  it('只读分享里计划保持待确认状态，不渲染可执行审批按钮', () => {
    renderPlan()

    expect(screen.getByText(/计划待确认/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批准计划/ })).toBeNull()
  })

  it('调整计划必须先写清方向，提交后把反馈交给审批通道', async () => {
    const decide = vi.fn()
    renderPlan({ commands: { onResearchPlanDecision: decide } })

    fireEvent.click(screen.getByRole('button', { name: /调整计划/ }))
    fireEvent.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))

    expect(decide).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('请先写清要调整的方向')

    fireEvent.change(screen.getByLabelText('要调整的方向'), { target: { value: '请补充成本数据' } })
    fireEvent.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        callId: 'call-plan-1',
        decision: 'adjust',
        feedback: '请补充成本数据',
        revision: 0,
      }),
    )
  })

  it('联网搜索不可用时（后端不发 plan）仍能选择基于已有知识继续', async () => {
    const decide = vi.fn()
    renderPlan({
      commands: { onResearchPlanDecision: decide },
      event: planEvent({
        id: 'choice-1',
        callId: 'research-choice:abc',
        summary: '联网搜索不可用，是否基于已有知识继续？',
        details: { approval: { kind: 'search_unavailable', expiresAt: Date.now() + 300000 } },
      }),
    })

    expect(screen.getByText(/联网搜索不可用/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /基于已有知识继续/ }))

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        callId: 'research-choice:abc',
        decision: 'continue',
        revision: undefined,
      }),
    )
  })

  it('计划过期或调用中止后可以按原问题重新发起', () => {
    const reissue = vi.fn()
    const first = renderPlan({
      commands: { onReissuePlan: reissue },
      event: planEvent({
        status: 'aborted',
        stage: 'error',
        phase: 'aborted',
        details: { plan, approval: { kind: 'plan', decision: 'expired', revision: 0 } },
      }),
    })

    expect(screen.getByText('审批结果：已过期')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新发起/ }))
    expect(reissue).toHaveBeenCalledWith({ reason: 'expired', planTitle: 'AI 芯片竞争格局' })
    first.unmount()

    renderPlan({
      commands: { onReissuePlan: reissue },
      event: planEvent({
        status: 'aborted',
        stage: 'error',
        phase: 'aborted',
        details: { plan, approval: { kind: 'plan', revision: 0 } },
      }),
    })

    expect(screen.getByText(/计划调用已中止/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新发起/ }))
    expect(reissue).toHaveBeenLastCalledWith({ reason: 'aborted', planTitle: 'AI 芯片竞争格局' })
  })

  it('审批命令被拒绝时把真实错误显示出来，而不是静默失败', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('计划操作未受理，请刷新运行状态'))
    renderPlan({ commands: { onResearchPlanDecision: decide } })

    fireEvent.click(screen.getByRole('button', { name: /批准计划/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('计划操作未受理，请刷新运行状态')
  })

  it('只读视图即使拿到审批回调也不派发任何命令', () => {
    const decide = vi.fn()
    const reissue = vi.fn()
    renderPlan({ readOnly: true, commands: { onResearchPlanDecision: decide, onReissuePlan: reissue } })

    expect(screen.getByText(/当前视图为只读/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批准计划/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整计划/ })).toBeNull()
    expect(decide).not.toHaveBeenCalled()
    expect(reissue).not.toHaveBeenCalled()
  })

  it('有回调时批准入口出现，没有回调时只说明入口（迁移自旧时间轴计划卡用例）', () => {
    const withCallback = renderPlan({ commands: { onResearchPlanDecision: vi.fn() } })
    expect(screen.getByRole('button', { name: /批准计划/ })).toBeInTheDocument()
    withCallback.unmount()

    renderPlan()
    expect(screen.getByText('AI 芯片竞争格局')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批准计划/ })).toBeNull()
    expect(screen.getByText(/计划待确认/)).toBeInTheDocument()
  })
})
