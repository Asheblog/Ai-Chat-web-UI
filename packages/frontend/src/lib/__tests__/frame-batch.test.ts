import { describe, expect, it, vi } from 'vitest'
import { createFrameBatch } from '@/lib/frame-batch'

describe('createFrameBatch', () => {
  it('deduplicates work and flushes once per frame', () => {
    const scheduled: Array<() => void> = []
    const flush = vi.fn()
    const batch = createFrameBatch<string>(flush, {
      schedule: (callback: () => void) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancel: vi.fn(),
    })

    batch.push('a')
    batch.push('a')
    batch.push('b')
    expect(scheduled).toHaveLength(1)

    scheduled.shift()?.()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(['a', 'b'])
  })

  it('cancels pending work on teardown', () => {
    const cancel = vi.fn()
    const batch = createFrameBatch<string>(vi.fn(), {
      schedule: () => 42,
      cancel,
    })

    batch.push('pending')
    batch.cancel()
    expect(cancel).toHaveBeenCalledWith(42)
  })
})
