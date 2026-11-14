import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CotTimeline } from '../cot-timeline'
import type { MessageMeta, ToolEvent } from '@/types'

const meta: MessageMeta = {
  id: 'redesign', sessionId: 1, stableKey: 'redesign', role: 'assistant',
  createdAt: '2026-11-14T00:00:00Z', reasoningStatus: 'done', reasoningDurationSeconds: 87,
}
const event = (index: number, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'step-' + index, callId: 'call-' + index, sessionId: 1, messageId: 1,
  tool: 'operation-' + index, stage: 'result', status: 'success', createdAt: index,
  resultText: '详情-' + index, ...override,
})

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('CoT 按需查看过程', () => {
  it('完成态只显示状态、真实耗时和查看入口', () => {
    render(<CotTimeline meta={meta} reasoningRaw="历史思考内容" toolEvents={[event(1)]} />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('1 分 27 秒')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /查看过程/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByText('历史思考内容')).not.toBeInTheDocument()
    expect(screen.queryByText('详情-1')).not.toBeInTheDocument()
  })

  it('先呈现七步，再按原顺序查看其余，不自动展开详情', () => {
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={Array.from({ length: 10 }, (_, i) => event(i + 1))} />)
    fireEvent.click(screen.getByRole('button', { name: /查看过程/ }))
    const list = screen.getByRole('list', { name: '过程步骤' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByText('operation-8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看其余 3 步' }))
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    expect(items.map(item => within(item).getByRole('button').textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => expect.stringContaining('operation-' + (i + 1))),
    )
    expect(screen.queryByText('详情-10')).not.toBeInTheDocument()
    fireEvent.click(within(items[9]).getByRole('button'))
    expect(screen.getByText('详情-10')).toBeInTheDocument()
    expect(screen.queryByText('详情-1')).not.toBeInTheDocument()
  })

  it('流式摘要展示第七步以外的真实当前活动，不制造进度百分比', () => {
    const events = Array.from({ length: 8 }, (_, i) => event(i + 1))
    events[7] = event(8, { tool: 'read_url', query: '官方定价页', stage: 'start', status: 'running' })
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={events} isStreaming />)
    expect(screen.getByRole('status')).toHaveTextContent('官方定价页')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: '查看其余 1 步' }))
    expect(screen.getByRole('button', { name: /网页读取：官方定价页/ })).toBeInTheDocument()
  })

  it('用户展开单步后，流式结束仍保留过程和详情', () => {
    const { rerender } = render(<CotTimeline meta={{ ...meta, reasoningStatus: 'streaming' }} reasoningRaw="原始思考" toolEvents={[]} isStreaming />)
    fireEvent.click(screen.getByRole('button', { name: /深度思考/ }))
    rerender(<CotTimeline meta={meta} reasoningRaw="原始思考" toolEvents={[]} />)
    expect(screen.getByRole('list', { name: '过程步骤' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /深度思考/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('原始思考')).toBeInTheDocument()
  })

  it('失败状态可追溯原始错误，也保留成功结果', () => {
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={[event(1), event(2, { status: 'error', stage: 'error', error: '网页读取超时', resultText: undefined })]} />)
    expect(screen.getByText(/1 个步骤失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /查看失败步骤/ }))
    expect(screen.getByRole('button', { name: /operation-2/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('网页读取超时')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /operation-1/ }))
    expect(screen.getByText('详情-1')).toBeInTheDocument()
  })

  it('长推理和工具详情跟随页面展开，不引入内部滚动视口', () => {
    const { container } = render(<CotTimeline meta={meta} reasoningRaw={'长推理内容'.repeat(300)} toolEvents={[event(1, { resultText: '长工具结果'.repeat(300) })]} />)
    fireEvent.click(screen.getByRole('button', { name: /查看过程/ }))
    fireEvent.click(screen.getByRole('button', { name: /深度思考/ }))
    fireEvent.click(screen.getByRole('button', { name: /operation-1/ }))
    expect(container.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="max-h-"]')).toBeNull()
    expect(screen.queryByRole('button', { name: '全部展开' })).not.toBeInTheDocument()
  })
  it('旧 outline 偏好继续生效，切换另一消息仍默认折叠', () => {
    sessionStorage.setItem('aichat.cot_timeline_level:redesign', JSON.stringify({ level: 'outline', updatedAt: 1 }))
    const { rerender } = render(<CotTimeline meta={meta} reasoningRaw="旧消息" toolEvents={[]} />)
    expect(screen.getByRole('list', { name: '过程步骤' })).toBeInTheDocument()
    rerender(<CotTimeline meta={{ ...meta, stableKey: 'another' }} reasoningRaw="另一消息" toolEvents={[]} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('Battle 显式全展保留所有步骤和工具详情', () => {
    render(<CotTimeline meta={meta} reasoningRaw="Battle推理" toolEvents={Array.from({ length: 9 }, (_, i) => event(i + 1))} defaultExpanded />)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('Battle推理')).toBeInTheDocument()
    expect(screen.getByText('详情-9')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看其余/ })).not.toBeInTheDocument()
  })

  it('展开后的推理和工具仍使用原始交错顺序', () => {
    render(<CotTimeline meta={meta} reasoningRaw="前段后段" toolEvents={[event(1, { details: { reasoningOffsetStart: 2 } })]} />)
    fireEvent.click(screen.getByRole('button', { name: /查看过程/ }))
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(within(steps[0]).getByRole('button')).toHaveTextContent('深度思考')
    expect(within(steps[1]).getByRole('button')).toHaveTextContent('operation-1')
    expect(within(steps[2]).getByRole('button')).toHaveTextContent('深度思考')
    steps.forEach(step => fireEvent.click(within(step).getByRole('button')))
    expect(screen.getByText('前段')).toBeInTheDocument()
    expect(screen.getByText('后段')).toBeInTheDocument()
    expect(screen.getByText('详情-1')).toBeInTheDocument()
  })

  it('失败入口只补充展示到首个失败步骤，并直接展开原始错误', () => {
    const events = Array.from({ length: 12 }, (_, i) => event(i + 1))
    events[8] = event(9, { status: 'error', stage: 'error', error: '第九步失败原因', resultText: undefined })
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={events} />)
    fireEvent.click(screen.getByRole('button', { name: /查看失败步骤/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(9)
    expect(screen.getByRole('button', { name: /operation-9/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('第九步失败原因')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[8]).toHaveFocus()
    expect(screen.getByRole('button', { name: '查看其余 3 步' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation-10/ })).not.toBeInTheDocument()
  })

  it('失败的读取组摘要明确失败数量，失败入口展开组内错误', () => {
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={[
      event(1, { tool: 'read_url', query: '来源一', details: { reasoningOffsetStart: 0 } }),
      event(2, { tool: 'read_url', query: '来源二', status: 'error', stage: 'error', error: '来源二读取超时', resultText: undefined, details: { reasoningOffsetStart: 0 } }),
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /查看失败步骤/ }))
    expect(screen.getByRole('button', { name: /网页读取.*1.*失败/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /网页读取：来源二/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('来源二读取超时')).toBeInTheDocument()
  })

  it('查看更多从键盘触发后将焦点移至首个新增步骤', async () => {
    const user = userEvent.setup()
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={Array.from({ length: 10 }, (_, i) => event(i + 1))} />)
    fireEvent.click(screen.getByRole('button', { name: /查看过程/ }))
    const more = screen.getByRole('button', { name: '查看其余 3 步' })
    more.focus()
    await act(async () => { await user.keyboard('{Enter}') })
    expect(screen.getAllByRole('listitem')[7]).toHaveFocus()
  })

  it('折叠摘要的 accessible name 包含真实耗时', () => {
    render(<CotTimeline meta={meta} reasoningRaw="思考" toolEvents={[]} />)
    expect(screen.getByRole('button', { name: /已完成.*1 分 27 秒.*查看过程/ })).toBeInTheDocument()
  })

  it.each(['rejected', 'aborted'] as const)('%s 终止态也能从失败入口定位原始详情', status => {
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={[event(1, { status, stage: 'error', error: '调用被终止', resultText: undefined })]} />)
    fireEvent.click(screen.getByRole('button', { name: /查看失败步骤/ }))
    expect(screen.getByRole('button', { name: /operation-1/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('调用被终止')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveFocus()
  })

  it('查看更多和后续步骤详情在虚拟卸载重挂载后继续可见', () => {
    const props = { meta, reasoningRaw: '', toolEvents: Array.from({ length: 10 }, (_, i) => event(i + 1)) }
    const first = render(<CotTimeline {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /查看过程/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看其余 3 步' }))
    fireEvent.click(screen.getByRole('button', { name: /operation-9/ }))
    first.unmount()
    render(<CotTimeline {...props} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByRole('button', { name: /operation-9/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('详情-9')).toBeInTheDocument()
  })

})
