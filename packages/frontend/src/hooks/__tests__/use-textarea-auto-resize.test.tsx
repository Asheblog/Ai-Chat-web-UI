import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { useTextareaAutoResize } from '@/hooks/use-textarea-auto-resize'
import { COMPOSER_TEXTAREA_BASE_CLASS } from '@/components/chat/composer-shell-styles'

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')

function installMirrorScrollHeight() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.getAttribute('data-composer-textarea-mirror') === 'true') {
        const raw = (this as HTMLTextAreaElement).value ?? ''
        if (!raw) return 0
        const lineHeight = parseFloat(this.style.lineHeight) || 20
        const width = parseFloat(this.style.width) || 120
        const charsPerLine = width >= 180 ? 8 : 4
        const lines = raw.split('\n').reduce((total: number, line: string) => {
          return total + Math.max(1, Math.ceil(line.length / charsPerLine))
        }, 0)
        return lines * lineHeight
      }
      return 0
    },
  })
}

function Harness({ value, maxHeight = 200 }: { value: string; maxHeight?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { showExpand } = useTextareaAutoResize(textareaRef, value, maxHeight)
  return (
    <div>
      <textarea
        ref={textareaRef}
        defaultValue=""
        data-testid="composer-textarea"
        style={{ minHeight: 40, lineHeight: '20px', padding: 0 }}
      />
      <span data-testid="show-expand">{String(showExpand)}</span>
    </div>
  )
}

function DualHarness({ value, active }: { value: string; active: 'mobile' | 'desktop' }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { showExpand } = useTextareaAutoResize(textareaRef, value, 200, active)
  return (
    <div>
      <textarea
        ref={active === 'mobile' ? textareaRef : undefined}
        data-testid="mobile-textarea"
        defaultValue=""
        style={{ minHeight: 40, lineHeight: '20px', padding: 0 }}
      />
      <textarea
        ref={active === 'desktop' ? textareaRef : undefined}
        data-testid="desktop-textarea"
        defaultValue=""
        style={{ minHeight: 40, lineHeight: '20px', padding: 0 }}
      />
      <span data-testid="show-expand">{String(showExpand)}</span>
    </div>
  )
}

const setClientWidth = (element: HTMLElement, width: number) => {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
}

describe('useTextareaAutoResize', () => {
  beforeAll(() => {
    installMirrorScrollHeight()
  })

  afterAll(() => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('measures through an offscreen mirror and keeps empty input at the computed minimum', async () => {
    const { getByTestId } = render(<Harness value="" />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)

    await waitFor(() => expect(document.querySelector('[data-composer-textarea-mirror="true"]')).not.toBeNull())
    await waitFor(() => expect(textarea.style.height).toBe('40px'))
  })

  it('grows, shrinks and caps overflow without rewriting unchanged heights', async () => {
    const { getByTestId, rerender } = render(<Harness value={'第一行\n第二行'} />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)

    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    rerender(<Harness value={'第一行\n第二行\n第三行\n第四行'} />)
    await waitFor(() => expect(textarea.style.height).toBe('80px'))

    rerender(<Harness value="一行" />)
    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    const longValue = Array.from({ length: 14 }, (_, index) => `第${index}行`).join('\n')
    rerender(<Harness value={longValue} />)
    await waitFor(() => expect(textarea.style.height).toBe('200px'))
    expect(getByTestId('show-expand')).toHaveTextContent('true')
  })

  it('coalesces value changes into one measurement and remeasures after width changes', async () => {
    const { getByTestId, rerender } = render(<Harness value="a" />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)
    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    const mirror = document.querySelector('[data-composer-textarea-mirror="true"]') as HTMLElement
    expect(mirror).not.toBeNull()
    let measureCount = 0
    Object.defineProperty(mirror, 'scrollHeight', {
      configurable: true,
      get: () => {
        measureCount += 1
        const raw = (mirror as HTMLTextAreaElement).value
        if (!raw) return 0
        return raw.split('\n').length * 20
      },
    })

    rerender(<Harness value="ab" />)
    rerender(<Harness value="abc" />)
    rerender(<Harness value="abcd" />)
    await waitFor(() => expect(measureCount).toBe(1))

    setClientWidth(textarea, 200)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await waitFor(() => expect(measureCount).toBeGreaterThan(1))
  })

  it('removes the mirror on unmount and drops the height transition', async () => {
    const { unmount } = render(<Harness value="内容" />)
    await waitFor(() => expect(document.querySelector('[data-composer-textarea-mirror="true"]')).not.toBeNull())
    unmount()
    expect(document.querySelector('[data-composer-textarea-mirror="true"]')).toBeNull()
    expect(COMPOSER_TEXTAREA_BASE_CLASS).not.toContain('transition-[height]')
  })

  it('keeps the mirror intact across Chinese IME composition and paste bursts', async () => {
    const { getByTestId, rerender } = render(<Harness value="" />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)
    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    rerender(<Harness value="ni" />)
    rerender(<Harness value="你" />)
    await waitFor(() => expect(textarea.style.height).toBe('40px'))
    expect(document.querySelectorAll('[data-composer-textarea-mirror="true"]')).toHaveLength(1)

    rerender(<Harness value={'第一行\n第二行\n第三行'} />)
    await waitFor(() => expect(textarea.style.height).toBe('60px'))
    expect(document.querySelectorAll('[data-composer-textarea-mirror="true"]')).toHaveLength(1)
  })

  it('remeasures when the textarea width changes without a window resize', async () => {
    const observers: Array<{ callback: () => void; targets: Element[]; disconnect: () => void }> = []
    const Original = window.ResizeObserver
    class MockResizeObserver {
      entry: { callback: () => void; targets: Element[]; disconnect: () => void }
      constructor(callback: () => void) {
        this.entry = { callback, targets: [], disconnect: vi.fn() }
        observers.push(this.entry)
      }
      observe(target: Element) {
        this.entry.targets.push(target)
      }
      unobserve() {}
      disconnect() {
        this.entry.disconnect()
      }
    }
    ;(window as any).ResizeObserver = MockResizeObserver

    const { getByTestId } = render(<Harness value={'abcdefghijklmnop'} />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)
    await waitFor(() => expect(textarea.style.height).toBe('80px'))

    const observer = observers.find((entry) => entry.targets.includes(textarea))
    expect(observer).toBeTruthy()

    setClientWidth(textarea, 200)
    act(() => {
      observer!.callback()
    })
    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    // 高度变化本身不能触发再次测量。
    const calls = observers.length
    act(() => {
      observer!.callback()
    })
    expect(observers.length).toBe(calls)
    ;(window as any).ResizeObserver = Original
  })

  it('remeasures once when webfonts finish loading', async () => {
    const listeners = new Set<() => void>()
    const originalFonts = document.fonts
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      },
    })

    const { getByTestId, unmount } = render(<Harness value={'abcdefghijklmnop'} />)
    const textarea = getByTestId('composer-textarea') as HTMLTextAreaElement
    setClientWidth(textarea, 120)
    await waitFor(() => expect(textarea.style.height).toBe('80px'))
    expect(listeners.size).toBe(1)

    setClientWidth(textarea, 200)
    act(() => {
      listeners.forEach((listener) => listener())
    })
    await waitFor(() => expect(textarea.style.height).toBe('40px'))

    unmount()
    expect(listeners.size).toBe(0)
    Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts })
  })

  it('measures the newly visible textarea when the active composer changes', async () => {
    const value = '第一行\n第二行\n第三行\n第四行'
    const { getByTestId, rerender } = render(<DualHarness value={value} active="mobile" />)
    const mobile = getByTestId('mobile-textarea') as HTMLTextAreaElement
    const desktop = getByTestId('desktop-textarea') as HTMLTextAreaElement
    setClientWidth(mobile, 120)
    setClientWidth(desktop, 120)

    await waitFor(() => expect(mobile.style.height).toBe('80px'))
    expect(desktop.style.height).toBe('')

    rerender(<DualHarness value={value} active="desktop" />)
    await waitFor(() => expect(desktop.style.height).toBe('80px'))
  })
})
