import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { forwardRef, useRef, useState } from 'react'

const listRenders = vi.hoisted(() => ({ count: 0 }))
const readingNavCalls = vi.hoisted(() => ({ count: 0 }))
const readingInputs = vi.hoisted(() => ({ bodies: [] as Array<Record<string, { content?: string | null }>> }))

vi.mock('@/components/message-list', () => ({
  MessageList: forwardRef(function MockMessageList() {
    listRenders.count += 1
    return <div data-testid="message-list" />
  }),
}))

vi.mock('@/components/chat/share-dialog', () => ({
  ShareDialog: () => null,
}))

vi.mock('@/hooks/use-reading-nav', () => ({
  useReadingNav: (params: any) => {
    readingNavCalls.count += 1
    readingInputs.bodies.push(params.bodies)
    return { entries: [], activeKey: null, visible: false, jumpToKey: vi.fn() }
  },
}))

import { ChatMessageViewport } from '@/components/chat/chat-message-viewport'
import { ConnectedMessageViewport } from '@/components/chat/connected-message-viewport'
import { useChatStore } from '@/store/chat-store'

const session = { id: 1, userId: 1, title: '测试会话', createdAt: '2026-11-06T00:00:00.000Z' } as any
const metas = [
  { id: 1, sessionId: 1, stableKey: 'u1', role: 'user' as const, createdAt: '2026-11-06T00:00:00.000Z' },
]

const Parent = () => {
  const [input, setInput] = useState('')
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const variantSelections = useRef<Record<string, number | string>>({})
  return (
    <>
      <textarea aria-label="input" value={input} onChange={(e) => setInput(e.target.value)} />
      <ChatMessageViewport
        scrollAreaRef={scrollAreaRef}
        error={null}
        metas={metas}
        isStreaming={false}
        isLoading={false}
        isAutoScrollEnabled
        variantSelections={variantSelections.current}
        sessionId={1}
        sessionTitle="测试会话"
      />
    </>
  )
}

describe('ChatMessageViewport isolation', () => {
  beforeEach(() => {
    listRenders.count = 0
    readingNavCalls.count = 0
    readingInputs.bodies = []
    useChatStore.setState({
      currentSession: session,
      messageMetas: metas,
      messageBodies: { '1': { id: 1, stableKey: 'u1', content: '问题', version: 1, reasoningVersion: 0 } },
      shareSelection: { enabled: false, sessionId: null, selectedMessageIds: [] },
    })
  })

  it('does not rerender the message list while the composer input changes', () => {
    render(<Parent />)
    const before = listRenders.count

    fireEvent.change(screen.getByLabelText('input'), { target: { value: '逐' } })
    fireEvent.change(screen.getByLabelText('input'), { target: { value: '逐字' } })

    expect(listRenders.count).toBe(before)
  })

  it('keeps a composer-shaped subscriber out of streaming chunk updates', () => {
    const assistantMeta = {
      id: 2,
      sessionId: 1,
      stableKey: 'a1',
      role: 'assistant' as const,
      createdAt: '2026-11-06T00:00:01.000Z',
    }
    useChatStore.setState({
      messageMetas: [...metas, assistantMeta],
      messageBodies: {
        '1': { id: 1, stableKey: 'u1', content: '问题', version: 1, reasoningVersion: 0 },
        '2': { id: 2, stableKey: 'a1', content: '回答', version: 1, reasoningVersion: 0 },
      },
    })
    const composerRenders = { count: 0 }
    const ComposerProbe = () => {
      const input = useState('')
      const isStreaming = useChatStore((state) => state.isStreaming)
      composerRenders.count += 1
      return (
        <textarea
          aria-label="probe-input"
          value={input[0]}
          onChange={(event) => input[1](event.target.value)}
          data-streaming={String(isStreaming)}
        />
      )
    }

    render(
      <>
        <ComposerProbe />
        <ConnectedMessageViewport />
      </>
    )
    const composerBefore = composerRenders.count
    const readingBefore = readingNavCalls.count

    act(() => {
      const current = useChatStore.getState()
      useChatStore.setState({
        messageBodies: {
          ...current.messageBodies,
          '2': { ...current.messageBodies['2'], content: '流式追加', version: 2, reasoningVersion: 1 },
        },
      })
    })

    // 助手 chunk 不改变用户轮摘要：阅读目录不重算，composer 也不参与。
    expect(readingNavCalls.count).toBe(readingBefore)
    expect(composerRenders.count).toBe(composerBefore)
  })

  it('keeps the same reading summary object when only assistant chunks change', () => {
    const assistantMeta = {
      id: 2,
      sessionId: 1,
      stableKey: 'a1',
      role: 'assistant' as const,
      createdAt: '2026-11-06T00:00:01.000Z',
    }
    useChatStore.setState({
      messageMetas: [...metas, assistantMeta],
      messageBodies: {
        '1': { id: 1, stableKey: 'u1', content: '问题', version: 1, reasoningVersion: 0 },
        '2': { id: 2, stableKey: 'a1', content: '回答', version: 1, reasoningVersion: 0 },
      },
    })
    render(<ConnectedMessageViewport />)
    const before = readingInputs.bodies.at(-1)
    expect(before).toBeTruthy()

    act(() => {
      const current = useChatStore.getState()
      useChatStore.setState({
        messageBodies: {
          ...current.messageBodies,
          '2': { ...current.messageBodies['2'], content: '回答继续追加', version: 2, reasoningVersion: 1 },
        },
      })
    })

    const after = readingInputs.bodies.at(-1)
    expect(after).toBe(before)
  })
})
