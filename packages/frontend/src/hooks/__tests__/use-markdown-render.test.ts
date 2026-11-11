import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarkdownRender } from '../use-markdown-render'
import { requestMarkdownRender, type RenderResponse } from '@/lib/markdown-worker-client'

const { readyListeners } = vi.hoisted(() => ({ readyListeners: new Set<() => void>() }))
vi.mock('@/lib/markdown-worker-client', () => ({
  requestMarkdownRender: vi.fn(),
  subscribeMarkdownWorkerReady: vi.fn((listener: () => void) => {
    readyListeners.add(listener)
    return () => { readyListeners.delete(listener) }
  }),
}))
const response = (content: string, version: number): RenderResponse => ({ contentHtml: '<p>' + content + '</p>', contentVersion: version, reasoningVersion: 0 })

describe('useMarkdownRender latest snapshot', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(requestMarkdownRender).mockReset(); readyListeners.clear() })
  afterEach(() => { vi.useRealTimers() })

  it('accepts an in-flight append snapshot and flushes the final snapshot without starvation', async () => {
    const pending: Array<(value: RenderResponse) => void> = []
    vi.mocked(requestMarkdownRender).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const { result, rerender } = renderHook(({ text, version, streaming }) => useMarkdownRender({ identity: 'session:one', content: text, version, isStreaming: streaming }), { initialProps: { text: 'one', version: 1, streaming: true } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender({ text: 'one two', version: 2, streaming: true })
    await act(async () => pending[0](response('one', 1)))
    expect(result.current.html).toBe('<p>one</p>')
    expect(result.current.source).toBe('one')
    rerender({ text: 'one two END', version: 3, streaming: false })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(requestMarkdownRender).toHaveBeenCalledTimes(2)
    expect(vi.mocked(requestMarkdownRender).mock.calls[1][0].content).toBe('one two END')
    await act(async () => pending[1](response('one two END', 3)))
    expect(result.current.html).toContain('END')
    expect(result.current.isRendering).toBe(false)
  })

  it('re-renders an errored snapshot when the worker signals ready', async () => {
    vi.mocked(requestMarkdownRender)
      .mockResolvedValueOnce({ ...response('', 1), contentHtml: null, errored: true, retryAfterMs: 5000 })
      .mockResolvedValueOnce(response('text', 1))
    const { result } = renderHook(() => useMarkdownRender({ identity: 'one', content: 'text', version: 1, isStreaming: false }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.errored).toBe(true)
    act(() => { readyListeners.forEach((listener) => listener()) })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.html).toBe('<p>text</p>')
    expect(result.current.errored).toBe(false)
    expect(requestMarkdownRender).toHaveBeenCalledTimes(2)
  })

  it('does not replay a successful snapshot when the worker signals ready', async () => {
    vi.mocked(requestMarkdownRender).mockResolvedValue(response('text', 1))
    const { result } = renderHook(() => useMarkdownRender({ identity: 'one', content: 'text', version: 1, isStreaming: false }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.html).toBe('<p>text</p>')
    act(() => { readyListeners.forEach((listener) => listener()) })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(requestMarkdownRender).toHaveBeenCalledTimes(1)
  })

  it('never displays stale results after replacement or identity reuse', async () => {
    const pending: Array<(value: RenderResponse) => void> = []
    vi.mocked(requestMarkdownRender).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const { result, rerender } = renderHook(({ text, identity }) => useMarkdownRender({ identity, content: text, version: 1, isStreaming: false }), { initialProps: { text: 'old', identity: 'first' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender({ text: 'new', identity: 'second' })
    await act(async () => pending[0](response('old', 1)))
    expect(result.current.html).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => pending[1](response('new', 1)))
    expect(result.current.html).toBe('<p>new</p>')
  })

  it('recovers the same failed snapshot after the worker cooldown', async () => {
    vi.mocked(requestMarkdownRender)
      .mockResolvedValueOnce({ ...response('', 1), contentHtml: null, errored: true })
      .mockResolvedValueOnce(response('text', 1))
    const { result } = renderHook(() => useMarkdownRender({ identity: 'one', content: 'text', version: 1, isStreaming: false }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.errored).toBe(true)
    expect(result.current.isRendering).toBe(false)
    expect(requestMarkdownRender).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(10001))
    expect(result.current.html).toBe('<p>text</p>')
    expect(result.current.errored).toBe(false)
    expect(requestMarkdownRender).toHaveBeenCalledTimes(2)
  })

  it('bounds recovery attempts and cancels recovery after unmount', async () => {
    vi.mocked(requestMarkdownRender).mockResolvedValue({ ...response('', 1), contentHtml: null, errored: true })
    const { unmount } = renderHook(() => useMarkdownRender({ identity: 'one', content: 'text', version: 1, isStreaming: false }))
    await act(() => vi.advanceTimersByTimeAsync(40000))
    expect(requestMarkdownRender).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    unmount()
    const next = renderHook(() => useMarkdownRender({ identity: 'two', content: 'next', version: 1, isStreaming: false }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    next.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates an old completed message when an edit keeps its prefix', async () => {
    const pending: Array<(value: RenderResponse) => void> = []
    vi.mocked(requestMarkdownRender).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const { result, rerender } = renderHook(({ text, version }) => useMarkdownRender({ identity: 'same', content: text, version, isStreaming: false }), { initialProps: { text: 'old', version: 1 } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender({ text: 'old edited', version: 2 })
    await act(async () => pending[0](response('old', 1)))
    expect(result.current.html).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => pending[1](response('old edited', 2)))
    expect(result.current.html).toBe('<p>old edited</p>')
  })
  it('ignores an in-flight result after unmount and clears the scheduled work', async () => {
    let resolve!: (value: RenderResponse) => void
    const onRendered = vi.fn()
    vi.mocked(requestMarkdownRender).mockImplementation(() => new Promise(done => { resolve = done }))
    const { unmount } = renderHook(() => useMarkdownRender({ identity: 'one', content: 'text', version: 1, isStreaming: false, onRendered }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(async () => resolve(response('text', 1)))
    expect(onRendered).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
