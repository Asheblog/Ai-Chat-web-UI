import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CotStepTimeline } from '@/components/message-bubble/cot-step-timeline'
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

describe('CotStepTimeline', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无推理无工具时不渲染', () => {
    const { container } = render(
      <CotStepTimeline meta={createMeta()} reasoningRaw="" toolEvents={[]} defaultExpanded />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('展开后按交错顺序展示深度思考与工具标题', async () => {
    render(
      <CotStepTimeline
        meta={createMeta()}
        reasoningRaw="先想一步AAAAA再想一步"
        toolEvents={[
          tool({
            id: 't1',
            tool: 'web_search',
            callId: 'c1',
            query: '今日新闻',
            details: { reasoningOffsetStart: 5 },
          }),
        ]}
        defaultExpanded
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    })
    expect(screen.getAllByText('深度思考').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/联网搜索：今日新闻/)).toBeInTheDocument()
    expect(screen.queryByText(/联网搜索：/)).toBeInTheDocument()
  })

  it('思考步不展示工具进度污染文案', async () => {
    render(
      <CotStepTimeline
        meta={createMeta()}
        reasoningRaw={['模型计划', '联网搜索：污染行', '继续'].join('\n')}
        toolEvents={[]}
        defaultExpanded
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/模型计划/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/联网搜索：污染行/)).not.toBeInTheDocument()
  })

  it('流式末段打字机在文本增长时保持已显示前缀不回退', async () => {
    const { rerender } = render(
      <CotStepTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="你"
        toolEvents={[]}
        defaultExpanded
        isStreaming
        reasoningPlayedLength={0}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('深度思考')).toBeInTheDocument()
    })

    // 推进到至少打出首字
    await waitFor(
      () => {
        expect(screen.getByText(/你/)).toBeInTheDocument()
      },
      { timeout: 2000 },
    )

    rerender(
      <CotStepTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="你好世界"
        toolEvents={[]}
        defaultExpanded
        isStreaming
        reasoningPlayedLength={1}
      />,
    )

    // 关键后不应出现空白回退：仍至少可见已出现过的「你」
    expect(screen.getByText(/你/)).toBeInTheDocument()
    await waitFor(
      () => {
        expect(screen.getByText(/你好/)).toBeInTheDocument()
      },
      { timeout: 2000 },
    )
  })
})
