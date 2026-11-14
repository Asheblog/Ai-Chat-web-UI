import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CallLedger } from '../call-ledger'
import type { MessageMeta, ToolEvent } from '@/types'

const meta: MessageMeta = {
  id: 77,
  sessionId: 3,
  stableKey: 'msg-77',
  role: 'assistant',
  createdAt: '2026-11-14T10:00:00Z',
}

const event = (index: number, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'call-' + index,
  callId: 'call-' + index,
  sessionId: 3,
  messageId: 77,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: Date.parse('2026-11-14T10:00:00Z') + index * 1000,
  updatedAt: Date.parse('2026-11-14T10:00:00Z') + index * 1000,
  query: '查询 ' + index,
  ...override,
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CallLedger 全宽台账', () => {
  it('按记录渲染表格行，父调用与子任务都在', async () => {
    render(
      <CallLedger
        meta={meta}
        toolEvents={[
          event(1, { id: 'root', callId: 'root', query: '中国新闻' }),
          event(2, { id: 'kid', callId: 'kid', tool: 'read_url', query: '政策原文', details: { parentCallId: 'root' } }),
        ]}
        onReturn={vi.fn()}
      />,
    )
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('联网搜索：中国新闻')).toBeInTheDocument()
    expect(screen.getByText('网页读取：政策原文')).toBeInTheDocument()
    expect(within(table).getByText('1 个子任务')).toBeInTheDocument()
  })

  it('按工具筛选时保留父调用作为上下文行，子任务不冒充顶层调用', async () => {
    const user = userEvent.setup()
    render(
      <CallLedger
        meta={meta}
        toolEvents={[
          event(1, { id: 'parent', callId: 'parent', tool: 'web_search', query: '父查询' }),
          event(2, { id: 'kid', callId: 'kid', tool: 'read_url', query: '子页面', details: { parentCallId: 'parent' } }),
        ]}
        onReturn={vi.fn()}
      />,
    )
    await screen.findByRole('table')
    await user.selectOptions(screen.getByRole('combobox', { name: '按工具筛选' }), 'read_url')
    expect(screen.getByText('上下文（父调用）')).toBeInTheDocument()
    expect(screen.getByText('网页读取：子页面')).toBeInTheDocument()
    expect(screen.getByText(/其中 1 行为父调用上下文/)).toBeInTheDocument()
  })

  it('搜索与只看异常收窄台账行，空结果给明确空态', async () => {
    const user = userEvent.setup()
    render(
      <CallLedger
        meta={meta}
        toolEvents={[event(1, { query: '正常' }), event(2, { query: '出错', status: 'error', stage: 'error' })]}
        onReturn={vi.fn()}
      />,
    )
    const table = await screen.findByRole('table')
    await user.type(screen.getByRole('searchbox', { name: '搜索调用台账' }), '正常')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    await user.clear(screen.getByRole('searchbox', { name: '搜索调用台账' }))
    await user.type(screen.getByRole('searchbox', { name: '搜索调用台账' }), '不存在')
    expect(await screen.findByText('没有匹配的调用')).toBeInTheDocument()
  })

  it('归属未知与父调用歧义单独标记，不伪装成正常子任务', async () => {
    render(
      <CallLedger
        meta={meta}
        toolEvents={[
          event(1, { id: 'a', callId: 'dup' }),
          event(2, { id: 'b', callId: 'dup' }),
          event(3, { id: 'amb', callId: 'amb', details: { parentCallId: 'dup' } }),
          event(4, { id: 'lost', callId: 'lost', details: { parentCallId: 'missing' } }),
        ]}
        onReturn={vi.fn()}
      />,
    )
    await screen.findByRole('table')
    expect(screen.getByText('父调用歧义')).toBeInTheDocument()
    expect(screen.getByText('归属未知')).toBeInTheDocument()
  })

  it('展开行读原始输入与结果，返回回答回调生效', async () => {
    const user = userEvent.setup()
    const onReturn = vi.fn()
    render(
      <CallLedger
        meta={meta}
        toolEvents={[event(1, { argumentsText: '{"query":"中国新闻"}', resultText: '十条命中' })]}
        onReturn={onReturn}
      />,
    )
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: /联网搜索：查询 1/ }))
    expect(screen.getByText('原始输入')).toBeInTheDocument()
    expect(screen.getByText('十条命中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /返回回答/ }))
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('持久化记录不完整与列表视图精简分开说明', async () => {
    render(
      <CallLedger
        meta={meta}
        toolEvents={[event(1)]}
        coverage={{
          trace: { status: 'unknown' },
          persisted: { status: 'partial', droppedRecords: 12 },
          projection: { status: 'partial' },
        }}
        onReturn={vi.fn()}
      />,
    )
    expect(await screen.findByText(/持久化记录不完整：丢弃 12 条记录/)).toBeInTheDocument()
    expect(screen.getByText('列表视图已精简，打开详情查看')).toBeInTheDocument()
  })

  it('数百调用按批展开，计数口径与记录数一致', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 60 }, (_, index) => event(index + 1))
    render(<CallLedger meta={meta} toolEvents={many} onReturn={vi.fn()} />)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText(/已展示 50 \/ 60 行/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /展开更多（还有 10 行）/ }))
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(61))
  })

  it('没有工具记录时给出空态而不是空表', async () => {
    render(<CallLedger meta={meta} toolEvents={[]} onReturn={vi.fn()} />)
    expect(await screen.findByText('本轮没有工具调用记录')).toBeInTheDocument()
  })
})
