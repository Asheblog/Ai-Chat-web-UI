"use client"

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolEvent } from '@/types'
import { useToolTimeline } from '../useToolTimeline'

let streamingEvents: ToolEvent[] = []
let idCounter = 0

vi.mock('@/store/chat-store', () => ({
  useChatMessages: (selector: (state: { toolEvents: ToolEvent[] }) => ToolEvent[]) =>
    selector({ toolEvents: streamingEvents }),
}))

const createEvent = (overrides: Partial<ToolEvent> = {}): ToolEvent => ({
  id: overrides.id ?? `evt-${++idCounter}`,
  sessionId: overrides.sessionId ?? 1,
  messageId: overrides.messageId ?? 42,
  tool: overrides.tool ?? 'web_search',
  stage: overrides.stage ?? 'start',
  status: overrides.status ?? 'running',
  createdAt: overrides.createdAt ?? Date.now(),
  query: overrides.query,
  hits: overrides.hits,
  error: overrides.error,
  summary: overrides.summary,
  details: overrides.details,
})

describe('useToolTimeline', () => {
  beforeEach(() => {
    streamingEvents = []
    idCounter = 0
  })

  it('merges历史与流式事件并输出包含 start/result/error 的汇总', () => {
    streamingEvents = [
      createEvent({ id: 'stream-running', stage: 'start', status: 'running', createdAt: 30 }),
      createEvent({ id: 'stream-error', stage: 'error', status: 'error', createdAt: 50 }),
    ]
    const bodyEvents = [
      createEvent({
        id: 'body-result',
        stage: 'result',
        status: 'success',
        createdAt: 10,
      }),
    ]
    const { result } = renderHook(() =>
      useToolTimeline({ sessionId: 1, messageId: 42, bodyEvents }),
    )

    expect(result.current.timeline.map((event) => event.id)).toEqual([
      'body-result',
      'stream-running',
      'stream-error',
    ])
    expect(result.current.summary).not.toBeNull()
    expect(result.current.summary?.total).toBe(3)
    const text = result.current.summary?.summaryText || ''
    expect(text).toContain('完成 1 次')
    expect(text).toContain('进行中 1 次')
    expect(text).toContain('失败 1 次')
    expect(result.current.summary?.label).toContain('联网搜索')
  })

  it('忽略不同会话/消息的事件并按 id 去重', () => {
    streamingEvents = [
      createEvent({ id: 'duplicate', stage: 'start', createdAt: 20 }),
      createEvent({ id: 'duplicate', stage: 'result', status: 'success', createdAt: 25 }),
      createEvent({ id: 'other-session', sessionId: 9, createdAt: 30 }),
      createEvent({ id: 'other-message', messageId: 999, createdAt: 35 }),
    ]

    const { result } = renderHook(() =>
      useToolTimeline({ sessionId: 1, messageId: 42, bodyEvents: [] }),
    )

    expect(result.current.timeline).toHaveLength(1)
    expect(result.current.timeline[0].id).toBe('duplicate')
    expect(result.current.timeline[0].stage).toBe('result')
    expect(result.current.summary?.total).toBe(1)
  })

  it('无事件时返回空数组与 null summary', () => {
    const { result } = renderHook(() =>
      useToolTimeline({ sessionId: 1, messageId: 1, bodyEvents: undefined }),
    )
    expect(result.current.timeline).toEqual([])
    expect(result.current.summary).toBeNull()
  })
})
