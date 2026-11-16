/**
 * 单次网页读取的总预算与分阶段预算。
 *
 * 总时限（手动 30s / 自动 18s）由调用方传入的 timeout 决定，这里保持其含义；
 * 每个阶段只领取自己的上限，阶段到期不影响总预算，后续阶段仍可运行。
 * 调用方取消优先于超时，取消立即生效。
 */

import { combineAbortSignals } from '../abort-signal'

export type ReadPhase = 'native' | 'crawler' | 'feed' | 'browser' | 'python' | 'wayback'

export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000

export const DEFAULT_PHASE_LIMITS: Partial<Record<ReadPhase, number>> = {
  native: 5_000,
  crawler: 3_000,
  feed: 1_500,
  python: 4_000,
  wayback: 8_000,
}

export interface BudgetStopError {
  message: string
  errorCode: 'CANCELLED' | 'TIMEOUT'
}

export interface PhaseLease {
  phase: ReadPhase
  signal: AbortSignal
  remainingMs: () => number
  release: () => void
}

export interface ReadBudget {
  signal: AbortSignal
  remainingMs: () => number
  stopError: () => BudgetStopError | undefined
  beginPhase: (phase: ReadPhase) => PhaseLease
  dispose: () => void
}

export interface ReadBudgetOptions {
  totalMs: number
  signal?: AbortSignal
  phaseLimits?: Partial<Record<ReadPhase, number>>
  now?: () => number
  onExpire?: () => void
}

const abortError = (message: string): DOMException => new DOMException(message, 'AbortError')

export function createReadBudget(options: ReadBudgetOptions): ReadBudget {
  const now = options.now ?? Date.now
  const requested = Number.isFinite(options.totalMs) && options.totalMs > 0
    ? Math.max(1, Math.floor(options.totalMs))
    : DEFAULT_TOTAL_TIMEOUT_MS
  const deadline = now() + requested
  const phaseLimits = { ...DEFAULT_PHASE_LIMITS, ...(options.phaseLimits || {}) }

  const overallController = new AbortController()
  const expireOverall = () => {
    if (!overallController.signal.aborted) {
      overallController.abort(new DOMException('URL read deadline exceeded', 'TimeoutError'))
      options.onExpire?.()
    }
  }
  const timeoutId = setTimeout(expireOverall, requested)
  timeoutId.unref?.()

  const combined = combineAbortSignals(options.signal, overallController.signal)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timeoutId)
    combined.cleanup()
  }

  const remainingMs = () => {
    const remaining = Math.max(0, deadline - now())
    if (remaining === 0) expireOverall()
    return remaining
  }

  const stopError = (): BudgetStopError | undefined => {
    if (options.signal?.aborted) {
      return { message: 'Request was cancelled', errorCode: 'CANCELLED' }
    }
    if (overallController.signal.aborted || remainingMs() === 0) {
      return { message: `Request timeout after ${requested / 1000} seconds`, errorCode: 'TIMEOUT' }
    }
    return undefined
  }

  const beginPhase = (phase: ReadPhase): PhaseLease => {
    const stop = stopError()
    const phaseLimit = phaseLimits[phase]
    const remaining = Math.max(0, Math.min(phaseLimit ?? Number.POSITIVE_INFINITY, remainingMs()))
    const leaseController = new AbortController()
    let released = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const onBudgetAbort = () => {
      if (!leaseController.signal.aborted) leaseController.abort(combined.signal.reason)
    }
    if (combined.signal.aborted) {
      leaseController.abort(combined.signal.reason)
    } else {
      combined.signal.addEventListener('abort', onBudgetAbort, { once: true })
    }

    if (stop || remaining <= 0) {
      if (!leaseController.signal.aborted) {
        leaseController.abort(new DOMException('phase budget exhausted', 'TimeoutError'))
      }
    } else if (Number.isFinite(remaining) && phaseLimit !== undefined) {
      timer = setTimeout(() => {
        if (!leaseController.signal.aborted) {
          leaseController.abort(new DOMException('phase deadline exceeded', 'TimeoutError'))
        }
      }, remaining)
      timer.unref?.()
    }

    const release = () => {
      if (released) return
      released = true
      if (timer) clearTimeout(timer)
      combined.signal.removeEventListener('abort', onBudgetAbort)
    }

    return {
      phase,
      signal: leaseController.signal,
      remainingMs: () => Math.max(0, Math.min(phaseLimit ?? Number.POSITIVE_INFINITY, remainingMs())),
      release,
    }
  }

  return {
    signal: combined.signal,
    remainingMs,
    stopError,
    beginPhase,
    dispose,
  }
}

export { abortError }