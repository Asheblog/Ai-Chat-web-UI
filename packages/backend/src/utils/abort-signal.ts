export interface CombinedAbortSignal {
  signal: AbortSignal
  cleanup: () => void
}

export const combineAbortSignals = (
  ...signals: Array<AbortSignal | undefined>
): CombinedAbortSignal => {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', onAbort))
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup()
    },
  }
}
