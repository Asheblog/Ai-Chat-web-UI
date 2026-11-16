import { createReadBudget, DEFAULT_PHASE_LIMITS } from '../budget'

describe('createReadBudget', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-16T00:00:00Z'))
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('dispose removes the caller-signal listener from the combined budget', () => {
    const listeners = new Set<() => void>()
    const external = {
      aborted: false,
      reason: undefined,
      addEventListener: (_event: string, listener: () => void) => { listeners.add(listener) },
      removeEventListener: (_event: string, listener: () => void) => { listeners.delete(listener) },
      throwIfAborted: () => undefined,
    } as unknown as AbortSignal
    const budget = createReadBudget({ totalMs: 30_000, signal: external })
    const lease = budget.beginPhase('crawler')
    expect(listeners.size).toBeGreaterThan(0)

    budget.dispose()

    expect(listeners.size).toBe(0)
    lease.release()
  })

  test('caps the native phase at five seconds inside a longer deadline', () => {
    const budget = createReadBudget({ totalMs: 30_000 })
    const lease = budget.beginPhase('native')
    expect(lease.remainingMs()).toBe(5_000)
    lease.release()
  })

  test('caps crawler and feed phases and keeps the overall deadline', () => {
    const budget = createReadBudget({ totalMs: 30_000 })
    jest.setSystemTime(Date.now() + 1_000)
    expect(budget.beginPhase('crawler').remainingMs()).toBe(3_000)
    expect(budget.beginPhase('feed').remainingMs()).toBe(1_500)
    expect(budget.remainingMs()).toBe(29_000)
  })

  test('never lets a phase outlive the overall deadline', () => {
    const budget = createReadBudget({ totalMs: 2_000 })
    expect(budget.beginPhase('native').remainingMs()).toBe(2_000)
  })

  test('phase expiry aborts only the phase lease, not the overall budget', async () => {
    const budget = createReadBudget({ totalMs: 30_000 })
    const lease = budget.beginPhase('feed')
    let aborted = false
    lease.signal.addEventListener('abort', () => { aborted = true }, { once: true })
    await jest.advanceTimersByTimeAsync(1_500)
    expect(aborted).toBe(true)
    expect(budget.stopError()).toBeUndefined()
    expect(budget.beginPhase('browser').remainingMs()).toBeGreaterThan(0)
  })

  test('release clears the phase timer', async () => {
    const budget = createReadBudget({ totalMs: 30_000 })
    const lease = budget.beginPhase('native')
    lease.release()
    let aborted = false
    lease.signal.addEventListener('abort', () => { aborted = true }, { once: true })
    await jest.advanceTimersByTimeAsync(6_000)
    expect(aborted).toBe(false)
    expect(lease.signal.aborted).toBe(false)
  })

  test('caller cancellation reports CANCELLED and aborts outstanding leases', async () => {
    const controller = new AbortController()
    const budget = createReadBudget({ totalMs: 30_000, signal: controller.signal })
    const lease = budget.beginPhase('browser')
    controller.abort()
    expect(budget.stopError()).toMatchObject({ errorCode: 'CANCELLED' })
    expect(lease.signal.aborted).toBe(true)
  })

  test('overall deadline reports TIMEOUT and stops new phases', async () => {
    const budget = createReadBudget({ totalMs: 1_000 })
    const lease = budget.beginPhase('native')
    await jest.advanceTimersByTimeAsync(1_000)
    expect(budget.stopError()).toMatchObject({ errorCode: 'TIMEOUT' })
    expect(lease.signal.aborted).toBe(true)
    expect(budget.beginPhase('browser').remainingMs()).toBe(0)
  })

  test('exposes default phase limits and lets callers tighten them', () => {
    expect(DEFAULT_PHASE_LIMITS).toMatchObject({ native: 5_000, crawler: 3_000, feed: 1_500 })
    const budget = createReadBudget({ totalMs: 30_000, phaseLimits: { native: 1_200 } })
    expect(budget.beginPhase('native').remainingMs()).toBe(1_200)
  })
})
