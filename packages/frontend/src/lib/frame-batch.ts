type FrameBatchOptions = {
  schedule?: (callback: () => void) => number
  cancel?: (handle: number) => void
}

export interface FrameBatch<T> {
  push: (value: T) => void
  cancel: () => void
  hasPending: () => boolean
}

const defaultSchedule = (callback: () => void): number => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return setTimeout(callback, 16) as unknown as number
}

const defaultCancel = (handle: number): void => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle)
    return
  }
  clearTimeout(handle)
}

export const createFrameBatch = <T,>(
  flush: (values: T[]) => void,
  options: FrameBatchOptions = {},
): FrameBatch<T> => {
  const schedule = options.schedule ?? defaultSchedule
  const cancel = options.cancel ?? defaultCancel
  const pending = new Set<T>()
  let handle: number | null = null

  const run = () => {
    handle = null
    if (pending.size === 0) return
    const values = Array.from(pending)
    pending.clear()
    flush(values)
  }

  return {
    push(value) {
      pending.add(value)
      if (handle !== null) return
      handle = schedule(run)
    },
    cancel() {
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
      pending.clear()
    },
    hasPending: () => handle !== null,
  }
}
