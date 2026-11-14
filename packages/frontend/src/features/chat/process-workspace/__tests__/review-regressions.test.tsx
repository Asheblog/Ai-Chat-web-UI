import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ProcessWorkspaceHost } from '../process-workspace-host'
import { ProcessWorkspaceEntry } from '../process-workspace-entry'
import { ProcessOperationDetail } from '../views/operation-detail'
import { buildProcessIndex } from '../model/process-model'
import type { ResearchPlanApprovalState } from '@aichat/shared/chat-stream-contract'
import type { MessageMeta, ToolEvent } from '@/types'

const meta = (id: number, stableKey: string): MessageMeta => ({
  id,
  sessionId: 5,
  stableKey,
  role: 'assistant',
  createdAt: '2026-11-14T10:00:00Z',
  reasoningStatus: 'done',
})

const event = (id: string, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id,
  callId: id,
  sessionId: 5,
  messageId: 101,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: Date.parse('2026-11-14T10:00:05Z'),
  updatedAt: Date.parse('2026-11-14T10:00:05Z'),
  query: '查询 ' + id,
  ...override,
})

const stubMatchMedia = (wide: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('S-3 宿主路径尊重既有披露偏好', () => {
  it('存过 outline 的消息回到聊天时自动打开工作区', async () => {
    stubMatchMedia(true)
    sessionStorage.setItem('aichat.cot_timeline_level:msg-a', JSON.stringify({ level: 'outline', updatedAt: 1 }))
    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />
      </ProcessWorkspaceHost>,
    )
    expect(await screen.findByRole('complementary', { name: '过程工作区' })).toBeInTheDocument()
  })

  it('没有偏好时不自动打开（答案优先）', () => {
    stubMatchMedia(true)
    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />
      </ProcessWorkspaceHost>,
    )
    expect(screen.queryByRole('complementary', { name: '过程工作区' })).not.toBeInTheDocument()
  })

  it('关闭写入 collapsed，且不会被偏好再次打开', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />
      </ProcessWorkspaceHost>,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await screen.findByRole('complementary', { name: '过程工作区' })
    await user.click(screen.getByRole('button', { name: '关闭工作区' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: '过程工作区' })).not.toBeInTheDocument(),
    )
    const stored = sessionStorage.getItem('aichat.cot_timeline_level:msg-a')
    expect(stored && JSON.parse(stored).level).toBe('collapsed')
    expect(screen.queryByRole('complementary', { name: '过程工作区' })).not.toBeInTheDocument()
  })
})

