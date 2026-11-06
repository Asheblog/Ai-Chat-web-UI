import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useReadingNav } from '@/hooks/use-reading-nav'
import type { MessageMeta } from '@/types'

const metas: MessageMeta[] = [
  { id: 1, sessionId: 1, stableKey: 'u1', role: 'user', createdAt: '2026-11-06T00:00:00.000Z' },
  { id: 2, sessionId: 1, stableKey: 'a1', role: 'assistant', createdAt: '2026-11-06T00:00:01.000Z' },
  { id: 3, sessionId: 1, stableKey: 'u2', role: 'user', createdAt: '2026-11-06T00:00:02.000Z' },
]

const buildBody = (id: number, stableKey: string, content: string) => ({
  id,
  stableKey,
  content,
  version: 1,
  reasoningVersion: 0,
})

const bodies = {
  '1': buildBody(1, 'u1', '第一问'),
  '2': buildBody(2, 'a1', '第一答'),
  '3': buildBody(3, 'u2', '第二问'),
}

describe('useReadingNav', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('measures at most once per frame for burst scroll and resize events', async () => {
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 })
    const rectSpy = vi.spyOn(viewport, 'getBoundingClientRect')
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const node = document.createElement('div')
    node.setAttribute('data-reading-key', 'u1')
    node.getBoundingClientRect = () => ({ top: 30, bottom: 90 } as DOMRect)
    viewport.appendChild(node)
    const root = document.createElement('div')
    root.appendChild(viewport)
    document.body.appendChild(root)

    renderHook(() => {
      const scrollAreaRef = useRef<HTMLDivElement | null>(root)
      const messageListApiRef = useRef<any>(null)
      return useReadingNav({
        sessionId: 1,
        metas,
        bodies,
        scrollAreaRef,
        messageListApiRef,
        isMessagesLoading: false,
      })
    })

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    const beforeRaf = rafSpy.mock.calls.length
    const beforeRect = rectSpy.mock.calls.length

    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
      viewport.dispatchEvent(new Event('scroll'))
      viewport.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    })

    expect(rafSpy.mock.calls.length - beforeRaf).toBe(1)
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(rectSpy.mock.calls.length - beforeRect).toBe(1)
  })
})
