import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReasoningSection } from '@/components/message-bubble/reasoning-section'
import type { MessageMeta } from '@/types'

const createMeta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm-1',
  sessionId: 1,
  stableKey: 'stable-1',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  ...override,
})

const getToggleButton = () => screen.getByRole('button')

describe('ReasoningSection 展开逻辑', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无内容且无状态时不渲染', () => {
    const { container } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: undefined })}
        reasoningRaw=""
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
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('用户手动收起后不再被自动展开覆盖', async () => {
    const { rerender } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: undefined })}
        reasoningRaw="some reasoning"
        defaultExpanded={true}
      />,
    )
    fireEvent.click(getToggleButton())
    expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="some reasoning"
        defaultExpanded={true}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
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
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })
})
