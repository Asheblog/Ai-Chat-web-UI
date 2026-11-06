import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScrollPersistence } from '@/hooks/use-scroll-persistence'

interface FakeViewport extends HTMLElement {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

const createViewport = (initialScrollTop = 0): FakeViewport => {
  const viewport = document.createElement('div')
  viewport.setAttribute('data-radix-scroll-area-viewport', '')
  let scrollTop = initialScrollTop
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, writable: true, value: 1000 })
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(viewport, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
  })
  return viewport as FakeViewport
}

const installRoot = (viewport: HTMLElement) => {
  const root = document.createElement('div')
  root.appendChild(viewport)
  document.body.appendChild(root)
  return root
}

const renderScrollPersistence = (
  overrides: Partial<Parameters<typeof useScrollPersistence>[0]> = {},
  initialLoading = true,
) => {
  const viewport = createViewport(overrides.currentSessionId === undefined ? 600 : 0)
  const root = installRoot(viewport)
  const scrollAreaRef = { current: root }
  const loadOlderMessages = vi.fn().mockResolvedValue(undefined)
  const hook = renderHook(({ loading, metaCount }: { loading: boolean; metaCount: number }) => {
    const base = {
      currentSessionId: 1,
      sessionMessageMetas: Array.from({ length: metaCount }, (_, index) => ({ id: index + 1, role: 'user' })),
      currentSessionPagination: { hasOlder: true, isLoadingOlder: false },
      isMessagesLoading: loading,
      isStreaming: false,
      streamScrollAnchor: 'idle',
      loadOlderMessages,
      scrollAreaRef,
      ...overrides,
    }
    return useScrollPersistence({
      ...base,
    })
  }, { initialProps: { loading: initialLoading, metaCount: 1 } })
  hook.rerender({ loading: false, metaCount: 1 })
  return { ...hook, viewport, root, loadOlderMessages }
}

const flushFrame = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('useScrollPersistence', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('coalesces multiple scroll events into one measurement per frame', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const { viewport } = renderScrollPersistence()
    await flushFrame()
    const before = rafSpy.mock.calls.length

    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
      viewport.dispatchEvent(new Event('scroll'))
      viewport.dispatchEvent(new Event('scroll'))
    })

    expect(rafSpy.mock.calls.length - before).toBe(1)
    await flushFrame()
  })

  it('cancels pending frame work on unmount', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const { viewport, unmount } = renderScrollPersistence()
    await flushFrame()

    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
    })
    const pending = rafSpy.mock.results.at(-1)?.value as number
    unmount()
    expect(cancelSpy).toHaveBeenCalledWith(pending)
  })

  it('keeps the reading anchor after prepending older messages', async () => {
    const { viewport, rerender, loadOlderMessages } = renderScrollPersistence()
    await flushFrame()
    viewport.scrollTop = 20

    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
    })
    await flushFrame()
    expect(loadOlderMessages).toHaveBeenCalledWith(1)

    viewport.scrollHeight = 1600
    rerender({ loading: false, metaCount: 2 })
    await flushFrame()
    expect(viewport.scrollTop).toBe(620)
  })

  it('does not force the viewport to the bottom when the user scrolled up', async () => {
    const { viewport, rerender, result } = renderScrollPersistence()
    await flushFrame()
    viewport.scrollTop = 120
    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
    })
    await flushFrame()
    expect(result.current.isAutoScrollEnabled).toBe(false)

    viewport.scrollTop = 120
    rerender({ loading: false, metaCount: 1 })
    await flushFrame()
    expect(viewport.scrollTop).toBe(120)
  })

  it('forces the bottom on explicit request and resumes auto-scroll', async () => {
    const { viewport, result } = renderScrollPersistence()
    await flushFrame()
    viewport.scrollTop = 100
    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
    })
    await flushFrame()
    expect(result.current.isAutoScrollEnabled).toBe(false)

    act(() => {
      result.current.scrollToBottom(true)
    })
    expect(viewport.scrollTop).toBe(1000)
    expect(result.current.isAutoScrollEnabled).toBe(true)
  })
})
