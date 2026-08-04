import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ToolCallsSection } from '@/components/message-bubble/tool-calls-section'
import type { ToolEvent } from '@/types'
import type { ToolTimelineSummary } from '@/features/chat/tool-events/useToolTimeline'

const createMeta = (
  override: Partial<{ stableKey: string; id: number | string; clientMessageId: string | null }> = {},
) => ({
  stableKey: 'stable-1',
  id: 'm-1',
  clientMessageId: 'cm-1',
  ...override,
})

const createEvent = (override: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'tool-1',
  sessionId: 1,
  messageId: 1,
  tool: 'web_search',
  stage: 'start',
  status: 'running',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  details: { query: '测试查询' },
  ...override,
})

const createSummary = (override: Partial<ToolTimelineSummary> = {}): ToolTimelineSummary => ({
  total: 1,
  summaryText: '完成 1 次搜索',
  label: '联网搜索',
  successCount: 1,
  runningCount: 0,
  pendingCount: 0,
  errorCount: 0,
  rejectedCount: 0,
  abortedCount: 0,
  searchEngineCount: 0,
  searchQueryCount: 1,
  readTaskCount: 0,
  ...override,
})

const getToggleButton = () => screen.getByRole('button', { name: /工具调用 \d+ 个/ })

describe('ToolCallsSection 展开逻辑', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无工具时间轴时不渲染', () => {
    const { container } = render(
      <ToolCallsSection meta={createMeta()} timeline={[]} summary={null} defaultExpanded={true} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('有 running 调用时自动展开', async () => {
    render(
      <ToolCallsSection
        meta={createMeta()}
        timeline={[createEvent({ status: 'running' })]}
        summary={null}
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('全部完成且无记忆、defaultExpanded=false 时默认折叠', async () => {
    render(
      <ToolCallsSection
        meta={createMeta()}
        timeline={[createEvent({ status: 'success' })]}
        summary={null}
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('用户手动记忆 expanded:true 优先于默认折叠', async () => {
    localStorage.setItem(
      'aichat.tool_calls_visibility',
      JSON.stringify({
        'tool:stable-persist': { expanded: true, updatedAt: Date.now() },
      }),
    )

    render(
      <ToolCallsSection
        meta={createMeta({ stableKey: 'stable-persist' })}
        timeline={[createEvent({ status: 'success' })]}
        summary={null}
        defaultExpanded={false}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('用户手动记忆 expanded:false 优先于默认展开', async () => {
    localStorage.setItem(
      'aichat.tool_calls_visibility',
      JSON.stringify({
        'tool:stable-persist': { expanded: false, updatedAt: Date.now() },
      }),
    )

    render(
      <ToolCallsSection
        meta={createMeta({ stableKey: 'stable-persist' })}
        timeline={[createEvent({ status: 'success' })]}
        summary={null}
        defaultExpanded={true}
      />,
    )

    await waitFor(() => {
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('标题显示工具调用数量（N 为时间轴长度）', () => {
    render(
      <ToolCallsSection
        meta={createMeta()}
        timeline={[
          createEvent({ id: 'tool-1', callId: 'call-1', status: 'success' }),
          createEvent({ id: 'tool-2', callId: 'call-2', status: 'success' }),
        ]}
        summary={null}
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('工具调用 2 个')).toBeInTheDocument()
  })

  it('保留 summary 副标题', () => {
    render(
      <ToolCallsSection
        meta={createMeta()}
        timeline={[createEvent({ status: 'success' })]}
        summary={createSummary({ total: 1, summaryText: '完成 1 次搜索' })}
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('完成 1 次搜索')).toBeInTheDocument()
  })
})
