import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDesktopComposer } from '@/hooks/use-desktop-composer'

const installMatchMedia = (initialMatches: boolean) => {
  const listeners = new Set<(event: { matches: boolean }) => void>()
  let matches = initialMatches
  const mql = {
    get matches() {
      return matches
    },
    media: '(min-width: 768px)',
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener)
    },
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => mql),
  })
  return {
    change(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener({ matches }))
    },
    listenerCount: () => listeners.size,
  }
}

describe('useDesktopComposer', () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('follows the md(768px) breakpoint used by the composer classes', () => {
    const media = installMatchMedia(false)
    const { result, unmount } = renderHook(() => useDesktopComposer())

    expect(result.current).toBe(false)
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)')

    act(() => media.change(true))
    expect(result.current).toBe(true)

    unmount()
    expect(media.listenerCount()).toBe(0)
  })
})
