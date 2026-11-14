import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CotTimeline } from '../cot-timeline'
import {
  completeCoverage,
  createMeta,
  openWorkspace,
  processRows,
  reasoningButtons,
  summaryBar,
  toolEvent,
  workspace,
} from './process-fixtures'

/**
 * 旧 CoT 时间轴的 DOM 断言迁移到「独立过程工作区」语义：
 * 一行摘要 → Radix 抽屉工作区 → 行内详情/推理摘要分区。级别只剩"开/关"两种可观察结果，
 * 旧的 data-level 下钻层级被取消。
 */
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('过程工作区（原 CoT 时间轴）', () => {
  it('无推理无工具时不渲染', () => {
    const { container } = render(
      <CotTimeline meta={createMeta()} reasoningRaw="" toolEvents={[]} coverage={completeCoverage} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('完成态默认把整条过程压成一行，不渲染步骤、推理或详情', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="先想一步"
        toolEvents={[toolEvent({ id: 't1', tool: 'web_search', callId: 'c1', query: '今日新闻', details: { reasoningOffsetStart: 0 } })]}
        coverage={completeCoverage}
      />,
    )

    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(summaryBar()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('button', { name: /深度思考/ })).toBeNull()
    expect(screen.queryByText('先想一步')).toBeNull()
  })

  it('一行摘要不再堆叠工具统计细节', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({ id: 't2', tool: 'web_search', callId: 'c2', query: '今日新闻', details: { hitsCount: 3 } })]}
        coverage={completeCoverage}
      />,
    )

    expect(screen.queryByText(/搜索 1 次/)).toBeNull()
    expect(screen.queryByText(/命中 3 条/)).toBeNull()
  })

  it('点摘要打开独立工作区：过程页签、调用列表与推理摘要分区，行与推理默认折叠', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="想法"
        toolEvents={[toolEvent({ id: 't3', tool: 'web_search', callId: 'c3', query: '今日新闻', details: { reasoningOffsetStart: 0 } })]}
        coverage={completeCoverage}
      />,
    )

    openWorkspace()

    expect(workspace()).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '过程' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '推理摘要' })).toBeInTheDocument()
    expect(processRows()).toHaveLength(1)
    expect(within(processRows()[0]).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('想法')).toBeNull()
  })

  it('Esc 与关闭按钮都回到一行摘要，并把焦点还给触发控件', async () => {
    const user = userEvent.setup()
    render(<CotTimeline meta={createMeta()} reasoningRaw="想法" toolEvents={[]} coverage={completeCoverage} />)

    await user.click(summaryBar())
    expect(workspace()).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(summaryBar()).toHaveAttribute('aria-expanded', 'false')
    expect(summaryBar()).toHaveFocus()

    await user.click(summaryBar())
    await user.click(within(workspace()).getByRole('button', { name: '关闭工作区' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(summaryBar()).toHaveFocus()
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull()
  })

  it('单步下钻留在同一个面板里，其他行保持折叠', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          toolEvent({ id: 't5', tool: 'web_search', callId: 'c5', query: '今日新闻', resultJson: { hits: 1 } }),
          toolEvent({ id: 't5b', tool: 'read_url', callId: 'c5b', query: '官方定价页' }),
        ]}
        coverage={completeCoverage}
      />,
    )

    openWorkspace()
    fireEvent.click(within(processRows()[0]).getByRole('button'))

    expect(within(processRows()[0]).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"hits": 1/)).toBeInTheDocument()
    expect(within(processRows()[1]).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(workspace()).toBeInTheDocument()
  })

  it('用户手选的开关只记住这条消息，不影响其他消息', async () => {
    const first = render(<CotTimeline meta={createMeta()} reasoningRaw="想法" toolEvents={[]} coverage={completeCoverage} />)
    openWorkspace()
    expect(workspace()).toBeInTheDocument()
    first.unmount()

    const second = render(<CotTimeline meta={createMeta()} reasoningRaw="想法" toolEvents={[]} coverage={completeCoverage} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeNull()
    })
    second.unmount()

    render(
      <CotTimeline meta={createMeta({ stableKey: 'other-cot' })} reasoningRaw="想法" toolEvents={[]} coverage={completeCoverage} />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('流式作答期间不自动展开工作区，结束后也保持用户未打开的选择', () => {
    const streamingMeta = createMeta({ reasoningStatus: 'streaming' })
    const { rerender } = render(
      <CotTimeline meta={streamingMeta} reasoningRaw="正在想" toolEvents={[]} isStreaming coverage={completeCoverage} />,
    )

    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(summaryBar()).toHaveAttribute('aria-expanded', 'false')

    rerender(<CotTimeline meta={createMeta()} reasoningRaw="正在想" toolEvents={[]} coverage={completeCoverage} />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('调用方 defaultExpanded 时直接进入细节层', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="展开的思考内容"
        toolEvents={[]}
        defaultExpanded
        coverage={completeCoverage}
      />,
    )

    expect(workspace()).toBeInTheDocument()
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('展开的思考内容')).toBeInTheDocument()
  })

  it('思考步不展示工具进度污染文案', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw={['模型计划', '联网搜索：污染行', '继续'].join('\n')}
        toolEvents={[]}
        defaultExpanded
        coverage={completeCoverage}
      />,
    )

    expect(screen.getByText(/模型计划/)).toBeInTheDocument()
    expect(screen.queryByText(/联网搜索：污染行/)).toBeNull()
  })

  it('推理卡默认折叠，点击后展开并在重挂载后保持', async () => {
    const first = render(<CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} coverage={completeCoverage} />)
    openWorkspace()

    const button = reasoningButtons()[0]
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('思考内容')).toBeInTheDocument()
    first.unmount()

    render(<CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} coverage={completeCoverage} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeNull()
    })
    await waitFor(() => {
      expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('执行中的工具行在列表里默认折叠，点击后展开', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({ id: 't7', tool: 'web_search', callId: 'c7', query: '今日新闻', stage: 'start', status: 'running' })]}
        coverage={completeCoverage}
      />,
    )

    openWorkspace()
    const row = within(processRows()[0]).getByRole('button')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(within(processRows()[0]).getByText('执行中')).toBeInTheDocument()
    fireEvent.click(row)
    expect(within(processRows()[0]).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('同 offset 的多个搜索各占一行，不再合并成旧工具组卡', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          toolEvent({ id: 't8', tool: 'web_search', callId: 'c8', query: '今日新闻', details: { reasoningOffsetStart: 0 } }),
          toolEvent({ id: 't9', tool: 'web_search', callId: 'c9', query: '今日新闻', details: { reasoningOffsetStart: 0 } }),
        ]}
        coverage={completeCoverage}
      />,
    )

    openWorkspace()
    expect(processRows()).toHaveLength(2)
    expect(screen.queryByText(/搜索 2 个引擎/)).toBeNull()
    expect(screen.getByText(/2 条记录 · 父调用 2 次/)).toBeInTheDocument()
  })

  it('工作区只有一个滚动容器，长推理与详情跟随面板滚动', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw={'长推理内容'.repeat(300)}
        toolEvents={[toolEvent({ id: 'long-1', tool: 'read_url', callId: 'call-long-1', query: '长结果', resultText: '长工具结果'.repeat(300) })]}
        coverage={completeCoverage}
      />,
    )

    openWorkspace()
    fireEvent.click(reasoningButtons()[0])
    fireEvent.click(within(processRows()[0]).getByRole('button'))

    const scrollers = Array.from(workspace().querySelectorAll('[class*="overflow-y-auto"]'))
    expect(scrollers).toHaveLength(1)
    expect(workspace().querySelectorAll('[class*="max-h-"]')).toHaveLength(0)
    expect(scrollers[0]).toContainElement(screen.getByText(/长工具结果/))
  })
})