describe('S-4 消息切换不继承上一条的面板状态', () => {
  it('A 的页签与检索不会带到 B（真实点击 B 的过程入口）', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()

    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />
        <ProcessWorkspaceEntry meta={meta(202, 'msg-b')} reasoningRaw="思考" toolEvents={[event('b1')]} />
      </ProcessWorkspaceHost>,
    )

    const scope = (key: string) =>
      within(document.querySelector(`[data-process-scope="${key}"]`) as HTMLElement)

    await user.click(scope('msg-a').getByRole('button', { name: /查看过程/ }))
    const aside = await screen.findByRole('complementary', { name: '过程工作区' })
    await user.click(within(aside).getByRole('tab', { name: /^来源/ }))
    await user.click(within(aside).getByRole('tab', { name: '过程' }))
    await user.type(within(aside).getByRole('searchbox', { name: '搜索调用' }), '查询 a1')
    expect(within(aside).getByRole('searchbox', { name: '搜索调用' })).toHaveValue('查询 a1')

    await user.click(scope('msg-b').getByRole('button', { name: /查看过程/ }))
    const asideB = await screen.findByRole('complementary', { name: '过程工作区' })
    expect(within(asideB).getByRole('tab', { name: '过程' })).toHaveAttribute('aria-selected', 'true')
    expect(within(asideB).getByRole('searchbox', { name: '搜索调用' })).toHaveValue('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('L-1 只有 truncated 的记录也要显示截断警示', () => {
  it('success + truncated 展开详情能看到结果被截断', () => {
    const record = buildProcessIndex([
      { id: 'r', callId: 'r', sessionId: 1, messageId: 1, tool: 'web_search', stage: 'result', status: 'success', createdAt: 1, details: { truncated: true } },
    ]).records[0]
    render(<ProcessOperationDetail record={record} canCommand={false} />)
    expect(screen.getByText('尝试与降级')).toBeInTheDocument()
    expect(screen.getByText('结果被截断')).toBeInTheDocument()
  })
})

describe('L-2 aria 关系与 tabs 键盘', () => {
  it('抽屉模式用 aria-haspopup，不指向不存在的元素', () => {
    stubMatchMedia(false)
    sessionStorage.clear()
    render(<ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />)
    const trigger = screen.getByRole('button', { name: /查看过程/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).not.toHaveAttribute('aria-controls')
  })

  it('inline 模式展开后 aria-controls 指向真实面板容器', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} presentation="inline" />,
    )
    const trigger = screen.getByRole('button', { name: /查看过程/ })
    expect(trigger).not.toHaveAttribute('aria-controls')
    await user.click(trigger)
    const controls = trigger.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls as string)).not.toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tabs 方向键切换并把焦点交给新页签', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta(101, 'msg-a')} reasoningRaw="思考" toolEvents={[event('a1')]} />
      </ProcessWorkspaceHost>,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const aside = await screen.findByRole('complementary', { name: '过程工作区' })
    const processTab = within(aside).getByRole('tab', { name: '过程' })
    processTab.focus()
    await user.keyboard('{ArrowRight}')
    const sourcesTab = within(aside).getByRole('tab', { name: /^来源/ })
    expect(sourcesTab).toHaveAttribute('aria-selected', 'true')
    expect(sourcesTab).toHaveFocus()
    expect(sourcesTab).toHaveAttribute('aria-controls')
  })
})

describe('L-3 审批 pending 与中文枚举', () => {
  const planRecord = (
    overrides: Partial<ToolEvent> = {},
    approval: ResearchPlanApprovalState = { kind: 'plan' },
  ) =>
    buildProcessIndex([
      {
        id: 'plan',
        callId: 'plan',
        sessionId: 1,
        messageId: 1,
        tool: 'research_plan',
        stage: 'start',
        status: 'pending',
        phase: 'pending_approval',
        createdAt: 1,
        details: {
          plan: { title: '计划', objective: '目标', sub_questions: [], estimated_tool_rounds: { min: 1, max: 2 } },
          approval,
        },
        ...overrides,
      },
    ]).records[0]

  it('提交调整期间保留编辑区并禁用按钮，失败仍留在编辑态', async () => {
    const user = userEvent.setup()
    let reject: (error: Error) => void = () => {}
    const onResearchPlanDecision = vi.fn(
      () => new Promise<never>((_, rejectFn) => { reject = rejectFn }),
    )
    render(
      <ProcessOperationDetail
        record={planRecord()}
        canCommand
        commands={{ onResearchPlanDecision }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '调整计划' }))
    await user.type(screen.getByLabelText('要调整的方向'), '只保留政策线')
    await user.click(screen.getByRole('button', { name: '提交调整并重新生成计划' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled())
    expect(screen.getByLabelText('要调整的方向')).toBeInTheDocument()
    reject(new Error('计划操作未受理'))
    expect(await screen.findByRole('alert')).toHaveTextContent('计划操作未受理')
    expect(screen.getByLabelText('要调整的方向')).toHaveValue('只保留政策线')
  })

  it('审批结果显示中文而不是英文枚举', () => {
    render(
      <ProcessOperationDetail
        record={planRecord({ status: 'success', stage: 'result', phase: 'result' }, { kind: 'plan', decision: 'approve' })}
        canCommand
        commands={{}}
      />,
    )
    expect(screen.getByText('审批结果：已批准')).toBeInTheDocument()
    expect(screen.queryByText(/审批结果：approve/)).not.toBeInTheDocument()
  })
})
