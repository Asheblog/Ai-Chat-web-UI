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

describe('CotTimeline', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无推理无工具时不渲染', () => {
    const { container } = render(
      <CotTimeline meta={createMeta()} reasoningRaw="" toolEvents={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('推理卡与工具卡是独立的一级兄弟卡片，不再共享「深度思考过程」外壳', () => {
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

    expect(screen.queryByText(/深度思考过程/)).not.toBeInTheDocument()
    expect(reasoningButtons().length).toBeGreaterThanOrEqual(1)
    expect(toolButton()).toBeInTheDocument()
  })

  it('按 offset 交错顺序平铺展示深度思考与工具标题', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="先想一步AAAAA再想一步"
        toolEvents={[
          tool({
            id: 't2',
            tool: 'web_search',
            callId: 'c2',
            query: '今日新闻',
            details: { reasoningOffsetStart: 5 },
          }),
        ]}
        defaultExpanded
      />,
    )

    expect(reasoningButtons().length).toBe(2)
    expect(screen.getByText(/联网搜索：今日新闻/)).toBeInTheDocument()
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

    await waitFor(() => {
      expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    })
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

  it('完成态推理卡默认折叠，点击后展开并持久化', async () => {
    const { unmount } = render(
      <CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} />,
    )

    const button = reasoningButtons()[0]
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('思考内容')).toBeInTheDocument()

    unmount()
    render(<CotTimeline meta={createMeta()} reasoningRaw="思考内容" toolEvents={[]} />)
    await waitFor(() => {
      expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('defaultExpanded=true 时完成态推理卡直接展开', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw="展开的思考内容"
        toolEvents={[]}
        defaultExpanded
      />,
    )

    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('展开的思考内容')).toBeInTheDocument()
  })

  it('流式末段推理自动展开', async () => {
    render(
      <CotTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="正在想"
        toolEvents={[]}
        isStreaming
        reasoningPlayedLength={0}
      />,
    )

    await waitFor(() => {
      expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('执行中的工具卡自动展开', async () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 't3',
            tool: 'web_search',
            callId: 'c3',
            query: '今日新闻',
            stage: 'start',
            status: 'running',
          }),
        ]}
      />,
    )

    await waitFor(() => {
      expect(toolButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('已完成的工具卡默认折叠，点击后展示结果', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({
            id: 't4',
            tool: 'web_search',
            callId: 'c4',
            query: '今日新闻',
            status: 'success',
            resultJson: { hits: 1 },
          }),
        ]}
      />,
    )

    expect(toolButton()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toolButton())
    expect(toolButton()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"hits": 1/)).toBeInTheDocument()
  })

  it('同 offset 的多个搜索合并为一个工具组卡', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[
          tool({ id: 't5', tool: 'web_search', callId: 'c5', details: { reasoningOffsetStart: 0 } }),
          tool({ id: 't6', tool: 'web_search', callId: 'c6', details: { reasoningOffsetStart: 0 } }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /联网搜索/ })).toBeInTheDocument()
    expect(screen.getByText('2 个调用')).toBeInTheDocument()
  })
})
