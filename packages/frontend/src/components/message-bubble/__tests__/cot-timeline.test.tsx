import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CotTimeline } from '@/components/message-bubble/cot-timeline'
import type { MessageMeta, ToolEvent } from '@/types'

const createMeta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm-1',
  sessionId: 1,
  stableKey: 'stable-cot-1',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  reasoningStatus: 'done',
  ...override,
})

const tool = (override: Partial<ToolEvent> & Pick<ToolEvent, 'id' | 'tool'>): ToolEvent => ({
  sessionId: 1,
  messageId: 1,
  stage: 'result',
  status: 'success',
  createdAt: Date.now(),
  ...override,
})

const reasoningButtons = () => screen.getAllByRole('button', { name: /深度思考/ })
const toolButton = () => screen.getByRole('button', { name: /联网搜索：今日新闻/ })
const summaryBar = () => screen.getByRole('button', { name: /过程时间轴，共/ })
const timelineBody = () => screen.queryByTestId('cot-timeline-body')
const openOutline = () => fireEvent.click(summaryBar())
const expandAllButton = () => screen.getByRole('button', { name: /全部展开/ })
const collapseAllButton = () => screen.getByRole('button', { name: /全部折叠/ })
const collapseButton = () => screen.getByRole('button', { name: '收起过程时间轴' })

