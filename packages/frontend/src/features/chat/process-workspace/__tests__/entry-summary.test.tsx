import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProcessWorkspaceEntry } from '../process-workspace-entry'
import type { ProcessWorkspaceEntryProps } from '../types'
import type { MessageMeta, ToolEvent } from '@/types'

const meta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 101,
  sessionId: 5,
  stableKey: 'msg-101',
  role: 'assistant',
  createdAt: '2026-11-14T10:00:00Z',
  reasoningStatus: 'done',
  reasoningDurationSeconds: 87,
  ...override,
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
  query: '今日中国新闻',
  ...override,
})

const baseProps: ProcessWorkspaceEntryProps = {
  meta: meta(),
  reasoningRaw: '先确认时间范围，再找原始报道。',
  toolEvents: [event('root'), event('child', { details: { parentCallId: 'root' }, query: '政策原文' })],
  content: '这是正文回答，摘要入口不能吞掉它。',
  artifacts: [],
  coverage: { trace: { status: 'complete', startedAt: 1, turnEndedAt: 2 } },
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('摘要入口', () => {
  it('完成态只显示状态、真实耗时与打开入口，不展示详情', () => {
    render(<ProcessWorkspaceEntry {...baseProps} />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('1 分 27 秒')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /查看过程/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('政策原文')).not.toBeInTheDocument()
  })

  it('点摘要打开工作区，答案文本不进入摘要条', async () => {
    const user = userEvent.setup()
    render(<ProcessWorkspaceEntry {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const panel = await screen.findByRole('tablist', { name: '工作区页签' })
    expect(panel).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '过程' })).toHaveAttribute('aria-selected', 'true')
    // 模态抽屉打开时背景整体 inert：正文不属于工作区，不会被读进过程面板
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('这是正文回答，摘要入口不能吞掉它。')).toBeNull()
  })

  it('关闭后焦点回到摘要按钮', async () => {
    const user = userEvent.setup()
    render(<ProcessWorkspaceEntry {...baseProps} />)
    const trigger = screen.getByRole('button', { name: /查看过程/ })
    await user.click(trigger)
    await screen.findByRole('tablist', { name: '工作区页签' })
    await user.click(screen.getByRole('button', { name: '关闭工作区' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('tablist', { name: '工作区页签' })).not.toBeInTheDocument()
  })

  it('旧 outline 偏好直接打开工作区，另一条消息仍默认折叠', async () => {
    sessionStorage.setItem('aichat.cot_timeline_level:msg-101', JSON.stringify({ level: 'outline', updatedAt: 1 }))
    const { rerender } = render(<ProcessWorkspaceEntry {...baseProps} />)
    expect(await screen.findByRole('tablist', { name: '工作区页签' })).toBeInTheDocument()
    rerender(<ProcessWorkspaceEntry {...baseProps} meta={meta({ stableKey: 'msg-other', id: 202 })} />)
    await waitFor(() => expect(screen.queryByRole('tablist', { name: '工作区页签' })).not.toBeInTheDocument())
  })

  it('onOpen 只在关闭到打开边沿回调一次', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ProcessWorkspaceEntry {...baseProps} onOpen={onOpen} />)
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '关闭工作区' }))
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2))
  })

  it('defaultExpanded 首次挂载即打开（Battle 详情语义）', async () => {
    render(<ProcessWorkspaceEntry {...baseProps} defaultExpanded />)
    expect(await screen.findByRole('tablist', { name: '工作区页签' })).toBeInTheDocument()
  })

  it('没有工具也没有推理时不渲染任何入口', () => {
    const { container } = render(<ProcessWorkspaceEntry {...baseProps} reasoningRaw="" toolEvents={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('入口存在条件', () => {
  it('只有终态时也给入口：未生成最终回答必须有地方可看', () => {
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        reasoningRaw=""
        toolEvents={[]}
        artifacts={[]}
        runTerminal={{ finalAnswerGenerated: false }}
      />,
    )
    expect(screen.getByRole('button', { name: /查看过程/ })).toBeInTheDocument()
    expect(screen.getByText('未生成最终回答')).toBeInTheDocument()
  })

  it('只有产物时也给入口', () => {
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        reasoningRaw=""
        toolEvents={[]}
        artifacts={[
          { id: 9, fileName: '报告.md', mimeType: 'text/markdown', sizeBytes: 12, expiresAt: '2026-12-01', downloadUrl: '/api/files/9' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /查看过程/ })).toBeInTheDocument()
  })

  it('流式首轮还没有工具时也有入口，停止后续工具可达', async () => {
    const user = userEvent.setup()
    const onStopTools = vi.fn().mockResolvedValue({ accepted: true })
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        reasoningRaw=""
        toolEvents={[]}
        isStreaming
        meta={meta({ streamStatus: 'streaming', reasoningStatus: 'streaming' })}
        commands={{ onStopTools }}
      />,
    )
    expect(screen.getByText('进行中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.getByRole('button', { name: '停止后续工具' })).toBeInTheDocument()
  })

  it('普通空消息不渲染任何多余栏', () => {
    const { container } = render(
      <ProcessWorkspaceEntry {...baseProps} reasoningRaw="" toolEvents={[]} artifacts={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
