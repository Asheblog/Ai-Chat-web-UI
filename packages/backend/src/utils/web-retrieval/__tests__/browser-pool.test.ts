import {
  configureSharedBrowser,
  getSharedBrowserStats,
  resetSharedBrowserForTests,
  renderWithSharedBrowser,
  scheduleUnrefTimeout,
  shutdownSharedBrowser,
  withSharedBrowserPage,
} from '../browser/pool'

const MiB = 1024 * 1024

interface FakePage {
  closed: boolean
  route: jest.Mock
  content: jest.Mock
  title: jest.Mock
  url: jest.Mock
  goto: jest.Mock
  evaluate: jest.Mock
  waitForFunction: jest.Mock
  setContent: jest.Mock
  pdf: jest.Mock
}

const makeBrowser = () => {
  const pages: FakePage[] = []
  const contexts: Array<{ closed: boolean; newPage: jest.Mock; close: jest.Mock }> = []
  const browser = {
    closed: false,
    disconnectHandlers: [] as Array<() => void>,
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'disconnected') browser.disconnectHandlers.push(handler)
    }),
    newContext: jest.fn(async () => {
      const page: FakePage = {
        closed: false,
        route: jest.fn(async () => undefined),
        content: jest.fn(async () => '<html><body>rendered</body></html>'),
        title: jest.fn(async () => 'rendered title'),
        url: jest.fn(() => 'https://example.com/final'),
        goto: jest.fn(async () => undefined),
        evaluate: jest.fn(async () => undefined),
        waitForFunction: jest.fn(async () => true),
        setContent: jest.fn(async () => undefined),
        pdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')),
      }
      pages.push(page)
      const context = {
        closed: false,
        newPage: jest.fn(async () => page),
        close: jest.fn(async () => { context.closed = true }),
      }
      contexts.push(context)
      return context
    }),
    close: jest.fn(async () => { browser.closed = true }),
  }
  return { browser, pages, contexts }
}

const allowMemory = () => Promise.resolve({
  allowed: true,
  advisory: true as const,
  snapshot: { signal: 'freemem' as const, headroomBytes: 2048 * MiB, advisory: true as const },
  minHeadroomBytes: 256 * MiB,
  minContainerLimitBytes: 768 * MiB,
})