describe('CotTimeline', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('无推理无工具时不渲染', () => {
    const { container } = render(
      <CotTimeline meta={createMeta()} reasoningRaw="" toolEvents={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('完成态默认把整条时间轴压成一行，不渲染任何步骤卡片', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="先想一步"
        toolEvents={[
          tool({
            id: 't1',
            tool: 'web_search',
            callId: 'c1',
            query: '今日新闻',
            details: { reasoningOffsetStart: 0 },
          }),
        ]}
      />,
    )

    expect(screen.getByText('过程时间轴 · 2 步')).toBeInTheDocument()
    expect(timelineBody()).toBeNull()
    expect(screen.queryByRole('button', { name: /深度思考/ })).toBeNull()
  })

  it('一行摘要带上工具统计细节', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 't2',
            tool: 'web_search',
            callId: 'c2',
            query: '今日新闻',
            details: { hitsCount: 3 },
          }),
        ]}
      />,
    )

    expect(screen.getByText(/搜索 1 次/)).toBeInTheDocument()
    expect(screen.getByText(/命中 3 条/)).toBeInTheDocument()
  })

  it('点一行条进入提纲层：卡片都在，但每张都折叠', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="想法"
        toolEvents={[
          tool({
            id: 't3',
            tool: 'web_search',
            callId: 'c3',
            query: '今日新闻',
            details: { reasoningOffsetStart: 0 },
          }),
        ]}
      />,
    )

    openOutline()

    expect(timelineBody()).toHaveAttribute('data-level', 'outline')
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(toolButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('提纲层「全部展开」进入细节层，「全部折叠」回到提纲层，「收起」回到一行', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="想法"
        toolEvents={[
          tool({
            id: 't4',
            tool: 'web_search',
            callId: 'c4',
            query: '今日新闻',
            details: { reasoningOffsetStart: 0 },
          }),
        ]}
      />,
    )

    openOutline()
    fireEvent.click(expandAllButton())

    expect(timelineBody()).toHaveAttribute('data-level', 'expanded')
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(toolButton()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapseAllButton())
    expect(timelineBody()).toHaveAttribute('data-level', 'outline')
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(toolButton()).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(collapseButton())
    expect(timelineBody()).toBeNull()
    expect(screen.getByText('过程时间轴 · 2 步')).toBeInTheDocument()
  })

  it('提纲层可以单步下钻，且不改变整条级别', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 't5',
            tool: 'web_search',
            callId: 'c5',
            query: '今日新闻',
            status: 'success',
            resultJson: { hits: 1 },
          }),
        ]}
      />,
    )

    openOutline()
    fireEvent.click(toolButton())

    expect(toolButton()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"hits": 1/)).toBeInTheDocument()
    expect(timelineBody()).toHaveAttribute('data-level', 'outline')
  })

  it('细节层点单张卡会退回提纲层', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="想法"
        toolEvents={[
          tool({
            id: 't6',
            tool: 'web_search',
            callId: 'c6',
            query: '今日新闻',
            details: { reasoningOffsetStart: 0 },
          }),
        ]}
      />,
    )

    openOutline()
    fireEvent.click(expandAllButton())
    expect(timelineBody()).toHaveAttribute('data-level', 'expanded')

    fireEvent.click(toolButton())
    expect(timelineBody()).toHaveAttribute('data-level', 'outline')
  })

  it('用户手选的级别只记住这条消息，不污染其他消息', async () => {
    const first = render(<CotTimeline meta={createMeta()} reasoningRaw="想法" toolEvents={[]} />)
    openOutline()
    fireEvent.click(expandAllButton())
    expect(timelineBody()).toHaveAttribute('data-level', 'expanded')
    first.unmount()

    const second = render(<CotTimeline meta={createMeta()} reasoningRaw="想法" toolEvents={[]} />)
    await waitFor(() => {
      expect(timelineBody()).toHaveAttribute('data-level', 'expanded')
    })
    second.unmount()

    render(
      <CotTimeline
        meta={createMeta({ stableKey: 'other-cot' })}
        reasoningRaw="想法"
        toolEvents={[]}
      />,
    )
    expect(timelineBody()).toBeNull()
  })

  it('流式作答时默认落在提纲层，结束后自动收成一行', () => {
    const streamingMeta = createMeta({ reasoningStatus: 'streaming' })
    const { rerender } = render(
      <CotTimeline
        meta={streamingMeta}
        reasoningRaw="正在想"
        toolEvents={[]}
        isStreaming
        reasoningPlayedLength={0}
      />,
    )

    expect(timelineBody()).toHaveAttribute('data-level', 'outline')
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'false')

    rerender(<CotTimeline meta={createMeta()} reasoningRaw="正在想" toolEvents={[]} />)
    expect(timelineBody()).toBeNull()
  })

  it('defaultExpanded=true 时直接进入细节层', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="展开的思考内容"
        toolEvents={[]}
        defaultExpanded
      />,
    )

    expect(timelineBody()).toHaveAttribute('data-level', 'expanded')
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
      />,
    )

    expect(screen.getByText(/模型计划/)).toBeInTheDocument()
    expect(screen.queryByText(/联网搜索：污染行/)).not.toBeInTheDocument()
  })

  it('流式末段打字机在文本增长时保持已显示前缀不回退', async () => {
    const { rerender } = render(
      <CotTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="你"
        toolEvents={[]}
        isStreaming
        reasoningPlayedLength={0}
      />,
    )

    // 流式默认提纲层且末段折叠为单行滚屏，点击后才展开播放打字机
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(reasoningButtons()[0])
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    await waitFor(
      () => {
        expect(screen.getByText(/你/)).toBeInTheDocument()
      },
      { timeout: 2000 },
    )

    rerender(
      <CotTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="你好世界"
        toolEvents={[]}
        isStreaming
        reasoningPlayedLength={1}
      />,
    )

    expect(screen.getByText(/你/)).toBeInTheDocument()
    await waitFor(
      () => {
        expect(screen.getByText(/你好/)).toBeInTheDocument()
      },
      { timeout: 2000 },
    )
  })

  it('提纲层推理卡默认折叠，点击后展开并持久化', async () => {
    const { unmount } = render(
      <CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} />,
    )

    openOutline()
    const button = reasoningButtons()[0]
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('思考内容')).toBeInTheDocument()

    unmount()
    render(<CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} />)
    await waitFor(() => {
      expect(timelineBody()).toHaveAttribute('data-level', 'outline')
    })
    await waitFor(() => {
      expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('执行中的工具卡在提纲层默认折叠，点击后展开', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 't7',
            tool: 'web_search',
            callId: 'c7',
            query: '今日新闻',
            stage: 'start',
            status: 'running',
          }),
        ]}
      />,
    )

    openOutline()
    expect(toolButton()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toolButton())
    expect(toolButton()).toHaveAttribute('aria-expanded', 'true')
  })

  it('同 offset 的多个搜索合并为一个工具组卡', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({ id: 't8', tool: 'web_search', callId: 'c8', details: { reasoningOffsetStart: 0 } }),
          tool({ id: 't9', tool: 'web_search', callId: 'c9', details: { reasoningOffsetStart: 0 } }),
        ]}
      />,
    )

    openOutline()
    expect(screen.getByRole('button', { name: /联网搜索/ })).toBeInTheDocument()
    expect(screen.getByText(/搜索 2 个引擎/)).toBeInTheDocument()
  })

  it('renders research_plan events as a dedicated plan card', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 'plan-card',
            tool: 'research_plan',
            callId: 'call-plan-card',
            stage: 'result',
            status: 'success',
            phase: 'result',
            details: {
              plan: {
                title: 'AI 芯片竞争格局',
                objective: '梳理厂商路线图、产能与市场份额',
                sub_questions: [
                  { question: '头部厂商路线图', keywords: ['AI 芯片', '路线图'] },
                  { question: '产能分布', keywords: ['产能', '台积电'] },
                  { question: '市场份额', keywords: ['份额'] },
                ],
                estimated_tool_rounds: { min: 3, max: 6 },
                deliverable: 'markdown_report_with_citations_pdf',
              },
              approval: { kind: 'plan', decision: 'approve', revision: 0 },
            },
          }),
        ]}
        defaultExpanded
      />,
    )

    expect(screen.getByText('研究计划确认')).toBeInTheDocument()
    expect(screen.getByText('AI 芯片竞争格局')).toBeInTheDocument()
  })

  it('提纲层只渲染单行标题，不再挂载推理预览 DOM', () => {
    const huge = Array.from({ length: 400 }, (_, index) => `推理第${index}行`).join('\n')
    render(<CotTimeline meta={createMeta()} reasoningRaw={huge} toolEvents={[]} />)

    openOutline()
    expect(screen.queryByTestId('cot-vertical-line-scroller')).toBeNull()

    fireEvent.click(reasoningButtons()[0])
    expect(screen.getByText(/推理第0行/)).toBeInTheDocument()
    expect(screen.getByText(/推理第399行/)).toBeInTheDocument()
  })

  it('流式超长推理的单行滚动只保留相邻行 DOM', () => {
    const huge = Array.from({ length: 400 }, (_, index) => `推理第${index}行`).join('\n')
    render(
      <CotTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw={huge}
        toolEvents={[]}
        isStreaming
        reasoningPlayedLength={0}
      />,
    )

    const scroller = screen.getByTestId('cot-vertical-line-scroller')
    expect(scroller).toHaveAttribute('data-line-count', '400')
    expect(scroller.querySelectorAll('[data-cot-line]').length).toBeLessThanOrEqual(3)
  })
})
