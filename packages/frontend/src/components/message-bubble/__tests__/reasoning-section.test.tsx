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

  it('流式结束后自动折叠回默认状态（无手动记忆时）', async () => {
    const { rerender } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="thinking..."
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })

    rerender(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="thinking..."
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
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

  it('defaultExpanded 从 true 变为 false 时应折叠', async () => {
    // 模拟真实场景：流式时 defaultExpanded=true，完成后变为 false
    const { rerender } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw="thinking..."
        defaultExpanded={true}
      />,
    )

    // 流式时展示推理面板
    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })

    // 推理完成，defaultExpanded 变为 false（模拟设置关闭）
    rerender(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="thinking..."
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('用户手动折叠后 defaultExpanded 变化不应覆盖用户选择', async () => {
    const { rerender } = render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="thinking..."
        defaultExpanded={true}
      />,
    )

    // 默认展开
    expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')

    // 用户手动折叠
    fireEvent.click(getToggleButton())
    expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

    // defaultExpanded 变化不应覆盖用户选择
    rerender(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="thinking..."
        defaultExpanded={true}
      />,
    )

    expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('完成态无本地记忆时默认折叠', async () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="reasoning"
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('长思考耗时使用可读格式', () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done', reasoningDurationSeconds: 1101 })}
        reasoningRaw="reasoning"
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('· 18m21s')).toBeInTheDocument()
  })
})

describe('ReasoningSection 标题文案', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('完成态且存在耗时时标题为「思考过程 · Ns」', () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done', reasoningDurationSeconds: 3 })}
        reasoningRaw="reasoning"
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('思考过程')).toBeInTheDocument()
    // formatDurationSeconds(3) 实际输出为 '3.00s'
    expect(screen.getByText('· 3.00s')).toBeInTheDocument()
  })

  it('完成态无耗时时不显示耗时后缀', () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'done' })}
        reasoningRaw="reasoning"
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('思考过程')).toBeInTheDocument()
    expect(screen.queryByText(/^·/)).not.toBeInTheDocument()
  })

  it('流式时不显示耗时后缀', () => {
    render(
      <ReasoningSection
        meta={createMeta({ reasoningStatus: 'streaming', reasoningDurationSeconds: 3 })}
        reasoningRaw="thinking..."
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('正在思考')).toBeInTheDocument()
    expect(screen.queryByText('· 3.00s')).not.toBeInTheDocument()
  })
})
