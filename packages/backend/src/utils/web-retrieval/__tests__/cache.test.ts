import {
  BoundedMemoryStore,
  InFlightReads,
  resolveReadCacheTtlMs,
  isTimeSensitiveUrl,
} from '../cache'

describe('BoundedMemoryStore', () => {
  test('bounds entries and evicts the oldest', () => {
    const store = new BoundedMemoryStore<string>({ maxEntries: 3, maxBytes: 1024 })
    store.set('a', 'a', { bytes: 1, ttlMs: 1000 })
    store.set('b', 'b', { bytes: 1, ttlMs: 1000 })
    store.set('c', 'c', { bytes: 1, ttlMs: 1000 })
    store.set('d', 'd', { bytes: 1, ttlMs: 1000 })
    expect(store.stats().entries).toBe(3)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('d')?.value).toBe('d')
  })

  test('bounds total bytes and refuses oversized single entries', () => {
    const store = new BoundedMemoryStore<string>({ maxEntries: 10, maxBytes: 10 })
    store.set('a', 'a', { bytes: 6, ttlMs: 1000 })
    store.set('b', 'b', { bytes: 6, ttlMs: 1000 })
    expect(store.stats()).toMatchObject({ entries: 1, bytes: 6 })
    store.set('huge', 'huge', { bytes: 11, ttlMs: 1000 })
    expect(store.get('huge')).toBeUndefined()
    expect(store.stats().bytes).toBeLessThanOrEqual(10)
  })

  test('expires entries by ttl using the injected clock', () => {
    let now = 1_000
    const store = new BoundedMemoryStore<string>({ maxEntries: 4, maxBytes: 64, now: () => now })
    store.set('a', 'a', { bytes: 1, ttlMs: 120_000 })
    now += 119_999
    expect(store.get('a')?.value).toBe('a')
    now += 1
    expect(store.get('a')).toBeUndefined()
    expect(store.stats().entries).toBe(0)
  })

  test('clear drops all entries and bytes', () => {
    const store = new BoundedMemoryStore<string>({ maxEntries: 4, maxBytes: 64 })
    store.set('a', 'a', { bytes: 4, ttlMs: 1000 })
    store.clear()
    expect(store.stats()).toEqual({ entries: 0, bytes: 0 })
  })
})

describe('resolveReadCacheTtlMs', () => {
  test('keeps ordinary articles at 30 minutes', () => {
    expect(resolveReadCacheTtlMs('https://example.com/blog/post')).toBe(30 * 60_000)
  })

  test('shortens news-like pages to 2 minutes', () => {
    expect(resolveReadCacheTtlMs('https://example.com/news/2026/11/16/item')).toBe(2 * 60_000)
    expect(resolveReadCacheTtlMs('https://finance.example.com/2026/11/16/item')).toBe(2 * 60_000)
  })

  test('honours an explicit ttl but caps it at 30 minutes', () => {
    expect(resolveReadCacheTtlMs('https://example.com/blog/post', 5_000)).toBe(5_000)
    expect(resolveReadCacheTtlMs('https://example.com/blog/post', 60 * 60_000)).toBe(30 * 60_000)
  })

  test('marks quote and price pages as time sensitive', () => {
    expect(isTimeSensitiveUrl('https://xueqiu.com/S/SH600519')).toBe(true)
    expect(isTimeSensitiveUrl('https://example.com/quote/AAPL')).toBe(true)
    expect(isTimeSensitiveUrl('https://example.com/blog/post')).toBe(false)
  })
})

describe('InFlightReads', () => {
  test('shares one task across subscribers of the same key', async () => {
    const reads = new InFlightReads<string>()
    const task = jest.fn(async () => new Promise<string>((resolve) => setTimeout(() => resolve('value'), 10)))
    const first = reads.run('k', task)
    const second = reads.run('k', task)
    expect(task).toHaveBeenCalledTimes(1)
    expect(await first).toBe('value')
    expect(await second).toBe('value')
  })

  test('runs different keys separately', async () => {
    const reads = new InFlightReads<string>()
    const task = jest.fn(async () => 'v')
    await Promise.all([reads.run('a', task), reads.run('b', task)])
    expect(task).toHaveBeenCalledTimes(2)
  })

  test('a cancelled subscriber stops waiting without killing the shared task', async () => {
    const reads = new InFlightReads<string>()
    const controller = new AbortController()
    let resolveTask: ((value: string) => void) | undefined
    let taskSignal: AbortSignal | undefined
    const task = (signal: AbortSignal) => {
      taskSignal = signal
      return new Promise<string>((resolve) => { resolveTask = resolve })
    }
    const cancelled = reads.run('k', task, controller.signal)
    const alive = reads.run('k', task)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(taskSignal?.aborted).toBe(false)
    resolveTask?.('value')
    await expect(alive).resolves.toBe('value')
  })

  test('aborts the shared task only when the last subscriber leaves', async () => {
    const reads = new InFlightReads<string>()
    const firstController = new AbortController()
    const secondController = new AbortController()
    let taskSignal: AbortSignal | undefined
    const task = (signal: AbortSignal) => {
      taskSignal = signal
      return new Promise<string>(() => undefined)
    }
    const first = reads.run('k', task, firstController.signal)
    const second = reads.run('k', task, secondController.signal)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(taskSignal?.aborted).toBe(false)
    secondController.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(taskSignal?.aborted).toBe(true)
  })

  test('clears the in-flight entry after completion and failure', async () => {
    const reads = new InFlightReads<string>()
    await expect(reads.run('k', async () => 'ok')).resolves.toBe('ok')
    expect(reads.size).toBe(0)
    await expect(reads.run('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(reads.size).toBe(0)
    await expect(reads.run('k', async () => 'again')).resolves.toBe('again')
  })

  test('keeps dedup for an existing key even when the in-flight bound is exhausted', async () => {
    const reads = new InFlightReads<string>({ maxInFlight: 1 })
    let release: (() => void) | undefined
    const first = reads.run('a', () => new Promise<string>((resolve) => { release = () => resolve('a') }))
    const sameKey = reads.run('a', async () => 'should-not-run')
    const otherKey = reads.run('b', async () => 'b')
    await expect(otherKey).resolves.toBe('b')
    release?.()
    await expect(first).resolves.toBe('a')
    await expect(sameKey).resolves.toBe('a')
  })

  test('does not hand an aborted task to a later subscriber', async () => {
    const reads = new InFlightReads<string>()
    const firstController = new AbortController()
    let taskSignals: AbortSignal[] = []
    const task = (signal: AbortSignal) => {
      taskSignals.push(signal)
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }
    const first = reads.run('k', task, firstController.signal)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads.size).toBe(0)

    const second = reads.run('k', async () => 'fresh')
    await expect(second).resolves.toBe('fresh')
    expect(taskSignals).toHaveLength(1)
  })

  test('bypasses sharing when the in-flight bound is exhausted', async () => {
    const reads = new InFlightReads<string>({ maxInFlight: 1 })
    let release: (() => void) | undefined
    const blocked = reads.run('a', () => new Promise<string>((resolve) => { release = () => resolve('a') }))
    const second = reads.run('b', async () => 'b')
    await expect(second).resolves.toBe('b')
    release?.()
    await expect(blocked).resolves.toBe('a')
  })
})
