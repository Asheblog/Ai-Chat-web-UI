import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchPlanCard } from '@/components/message-bubble/research-plan-card'
import { respondResearchPlanApproval } from '@/features/chat/api/streaming'
import type { ToolEvent } from '@/types'

vi.mock('@/features/chat/api/streaming', () => ({
  respondResearchPlanApproval: vi.fn().mockResolvedValue({ data: { success: true } }),
}))

const plan = {
  title: 'AI 芯片竞争格局',
  objective: '梳理厂商路线图、产能与市场份额',
  sub_questions: [
    { question: '头部厂商路线图', keywords: ['AI 芯片', '路线图'] },
    { question: '产能分布', keywords: ['产能', '台积电'] },
    { question: '市场份额', keywords: ['份额'] },
  ],
  estimated_tool_rounds: { min: 3, max: 6 },
  deliverable: 'markdown_report_with_citations_pdf',
}

const makeEvent = (override: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'plan-1',
  callId: 'call-plan-1',
  sessionId: 7,
  messageId: 11,
  tool: 'research_plan',
  stage: 'start',
  status: 'pending',
  phase: 'pending_approval',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  details: {
    plan,
    approval: {
      kind: 'plan',
      revision: 0,
      expiresAt: Date.now() + 300000,
    },
  },
  ...override,
})

describe('ResearchPlanCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.dispatchEvent = vi.fn()
  })

  it('renders the plan and submits approve', async () => {
    const user = userEvent.setup()
    render(<ResearchPlanCard event={makeEvent()} isStreaming />)

    expect(screen.getByText('研究计划确认')).toBeInTheDocument()
    expect(screen.getByText('AI 芯片竞争格局')).toBeInTheDocument()
    expect(screen.getByText('头部厂商路线图')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '开始研究' }))
    expect(respondResearchPlanApproval).toHaveBeenCalledWith(
      7,
      'call-plan-1',
      'approve',
      undefined,
    )
  })

  it('opens adjust textarea and requires feedback', async () => {
    const user = userEvent.setup()
    render(<ResearchPlanCard event={makeEvent()} isStreaming />)

    await user.click(screen.getByRole('button', { name: '调整研究计划' }))
    const submit = screen.getByRole('button', { name: '提交调整并重新生成计划' })
    expect(submit).toBeDisabled()

    const textarea = screen.getByLabelText('计划调整意见')
    await user.type(textarea, '请补充成本数据')
    expect(submit).not.toBeDisabled()
  })

  it('renders no-search choice and submits continue', async () => {
    const user = userEvent.setup()
    render(
      <ResearchPlanCard
        event={makeEvent({
          details: {
            plan: undefined,
            approval: {
              kind: 'search_unavailable',
              expiresAt: Date.now() + 300000,
            },
          },
        })}
        isStreaming
      />,
    )

    expect(screen.getByText(/联网搜索不可用/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '基于已有知识继续' }))
    expect(respondResearchPlanApproval).toHaveBeenCalledWith(
      7,
      'call-plan-1',
      'continue',
      undefined,
    )
  })

  it('shows relaunch for expired historical cards', () => {
    render(
      <ResearchPlanCard
        event={makeEvent({
          stage: 'error',
          status: 'aborted',
          phase: 'aborted',
          details: {
            plan,
            approval: { kind: 'plan', decision: 'expired', revision: 0 },
          },
        })}
      />,
    )

    expect(screen.getByRole('button', { name: '重新发起' })).toBeInTheDocument()
  })
})
