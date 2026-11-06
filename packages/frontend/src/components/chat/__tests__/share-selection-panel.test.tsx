import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
const summaryRender = vi.hoisted(() => vi.fn())

vi.mock('@/components/chat/share-selection-tool-summary', () => ({
  ShareSelectionToolSummary: (props: any) => { summaryRender(props); return <div data-testid="tool-summary" /> },
}))

import { ShareSelectionPanel } from '@/components/chat/share-selection-panel'
import { useChatStore } from '@/store/chat-store'

const metas = [
  { id: 1, sessionId: 1, stableKey: 'u1', role: 'user' as const, createdAt: '2026-11-06T00:00:00.000Z' },
  { id: 2, sessionId: 1, stableKey: 'a1', role: 'assistant' as const, createdAt: '2026-11-06T00:00:01.000Z' },
  { id: 3, sessionId: 1, stableKey: 'u2', role: 'user' as const, createdAt: '2026-11-06T00:00:02.000Z' },
]

const buildBodies = () => ({
  '1': { id: 1, stableKey: 'u1', content: '问题一', version: 1, reasoningVersion: 0 },
  '2': { id: 2, stableKey: 'a1', content: '回答一', version: 1, reasoningVersion: 0 },
  '3': { id: 3, stableKey: 'u2', content: '问题二', version: 1, reasoningVersion: 0 },
})

const renderPanel = () =>
  render(
    <ShareSelectionPanel
      sessionId={1}
      metas={metas}
      selectedMessageIds={[1]}
      onExit={vi.fn()}
      onNext={vi.fn()}
    />,
  )

describe('ShareSelectionPanel subscriptions', () => {
  beforeEach(() => {
    summaryRender.mockClear()
    useChatStore.setState({
      messageBodies: buildBodies(),
      shareSelection: { enabled: true, sessionId: 1, selectedMessageIds: [1] },
    })
  })

  it('does not recompute the selectable summary when unrelated message content streams', () => {
    const { container } = renderPanel()
    const countsBefore = Array.from(container.querySelectorAll('span')).map((node) => node.textContent)
    const rendersBefore = summaryRender.mock.calls.length

    act(() => {
      const current = useChatStore.getState()
      useChatStore.setState({
        messageBodies: {
          ...current.messageBodies,
          '2': { ...current.messageBodies['2'], content: '回答一继续追加', version: 2, reasoningVersion: 1 },
        },
      })
    })

    expect(Array.from(container.querySelectorAll('span')).map((node) => node.textContent)).toEqual(
      countsBefore,
    )
    expect(screen.getAllByText(/已选/).length).toBeGreaterThan(0)
    expect(summaryRender).toHaveBeenCalledTimes(rendersBefore)
  })

  it('updates the blocked count when a research_plan rejects', () => {
    const { container } = renderPanel()
    expect(container.textContent).not.toContain('不可分享')

    act(() => {
      const current = useChatStore.getState()
      useChatStore.setState({
        messageBodies: {
          ...current.messageBodies,
          '2': {
            ...current.messageBodies['2'],
            toolEvents: [
              {
                id: 'plan-1',
                tool: 'research_plan',
                messageId: 2,
                sessionId: 1,
                status: 'rejected',
              } as any,
            ],
          },
        },
      })
    })

    expect(container.textContent).toContain('1 条不可分享')
  })
})
