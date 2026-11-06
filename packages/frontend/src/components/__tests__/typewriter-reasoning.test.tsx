import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'

describe('TypewriterReasoning', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces burst text updates into one frame callback', () => {
    vi.useFakeTimers()
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const { rerender } = render(<TypewriterReasoning text="你" isStreaming />)
    const before = rafSpy.mock.calls.length

    rerender(<TypewriterReasoning text="你好" isStreaming />)
    rerender(<TypewriterReasoning text="你好世" isStreaming />)
    rerender(<TypewriterReasoning text="你好世界" isStreaming />)

    expect(rafSpy.mock.calls.length - before).toBeLessThanOrEqual(1)
  })

  it('shows the full text and stops scheduling frames when streaming ends', () => {
    vi.useFakeTimers()
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const { container, rerender } = render(<TypewriterReasoning text="你" isStreaming />)

    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender(<TypewriterReasoning text="你好世界" isStreaming={false} />)
    expect(container.textContent).toContain('你好世界')

    const after = rafSpy.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(rafSpy.mock.calls.length).toBe(after)
  })
})