describe('shared browser pool', () => {
  beforeEach(async () => {
    jest.useRealTimers()
    await resetSharedBrowserForTests()
  })
  afterEach(async () => {
    await resetSharedBrowserForTests()
    jest.useRealTimers()
  })

  test('reuses one browser across sequential reads and closes each context', async () => {
    const fake = makeBrowser()
    const launch = jest.fn(async () => fake.browser as never)
    configureSharedBrowser({ launch, assessMemory: allowMemory })

    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async (page) => {
      await page.goto?.('https://example.com/a')
      return 'a'
    })
    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async (page) => {
      await page.goto?.('https://example.com/b')
      return 'b'
    })

    expect(launch).toHaveBeenCalledTimes(1)
    expect(fake.contexts).toHaveLength(2)
    expect(fake.contexts.every((context) => context.closed)).toBe(true)
    expect(fake.browser.closed).toBe(false)
    expect(getSharedBrowserStats()).toMatchObject({ launched: 1, active: 0, queued: 0 })
  })

  test('serialises contexts: concurrency stays at one', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    let active = 0
    let maxActive = 0
    const task = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    }
    await Promise.all([
      withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, task),
      withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, task),
    ])
    expect(maxActive).toBe(1)
  })

  test('a crashed generation lease cannot release the next generation slot', async () => {
    const first = makeBrowser()
    const second = makeBrowser()
    const launches = [first.browser, second.browser]
    configureSharedBrowser({
      launch: jest.fn(async () => launches.shift() as never),
      assessMemory: allowMemory,
    })
    let hold: (() => void) | undefined
    const taskOne = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, () =>
      new Promise<void>((resolve) => { hold = resolve }))
    await new Promise((resolve) => setTimeout(resolve, 5))

    let observedActive = -1
    const taskTwo = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => {
      observedActive = getSharedBrowserStats().active
      return 'second'
    })

    first.browser.disconnectHandlers.forEach((handler) => handler())
    await expect(taskOne).rejects.toBeTruthy()
    await expect(taskTwo).resolves.toBe('second')
    hold?.()

    expect(observedActive).toBe(1)
    expect(getSharedBrowserStats()).toMatchObject({ active: 0, crashed: 1, launched: 2, queued: 0 })
  })

  test('rejects when the bounded queue is full', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    let release: (() => void) | undefined
    const first = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, () =>
      new Promise<void>((resolve) => { release = resolve }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => undefined)
    const third = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => undefined)
    const fourth = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => undefined)

    await expect(fourth).rejects.toMatchObject({ code: 'BROWSER_QUEUE_FULL' })
    release?.()
    await first
    await second
    await third
  })

  test('skips rendering on low memory before launching', async () => {
    const fake = makeBrowser()
    const launch = jest.fn(async () => fake.browser as never)
    configureSharedBrowser({
      launch,
      assessMemory: async () => ({
        allowed: false,
        reason: 'low-headroom',
        advisory: true as const,
        snapshot: { signal: 'cgroup-v2' as const, usageBytes: 900 * MiB, limitBytes: 1024 * MiB, headroomBytes: 124 * MiB, advisory: true as const },
        minHeadroomBytes: 256 * MiB,
        minContainerLimitBytes: 768 * MiB,
      }),
    })

    await expect(
      withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'x'),
    ).rejects.toMatchObject({ code: 'BROWSER_MEMORY' })
    expect(launch).not.toHaveBeenCalled()
    expect(getSharedBrowserStats().memorySkips).toBe(1)
  })

  test('re-checks memory after launch and before creating a context', async () => {
    const fake = makeBrowser()
    const disallowed = {
      allowed: false as const,
      reason: 'low-headroom' as const,
      advisory: true as const,
      snapshot: { signal: 'cgroup-v2' as const, headroomBytes: 10 * MiB, advisory: true as const },
      minHeadroomBytes: 256 * MiB,
      minContainerLimitBytes: 768 * MiB,
    }
    const assessments = [allowMemory(), allowMemory(), Promise.resolve(disallowed)]
    const assessMemory = jest.fn(async () => assessments.shift()!)
    const launch = jest.fn(async () => fake.browser as never)
    configureSharedBrowser({ launch, assessMemory })

    await expect(
      withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'x'),
    ).rejects.toMatchObject({ code: 'BROWSER_MEMORY' })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(fake.contexts).toHaveLength(0)
    expect(assessMemory.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  test('cancelling a queued read removes it without touching the browser', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    let release: (() => void) | undefined
    const first = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, () =>
      new Promise<void>((resolve) => { release = resolve }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const controller = new AbortController()
    const queued = withSharedBrowserPage(
      { executablePath: 'chromium', purpose: 'read', signal: controller.signal },
      async () => 'queued',
    )
    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    release?.()
    await first
    expect(getSharedBrowserStats().queued).toBe(0)
  })

  test('cancelling a running read closes its own context and releases the slot', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    const controller = new AbortController()
    const running = withSharedBrowserPage(
      { executablePath: 'chromium', purpose: 'read', signal: controller.signal },
      () => new Promise<void>(() => undefined),
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.contexts[0]?.closed).toBe(true)
    expect(getSharedBrowserStats().active).toBe(0)
  })

  test('closes a context that arrives after cancellation', async () => {
    const fake = makeBrowser()
    let resolveContext: ((context: never) => void) | undefined
    fake.browser.newContext = jest.fn(() => new Promise((resolve) => { resolveContext = resolve as never }))
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    const controller = new AbortController()
    const running = withSharedBrowserPage(
      { executablePath: 'chromium', purpose: 'read', signal: controller.signal },
      async () => 'late',
    ).catch((error) => error as { name?: string })
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    expect((await running).name).toBe('AbortError')

    const lateContext = { newPage: jest.fn(), close: jest.fn(async () => undefined) }
    resolveContext?.(lateContext as never)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(lateContext.close).toHaveBeenCalledTimes(1)
    expect(getSharedBrowserStats().active).toBe(0)
  })

  test('closes an idle browser after 15 seconds and relaunches later', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-16T00:00:00Z'))
    const first = makeBrowser()
    const second = makeBrowser()
    const launch = jest.fn()
      .mockResolvedValueOnce(first.browser as never)
      .mockResolvedValueOnce(second.browser as never)
    configureSharedBrowser({ launch, assessMemory: allowMemory })

    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'a')
    expect(getSharedBrowserStats().connected).toBe(true)
    await jest.advanceTimersByTimeAsync(15_000)
    expect(first.browser.closed).toBe(true)
    expect(getSharedBrowserStats()).toMatchObject({ idleCloses: 1, connected: false })

    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'b')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('unrefs the idle timer so it cannot hold the process open', () => {
    const unref = jest.fn()
    const original = global.setTimeout
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((handler: () => void, _ms: number) => {
      const timer = original(handler, 0)
      return Object.assign(timer, { unref }) as never
    }) as never)
    try {
      scheduleUnrefTimeout(() => undefined, 15_000)
      expect(unref).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  test('settles queued work and relaunches after the browser crashes', async () => {
    const first = makeBrowser()
    const second = makeBrowser()
    const launch = jest.fn()
      .mockResolvedValueOnce(first.browser as never)
      .mockResolvedValueOnce(second.browser as never)
    configureSharedBrowser({ launch, assessMemory: allowMemory })

    let release: (() => void) | undefined
    const running = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, () =>
      new Promise<void>((resolve) => { release = resolve }))
    const queued = withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'queued')
    await new Promise((resolve) => setTimeout(resolve, 5))
    first.browser.disconnectHandlers.forEach((handler) => handler())
    await expect(running).rejects.toBeDefined()
    await expect(queued).rejects.toMatchObject({ code: 'BROWSER_CRASHED' })
    release?.()
    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'after')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('caps the browser render phase at eight seconds or the remaining budget', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })

    await renderWithSharedBrowser('https://example.com/full', {
      executablePath: 'chromium',
      remainingMs: () => 30_000,
      waitMs: 0,
    })
    const fullTimeout = fake.pages[0].goto.mock.calls[0]?.[1]?.timeout as number
    expect(fullTimeout).toBeGreaterThan(7_000)
    expect(fullTimeout).toBeLessThanOrEqual(8_000)

    await renderWithSharedBrowser('https://example.com/short', {
      executablePath: 'chromium',
      remainingMs: () => 2_500,
      waitMs: 0,
    })
    const shortTimeout = fake.pages[1].goto.mock.calls[0]?.[1]?.timeout as number
    expect(shortTimeout).toBeGreaterThan(2_000)
    expect(shortTimeout).toBeLessThanOrEqual(2_500)
  })

  test('aborts the active context when rendering memory pressure appears', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-16T00:00:00Z'))
    const fake = makeBrowser()
    const allowed = {
      allowed: true as const,
      advisory: true as const,
      snapshot: { signal: 'cgroup-v2' as const, headroomBytes: 2048 * MiB, advisory: true as const },
      minHeadroomBytes: 256 * MiB,
      minContainerLimitBytes: 768 * MiB,
    }
    const disallowed = {
      allowed: false as const,
      reason: 'low-headroom' as const,
      advisory: true as const,
      snapshot: { signal: 'cgroup-v2' as const, headroomBytes: 64 * MiB, advisory: true as const },
      minHeadroomBytes: 256 * MiB,
      minContainerLimitBytes: 768 * MiB,
    }
    // 准入三次检查放行，随后渲染期间的压力探测拒绝。
    const assessMemory = jest.fn()
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValue(disallowed)
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory })

    const running = withSharedBrowserPage(
      { executablePath: 'chromium', purpose: 'read' },
      () => new Promise<string>(() => undefined),
    ).catch((error) => error as { code?: string })
    await jest.advanceTimersByTimeAsync(0)
    await jest.advanceTimersByTimeAsync(1_100)

    await expect(running).resolves.toMatchObject({ code: 'BROWSER_MEMORY' })
    expect(fake.contexts[0]?.closed).toBe(true)
    expect(getSharedBrowserStats()).toMatchObject({ active: 0, pressureAborts: 1 })
  })

  test('shutdown closes the browser and clears state', async () => {
    const fake = makeBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    await withSharedBrowserPage({ executablePath: 'chromium', purpose: 'read' }, async () => 'a')
    await shutdownSharedBrowser()
    expect(fake.browser.closed).toBe(true)
    expect(getSharedBrowserStats().connected).toBe(false)
  })
})