import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CotTimeline } from '../cot-timeline'
import {
  completeCoverage,
  createMeta,
  numberedEvent,
  numberedEvents,
  processList,
  processRows,
  summaryBar,
  workspace,
} from './process-fixtures'

/**
 * 旧「按需查看过程」的产品意图在新工作区里的落点：
 * - 完成态一行：状态 + 真实耗时 + 打开入口，不铺步骤、不铺详情
 * - 首屏分批：父调用超过一屏时只渲染首批，其余按原顺序用"显示其余"补充，键盘焦点交给首个新增行
 * - 无假进度：流式只写真实当前活动
 * - 失败直接定位：异常分组按钮一键筛到该类记录，原始错误可展开，成功记录不被删除
 * - 未获许可 / 中止与失败分开，不合并成"出错"
 * - 旧披露偏好（scopeKey 级）继续生效
 */
const meta = createMeta({
  id: 'redesign',
  stableKey: 'redesign',
  createdAt: '2026-11-14T00:00:00Z',
  reasoningDurationSeconds: 87,
})

const revealButton = () => screen.getByRole('button', { name: /显示其余 \d+ 个父调用/ })
const reasoningToggle = () => within(workspace()).getByRole('button', { name: /深度思考/ })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('CoT 按需查看过程（工作区语义）', () => {
  it('完成态只显示状态、真实耗时和查看入口', () => {
    render(<CotTimeline meta={meta} reasoningRaw="历史思考内容" toolEvents={[numberedEvent(1)]} coverage={completeCoverage} />)

    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('1 分 27 秒')).toBeInTheDocument()
    expect(summaryBar()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText('历史思考内容')).toBeNull()
    expect(screen.queryByText('详情-1')).toBeNull()
  })

  it('首屏只铺开首批父调用，其余标注精确数量并按原顺序补充', () => {
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={numberedEvents(60)} coverage={completeCoverage} />)
    fireEvent.click(summaryBar())

    const firstScreen = processRows()
    expect(firstScreen.length).toBeGreaterThan(0)
    expect(firstScreen.length).toBeLessThan(60)
    expect(firstScreen[0]).toHaveTextContent('operation-1')
    expect(firstScreen[firstScreen.length - 1]).toHaveTextContent(`operation-${firstScreen.length}`)
    expect(screen.queryByText('详情-1')).toBeNull()

    expect(revealButton()).toHaveTextContent(`显示其余 ${60 - firstScreen.length} 个父调用`)
    fireEvent.click(revealButton())

    const expanded = processRows()
    expect(expanded).toHaveLength(60)
    expect(expanded.map((row) => row.textContent)).toEqual(
      Array.from({ length: 60 }, (_, index) => expect.stringContaining('operation-' + (index + 1))),
    )
    expect(screen.queryByRole('button', { name: /显示其余/ })).toBeNull()
    expect(screen.getByText(/已展示 60 \/ 60 条记录/)).toBeInTheDocument()
    expect(screen.queryByText('详情-1')).toBeNull()
  })

  it('流式摘要展示真实当前活动，不制造进度百分比', () => {
    const events = numberedEvents(8)
    events[7] = numberedEvent(8, {
      tool: 'read_url',
      query: '官方定价页',
      stage: 'start',
      status: 'running',
      resultText: undefined,
    })
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={events} isStreaming coverage={completeCoverage} />)

    expect(screen.getByRole('status')).toHaveTextContent('网页读取：官方定价页')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('进行中')).toBeInTheDocument()
  })

  it('用户展开后流式结束仍保留过程与详情', () => {
    const { rerender } = render(
      <CotTimeline meta={{ ...meta, reasoningStatus: 'streaming' }} reasoningRaw="原始思考" toolEvents={[]} isStreaming coverage={completeCoverage} />,
    )
    fireEvent.click(summaryBar())
    fireEvent.click(reasoningToggle())
    expect(screen.getByText('原始思考')).toBeInTheDocument()

    rerender(<CotTimeline meta={meta} reasoningRaw="原始思考" toolEvents={[]} coverage={completeCoverage} />)

    expect(workspace()).toBeInTheDocument()
    expect(reasoningToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('原始思考')).toBeInTheDocument()
  })

  it('失败通过异常分组直接定位，原始错误可追溯，成功记录不被删除', () => {
    const events = numberedEvents(12)
    events[8] = numberedEvent(9, { status: 'error', stage: 'error', error: '第九步失败原因', resultText: undefined })
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={events} coverage={completeCoverage} />)

    expect(summaryBar()).toHaveAccessibleName(/1 处异常/)
    fireEvent.click(summaryBar())

    const failedChip = screen.getByRole('button', { name: '只看失败（1 条）' })
    expect(failedChip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(failedChip)
    expect(failedChip).toHaveAttribute('aria-pressed', 'true')

    const failedRows = processRows()
    expect(failedRows).toHaveLength(1)
    expect(within(failedRows[0]).getByRole('button')).toHaveTextContent('operation-9')
    expect(within(failedRows[0]).getByText('失败')).toBeInTheDocument()
    expect(screen.getByText(/已展示 1 \/ 12 条记录/)).toBeInTheDocument()

    fireEvent.click(within(failedRows[0]).getByRole('button'))
    expect(screen.getByText('第九步失败原因')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '按状态筛选' }), { target: { value: 'all' } })
    const allRows = processRows()
    expect(allRows).toHaveLength(12)
    fireEvent.click(within(allRows[0]).getByRole('button'))
    expect(screen.getByText('详情-1')).toBeInTheDocument()
  })

  it.each([
    ['rejected', '未获许可'],
    ['aborted', '中止'],
  ] as const)('%s 终止态与失败分开，也能直接定位原始详情', (status, label) => {
    render(
      <CotTimeline
        meta={meta}
        reasoningRaw=""
        toolEvents={[numberedEvent(1, { status, stage: 'error', error: '调用被终止', resultText: undefined })]}
        coverage={completeCoverage}
      />,
    )

    fireEvent.click(summaryBar())
    expect(screen.getByText(new RegExp(`${label} 1 次`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /只看失败/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: `只看${label}（1 条）` }))
    const rows = processRows()
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText(label)).toBeInTheDocument()

    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(screen.getByText('调用被终止')).toBeInTheDocument()
  })

  it('折叠摘要的 accessible name 包含真实耗时', () => {
    render(<CotTimeline meta={meta} reasoningRaw="思考" toolEvents={[]} coverage={completeCoverage} />)
    expect(summaryBar()).toHaveAccessibleName(/已完成.*1 分 27 秒/)
  })

  it('旧 outline 偏好继续生效，切换另一消息仍默认折叠', async () => {
    sessionStorage.setItem('aichat.cot_timeline_level:redesign', JSON.stringify({ level: 'outline', updatedAt: 1 }))
    const { rerender } = render(<CotTimeline meta={meta} reasoningRaw="旧消息" toolEvents={[]} coverage={completeCoverage} />)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeNull()
    })

    rerender(<CotTimeline meta={{ ...meta, stableKey: 'another' }} reasoningRaw="另一消息" toolEvents={[]} coverage={completeCoverage} />)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('Battle 显式全展保留所有步骤和工具详情，且不提供可执行命令', () => {
    render(
      <CotTimeline
        meta={{ ...meta, sessionId: 0, stableKey: 'battle-run' }}
        reasoningRaw="Battle推理"
        toolEvents={numberedEvents(9)}
        defaultExpanded
        coverage={completeCoverage}
      />,
    )

    expect(workspace()).toBeInTheDocument()
    expect(processRows()).toHaveLength(9)
    expect(screen.getByText('Battle推理')).toBeInTheDocument()
    expect(screen.getByText('详情-9')).toBeInTheDocument()
    expect(screen.getByText('Battle 只读')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /显示其余/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '重新生成整轮' })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消本轮' })).toBeNull()
  })

  it('“显示其余”从键盘触发后把焦点交给首个新增父行', async () => {
    const user = userEvent.setup()
    render(<CotTimeline meta={meta} reasoningRaw="" toolEvents={numberedEvents(60)} coverage={completeCoverage} />)
    fireEvent.click(summaryBar())

    const firstScreenCount = processRows().length
    const reveal = revealButton()
    reveal.focus()
    await user.keyboard('{Enter}')

    const buttons = within(processList()).getAllByRole('button')
    expect(buttons).toHaveLength(60)
    expect(buttons[firstScreenCount]).toHaveFocus()
  })

  it('查看更多与行详情在虚拟卸载重挂载后继续可见', async () => {
    const props = { meta, reasoningRaw: '', toolEvents: numberedEvents(10), coverage: completeCoverage }
    const first = render(<CotTimeline {...props} />)
    fireEvent.click(summaryBar())
    fireEvent.click(within(processRows()[1]).getByRole('button'))
    expect(screen.getByText('详情-2')).toBeInTheDocument()
    first.unmount()

    render(<CotTimeline {...props} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeNull()
    })
    await waitFor(() => {
      expect(within(processRows()[1]).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    })
    expect(screen.getByText('详情-2')).toBeInTheDocument()
  })
})
