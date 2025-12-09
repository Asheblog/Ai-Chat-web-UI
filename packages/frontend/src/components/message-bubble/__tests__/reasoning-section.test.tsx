import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ReasoningSection } from '@/components/message-bubble/reasoning-section'
import type { MessageMeta, ToolEvent } from '@/types'

const toolTimelineMock = vi.hoisted(() => vi.fn())

vi.mock('@/components/message-bubble/tool-timeline', () => ({
  ToolTimeline: (props: any) => {
    toolTimelineMock(props)
    return (
      <div data-testid="timeline" data-expanded={props.expanded} onClick={props.onToggle}>
        timeline
      </div>
    )
  },
}))

const createMeta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm-1',
  sessionId: 1,
  stableKey: 'stable-1',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  ...override,
})

const sampleTimeline: ToolEvent[] = [
  {
    id: 't1',
    sessionId: 1,
    messageId: 'm-1',
    createdAt: Date.now(),
    tool: 'web_search',
    stage: 'start',
    status: 'running',
  },
]

describe('ReasoningSection 展开逻辑', () => {
  beforeEach(() => {
    toolTimelineMock.mockClear()
    localStorage.clear()
  })

  it('无内容且无状态时不渲染', () => {
    const { container } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: undefined })}
        reasoningRaw=""
        timeline={[]}
        summary={null}
        defaultExpanded={false}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('assistant 流式思考时自动展开', async () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw=""
        timeline={[]}
        summary={null}
        defaultExpanded={false}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toHaveAttribute('data-expanded', 'true')
    })
  })

  it('assistant 出现工具事件时自动展开', async () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: undefined })}
        reasoningRaw=""
        timeline={sampleTimeline}
        summary={null}
        defaultExpanded={false}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toHaveAttribute('data-expanded', 'true')
    })
  })

  it('用户手动收起后不再被自动展开覆盖', async () => {
    const { rerender } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: undefined })}
        reasoningRaw="some reasoning"
        timeline={sampleTimeline}
        summary={null}
        defaultExpanded={true}
      />,
    )
    fireEvent.click(screen.getByTestId('timeline'))
    expect(screen.getByTestId('timeline')).toHaveAttribute('data-expanded', 'false')

    rerender(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="some reasoning"
        timeline={sampleTimeline}
        summary={null}
        defaultExpanded={true}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toHaveAttribute('data-expanded', 'false')
    })
  })

  it('本地记忆优先于默认展开', async () => {
    localStorage.setItem(
      'aichat.reasoning_visibility',
      JSON.stringify({
        'msg:stable-persist': { expanded: true, updatedAt: Date.now() },
      }),
    )

    render(
      <ReasoningSection
        meta={createMeta({ stableKey: 'stable-persist', reasoningStatus: 'done' })}
        reasoningRaw="reasoning"
        timeline={[]}
        summary={null}
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toHaveAttribute('data-expanded', 'true')
    })
  })
})
