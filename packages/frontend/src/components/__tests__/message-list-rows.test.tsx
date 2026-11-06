import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { MessageBody, MessageMeta, MessageRenderCacheEntry, MessageStreamMetrics } from '@/types'

const bubbleRenders = vi.hoisted(() => new Map<string, number>())
const bubbleProps = vi.hoisted(() => new Map<string, any>())
const measuredRows = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/components/message-bubble', () => ({
  MessageBubble: (props: any) => {
    const key = String(props.meta.stableKey ?? props.meta.id)
    bubbleRenders.set(key, (bubbleRenders.get(key) ?? 0) + 1)
    bubbleProps.set(key, props)
    return <div data-testid={`bubble-${key}`}>{props.body.content}</div>
  },
}))

vi.mock('@/components/compressed-group-card', () => ({
  CompressedGroupCard: ({ meta }: any) => <div data-testid={`group-${meta.stableKey}`} />,
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const items = Array.from({ length: count }, (_, index) => ({
      index,
      start: index * 120,
      size: 100,
      key: index,
    }))
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * 120,
      measureElement: () => {
        measuredRows.count += 1
      },
      getOffsetForIndex: () => [0, 0],
    }
  },
}))

import { MessageList } from '@/components/message-list'
import { useChatStore } from '@/store/chat-store'

const session = {
  id: 1,
  userId: 1,
  title: '测试会话',
  createdAt: '2026-11-06T00:00:00.000Z',
  connectionId: 1,
  modelRawId: 'gpt-test',
} as any

const metas: MessageMeta[] = [
  { id: 1, sessionId: 1, stableKey: 'u1', role: 'user', createdAt: '2026-11-06T00:00:00.000Z' },
  { id: 2, sessionId: 1, stableKey: 'a1', role: 'assistant', createdAt: '2026-11-06T00:00:01.000Z' },
  { id: 3, sessionId: 1, stableKey: 'u2', role: 'user', createdAt: '2026-11-06T00:00:02.000Z' },
  { id: 4, sessionId: 1, stableKey: 'a2', role: 'assistant', createdAt: '2026-11-06T00:00:03.000Z' },
]

const buildBody = (id: number, stableKey: string, content: string): MessageBody => ({
  id,
  stableKey,
  content,
  version: 1,
  reasoningVersion: 0,
})

const buildBodies = () => ({
  '1': buildBody(1, 'u1', '第一问'),
  '2': buildBody(2, 'a1', '第一答'),
  '3': buildBody(3, 'u2', '第二问'),
  '4': buildBody(4, 'a2', '第二答'),
})

const resetStore = (bodies = buildBodies(), messageMetrics: Record<string, MessageStreamMetrics> = {}) => {
  useChatStore.setState({
    currentSession: session,
    messageMetas: metas,
    messageBodies: bodies,
    messageRenderCache: {},
    messageMetrics,
    assistantVariantSelections: {},
    shareSelection: { enabled: false, sessionId: null, selectedMessageIds: [] },
    isStreaming: false,
    isMessagesLoading: false,
  })
}

const renderCount = (key: string) => bubbleRenders.get(key) ?? 0
const stableShareToggle = vi.fn()
const stableShareStart = vi.fn()

const Harness = ({
  metas: listMetas = metas,
  variantSelections,
  shareSelection,
  onShareToggle = stableShareToggle,
  onShareStart = stableShareStart,
}: {
  metas?: MessageMeta[]
  variantSelections?: Record<string, number | string>
  shareSelection?: { enabled: boolean; sessionId: number | null; selectedMessageIds: number[] }
  onShareToggle?: (id: number) => void
  onShareStart?: (id: number) => void
}) => {
  const [input, setInput] = useState('')
  return (
    <>
      <textarea
        aria-label="composer-input"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <MessageList
        storeConnected
        metas={listMetas}
        isStreaming={false}
        variantSelections={variantSelections}
        shareSelection={shareSelection}
        onShareToggle={onShareToggle}
        onShareStart={onShareStart}
      />
    </>
  )
}

