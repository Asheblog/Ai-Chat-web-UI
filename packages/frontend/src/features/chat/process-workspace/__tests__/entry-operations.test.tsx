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

describe('工作区内容', () => {
  it('子任务默认不占首屏，展开父行才出现', async () => {
    const user = userEvent.setup()
    render(<ProcessWorkspaceEntry {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const list = await screen.findByRole('list', { name: '过程步骤' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText(/1 个子任务/)).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: /联网搜索：今日中国新闻/ }))
    const children = screen.getByRole('list', { name: /的子任务/ })
    expect(within(children).getAllByRole('listitem')).toHaveLength(1)
    expect(within(children).getByText('联网搜索：政策原文')).toBeInTheDocument()
  })

  it('数百调用首屏只铺 50 个父调用，显示其余后焦点落在首个新增行', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 60 }, (_, index) => event('call-' + index, { query: '查询 ' + index }))
    render(<ProcessWorkspaceEntry {...baseProps} toolEvents={many} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const list = await screen.findByRole('list', { name: '过程步骤' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(50)
    expect(screen.getByText(/已展示 50 .* 60 条记录/)).toBeInTheDocument()
    const more = screen.getByRole('button', { name: '显示其余 10 个父调用' })
    more.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(60))
    expect(within(list).getAllByRole('button')[50]).toHaveFocus()
  })

  it('异常分组是可操作筛选，点失败分组只剩失败记录', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        toolEvents={[
          event('ok', { query: '正常查询' }),
          event('bad', { query: '失败查询', status: 'error', stage: 'error' }),
          event('lost', { query: '归属未知', details: { parentCallId: 'missing' } }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: /只看失败/ }))
    const list = screen.getByRole('list', { name: '过程步骤' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('联网搜索：失败查询')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /只看失败/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('推理摘要与工具记录分层展示，展开才读全文', async () => {
    const user = userEvent.setup()
    render(<ProcessWorkspaceEntry {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.getByRole('button', { name: /深度思考/ })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: /深度思考/ }))
    expect(screen.getByText('先确认时间范围，再找原始报道。')).toBeInTheDocument()
  })

  it('检索与只看异常能收窄调用列表', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        toolEvents={[
          event('ok', { query: '正常查询' }),
          event('bad', { query: '失败查询', status: 'error', stage: 'error' }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: /只看异常/ }))
    const list = screen.getByRole('list', { name: '过程步骤' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /只看异常/ }))
    await user.type(screen.getByRole('searchbox', { name: '搜索调用' }), '正常')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    expect(within(list).getByText('联网搜索：正常查询')).toBeInTheDocument()
  })

  it('点调用展开原始输入与结果，长 JSON 不另开滚动视口', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ProcessWorkspaceEntry
        {...baseProps}
        toolEvents={[event('long', { argumentsText: '{"query":"' + '长查询'.repeat(300) + '"}', resultText: '结果'.repeat(400) })]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: /联网搜索：今日中国新闻/ }))
    expect(screen.getByText('原始输入')).toBeInTheDocument()
    expect(screen.getByText('结果')).toBeInTheDocument()
    // 抽屉走 Portal，DOM 不在 render 容器里
    void container
    const blocks = Array.from(screen.getByRole('dialog').querySelectorAll('pre'))
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect(block.className).not.toContain('overflow-y-auto')
  })
})