describe('MessageList row subscriptions', () => {
  beforeEach(() => {
    bubbleRenders.clear()
    bubbleProps.clear()
    resetStore()
  })

  it('keeps historical rows out of composer input renders', () => {
    render(<Harness />)
    const before = ['u1', 'a1', 'u2', 'a2'].map(renderCount)

    fireEvent.change(screen.getByLabelText('composer-input'), { target: { value: '逐字输入' } })

    expect(['u1', 'a1', 'u2', 'a2'].map(renderCount)).toEqual(before)
  })

  it('rerenders only the row whose body, cache or metrics changed', () => {
    render(<Harness />)
    const before = ['u1', 'a1', 'u2', 'a2'].map(renderCount)

    act(() => {
      const current = useChatStore.getState()
      useChatStore.setState({
        messageBodies: {
          ...current.messageBodies,
          '4': { ...current.messageBodies['4'], content: '第二答更新', version: 2 },
        },
      })
    })
    expect(renderCount('a2')).toBe(before[3] + 1)
    expect([renderCount('u1'), renderCount('a1'), renderCount('u2')]).toEqual([before[0], before[1], before[2]])
    expect(screen.getByTestId('bubble-a2')).toHaveTextContent('第二答更新')

    act(() => {
      useChatStore.setState({
        messageRenderCache: {
          '4': {
            contentHtml: '<p>缓存</p>',
            reasoningHtml: null,
            contentVersion: 2,
            reasoningVersion: 0,
            updatedAt: Date.now(),
          } satisfies MessageRenderCacheEntry,
        },
      })
    })
    expect(renderCount('a2')).toBe(before[3] + 2)

    act(() => {
      useChatStore.setState({ messageMetrics: { '4': { responseTimeMs: 1200 } } })
    })
    expect(renderCount('a2')).toBe(before[3] + 3)
    expect(bubbleProps.get('a2')?.metrics).toEqual({ responseTimeMs: 1200 })
  })

  it('passes variant and share state to the affected rows only', () => {
    const variants: MessageMeta[] = [
      metas[0],
      { ...metas[1], parentMessageId: 1, variantIndex: 0, id: 2, stableKey: 'a1' },
      { ...metas[1], parentMessageId: 1, variantIndex: 1, id: 5, stableKey: 'a1b' },
      metas[2],
      metas[3],
    ]
    useChatStore.setState({ messageMetas: variants, messageBodies: { ...buildBodies(), '5': buildBody(5, 'a1b', '另一答') } })
    const onShareToggle = vi.fn()
    const onShareStart = vi.fn()
    const { rerender } = render(
      <Harness
        metas={variants}
        variantSelections={{ '1': 5 }}
        shareSelection={{ enabled: true, sessionId: 1, selectedMessageIds: [3] }}
        onShareToggle={onShareToggle}
        onShareStart={onShareStart}
      />,
    )

    expect(screen.queryByTestId('bubble-a1')).toBeNull()
    expect(screen.getByTestId('bubble-a1b')).toBeInTheDocument()
    expect(bubbleProps.get('a1b')?.variantInfo).toMatchObject({ total: 2, index: 1 })
    expect(bubbleProps.get('u2')?.shareSelection).toMatchObject({ active: true, selected: true })
    expect(bubbleProps.get('u1')?.shareSelection).toMatchObject({ active: true, selected: false })

    const u1Before = renderCount('u1')
    const a1bBefore = renderCount('a1b')
    rerender(
      <Harness
        metas={variants}
        variantSelections={{ '1': 2 }}
        shareSelection={{ enabled: true, sessionId: 1, selectedMessageIds: [1] }}
        onShareToggle={onShareToggle}
        onShareStart={onShareStart}
      />,
    )
    expect(renderCount('u1')).toBeGreaterThan(u1Before)
    expect(renderCount('a1b')).toBe(a1bBefore)
    expect(screen.queryByTestId('bubble-a1b')).toBeNull()
    expect(bubbleProps.get('a1')?.variantInfo).toMatchObject({ total: 2, index: 0 })
  })

  it('supports external read-only bodies without binding to the chat store', () => {
    const externalBodies = buildBodies()
    const cache: Record<string, MessageRenderCacheEntry> = {}
    const External = ({ bodies, content }: { bodies: Record<string, MessageBody>; content: string }) => (
      <MessageList
        metas={metas}
        bodies={{ ...bodies, '4': { ...bodies['4'], content } }}
        renderCache={cache}
        isStreaming={false}
      />
    )
    const { rerender } = render(<External bodies={externalBodies} content="外部只读" />)
    expect(screen.getByTestId('bubble-a2')).toHaveTextContent('外部只读')

    const before = renderCount('a2')
    rerender(<External bodies={externalBodies} content="外部更新" />)
    expect(renderCount('a2')).toBeGreaterThan(before)
    expect(screen.getByTestId('bubble-a2')).toHaveTextContent('外部更新')
  })

  it('marks research_plan rejected rows unshareable through the row body subscription', () => {
    useChatStore.setState({
      messageBodies: {
        ...buildBodies(),
        '2': {
          ...buildBody(2, 'a1', '计划已拒绝'),
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
    render(
      <Harness shareSelection={{ enabled: true, sessionId: 1, selectedMessageIds: [] }} />,
    )

    expect(bubbleProps.get('a1')?.shareSelection).toMatchObject({ active: true, selectable: false })
    expect(bubbleProps.get('a2')?.shareSelection).toMatchObject({ active: true, selectable: true })
  })

  it('batches virtual row measurements into a single frame', async () => {
    measuredRows.count = 0
    render(<Harness />)
    expect(measuredRows.count).toBe(0)

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(measuredRows.count).toBe(4)
  })
})
