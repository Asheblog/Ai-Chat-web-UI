/**
 * 单进程共享 Chromium 池。
 *
 * - 默认只允许 1 个并行 context（可配置到 4，不允许无限并发），等待队列有界。
 * - 每次读取使用独立 context，完成或取消只关闭自己的 context。
 * - 进程空闲 15 秒后关闭；idle 定时器 unref，不阻止进程退出。
 * - 每次准入都会检查容器内存余量（launch 前、launch 后、出队后建 context 前）；
 *   内存信号是建议性的，不声称硬内存上限。
 */

import { chromium } from 'playwright-core'
import { combineAbortSignals } from '../../abort-signal'
import { assessBrowserMemory, type BrowserMemoryAssessment } from './memory'

const DEFAULT_IDLE_MS = 15_000
const DEFAULT_CONCURRENCY = 1
const MAX_CONCURRENCY = 4
const DEFAULT_QUEUE_MAX = 2
const MAX_QUEUE_MAX = 8
const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

export type BrowserPurpose = 'read' | 'pdf'

export interface RouteLike {
  request?: () => { resourceType?: () => string; url?: () => string }
  abort: (errorCode?: string) => Promise<void> | void
  continue: () => Promise<void> | void
}

export interface BrowserPageLike {
  route?: (pattern: string, handler: (route: RouteLike) => Promise<void> | void) => Promise<unknown> | unknown
  goto?: (url: string, options?: Record<string, unknown>) => Promise<unknown>
  content: () => Promise<string>
  title: () => Promise<string>
  url: () => string
  evaluate?: (script: string, arg?: unknown) => Promise<unknown>
  waitForFunction?: (script: string, arg?: unknown, options?: Record<string, unknown>) => Promise<unknown>
  waitForLoadState?: (state: string, options?: Record<string, unknown>) => Promise<unknown>
  setContent?: (html: string, options?: Record<string, unknown>) => Promise<void>
  pdf?: (options: Record<string, unknown>) => Promise<Buffer | Uint8Array>
}

export interface BrowserContextLike {
  newPage: () => Promise<BrowserPageLike>
  close: () => Promise<void>
}

export interface BrowserLike {
  newContext: (options?: Record<string, unknown>) => Promise<BrowserContextLike>
  close: () => Promise<void>
  on?: (event: 'disconnected', handler: () => void) => void
  isConnected?: () => boolean
}

export interface SharedBrowserPageOptions {
  executablePath: string
  purpose: BrowserPurpose
  signal?: AbortSignal
  remainingMs?: () => number
  userAgent?: string
}

export interface SharedBrowserConfig {
  launch?: (executablePath: string) => Promise<BrowserLike>
  assessMemory?: () => Promise<BrowserMemoryAssessment>
}

export class BrowserCapacityError extends Error {
  readonly code: 'BROWSER_MEMORY' | 'BROWSER_QUEUE_FULL'

  constructor(code: 'BROWSER_MEMORY' | 'BROWSER_QUEUE_FULL', message: string) {
    super(message)
    this.name = 'BrowserCapacityError'
    this.code = code
  }
}

export class BrowserCrashError extends Error {
  readonly code = 'BROWSER_CRASHED'

  constructor(message = '浏览器进程已退出，未完成的渲染已取消') {
    super(message)
    this.name = 'BrowserCrashError'
  }
}

export class BrowserLaunchError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'BrowserLaunchError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

interface QueuedWaiter {
  resolve: () => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

interface PoolState {
  browser?: BrowserLike
  browserExecutablePath?: string
  browserPromise?: Promise<BrowserLike>
  activeSlots: Set<number>
  nextSlotId: number
  queue: QueuedWaiter[]
  idleTimer?: ReturnType<typeof setTimeout>
  crashRejects: Set<(error: unknown) => void>
  stats: {
    launched: number
    closed: number
    contextsOpened: number
    contextsClosed: number
    idleCloses: number
    launchFailures: number
    memorySkips: number
    pressureAborts: number
    crashed: number
  }
}

const createState = (): PoolState => ({
  activeSlots: new Set(),
  nextSlotId: 1,
  queue: [],
  crashRejects: new Set(),
  stats: {
    launched: 0,
    closed: 0,
    contextsOpened: 0,
    contextsClosed: 0,
    idleCloses: 0,
    launchFailures: 0,
    memorySkips: 0,
    pressureAborts: 0,
    crashed: 0,
  },
})

let state = createState()
let config: SharedBrowserConfig = {}

const readIntEnv = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt((value || '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const concurrency = (): number =>
  readIntEnv(process.env.URL_READER_BROWSER_CONCURRENCY, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY)
const queueMax = (): number =>
  readIntEnv(process.env.URL_READER_BROWSER_QUEUE_MAX, DEFAULT_QUEUE_MAX, 0, MAX_QUEUE_MAX)
const idleMs = (): number =>
  readIntEnv(process.env.URL_READER_BROWSER_IDLE_MS, DEFAULT_IDLE_MS, 1_000, 300_000)

export const abortError = (reason?: unknown): DOMException =>
  reason instanceof DOMException ? reason : new DOMException('Request was cancelled', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal.reason)
}

export function scheduleUnrefTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(handler, ms)
  timer.unref?.()
  return timer
}

const defaultLaunch = async (executablePath: string): Promise<BrowserLike> => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-sandbox',
      // 单进程、低堆上限：PDF 与网页读取共用同一个浏览器，仍按任务串行执行。
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=128',
    ],
  })
  return browser as unknown as BrowserLike
}

const clearIdleTimer = (): void => {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = undefined
  }
}

const scheduleIdleClose = (): void => {
  clearIdleTimer()
  if (state.activeSlots.size > 0) return
  state.idleTimer = scheduleUnrefTimeout(() => {
    state.idleTimer = undefined
    if (state.activeSlots.size === 0) {
      void closeBrowser('idle')
    }
  }, idleMs())
}

const closeBrowser = async (reason: 'idle' | 'shutdown' | 'executable-changed' | 'launch-check'): Promise<void> => {
  clearIdleTimer()
  const browser = state.browser
  state.browser = undefined
  state.browserExecutablePath = undefined
  if (!browser) return
  try {
    await browser.close()
  } catch {
    // A dead browser still counts as released; the next read relaunches.
  }
  state.stats.closed += 1
  if (reason === 'idle') state.stats.idleCloses += 1
}

const checkMemory = async (): Promise<void> => {
  const assess = config.assessMemory ?? (() => assessBrowserMemory())
  const verdict = await assess()
  if (verdict.allowed) return
  state.stats.memorySkips += 1
  const detail = verdict.reason === 'low-container-limit'
    ? `容器内存上限低于建议值（${Math.round(verdict.minContainerLimitBytes / (1024 * 1024))} MiB）`
    : verdict.reason === 'low-headroom'
      ? `容器可用内存余量低于建议值（${Math.round(verdict.minHeadroomBytes / (1024 * 1024))} MiB）`
      : '内存检查未通过'
  throw new BrowserCapacityError('BROWSER_MEMORY', `浏览器渲染已跳过：${detail}，请稍后重试`)
}

const handleDisconnect = (browser: BrowserLike): void => {
  if (state.browser !== browser) return
  state.browser = undefined
  state.browserExecutablePath = undefined
  // 崩溃后旧 generation 的 lease 不能再扣减新任务的占用。
  state.activeSlots.clear()
  state.stats.crashed += 1
  clearIdleTimer()
  const error = new BrowserCrashError()
  const rejects = [...state.crashRejects]
  state.crashRejects.clear()
  for (const reject of rejects) reject(error)
  const waiters = state.queue.splice(0, state.queue.length)
  for (const waiter of waiters) {
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.reject(error)
  }
}

const ensureBrowser = async (executablePath: string, remainingMs = 30_000): Promise<BrowserLike> => {
  if (state.browser) {
    if (state.browserExecutablePath === executablePath) return state.browser
    await closeBrowser('executable-changed')
  }
  if (!state.browserPromise) {
    const created = (async (): Promise<BrowserLike> => {
      await checkMemory()
      const launch = config.launch ?? defaultLaunch
      let browser: BrowserLike
      const launchTimeout = Math.max(1_000, Math.min(10_000, remainingMs))
      try {
        browser = await withTimeout(launch(executablePath), launchTimeout, 'browser launch')
      } catch (error) {
        state.stats.launchFailures += 1
        throw new BrowserLaunchError(
          `浏览器启动失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      try {
        await checkMemory()
      } catch (error) {
        await browser.close().catch(() => undefined)
        throw error
      }
      try {
        browser.on?.('disconnected', () => handleDisconnect(browser))
      } catch {
        // Older adapters may not expose events; reads still work.
      }
      state.browser = browser
      state.browserExecutablePath = executablePath
      state.stats.launched += 1
      return browser
    })()
    state.browserPromise = created
    created.catch(() => undefined)
    try {
      return await created
    } finally {
      if (state.browserPromise === created) state.browserPromise = undefined
    }
  }
  return state.browserPromise
}

const acquire = async (signal?: AbortSignal): Promise<number> => {
  throwIfAborted(signal)
  await checkMemory()
  // 等待内存检查期间可能被取消，不能再把已取消的任务排进队列。
  throwIfAborted(signal)
  if (state.activeSlots.size < concurrency() && state.queue.length === 0) {
    const slotId = state.nextSlotId++
    state.activeSlots.add(slotId)
    clearIdleTimer()
    return slotId
  }
  if (state.queue.length >= queueMax()) {
    throw new BrowserCapacityError(
      'BROWSER_QUEUE_FULL',
      `浏览器渲染队列已满（最多 ${queueMax()} 个等待任务），请稍后重试`,
    )
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason))
      return
    }
    const waiter: QueuedWaiter = { resolve, reject, signal }
    if (signal) {
      waiter.onAbort = () => {
        const index = state.queue.indexOf(waiter)
        if (index >= 0) state.queue.splice(index, 1)
        reject(abortError(signal.reason))
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
    }
    state.queue.push(waiter)
  })
  clearIdleTimer()
  const slotId = state.nextSlotId++
  state.activeSlots.add(slotId)
  return slotId
}

const release = (slotId: number): void => {
  const owned = state.activeSlots.delete(slotId)
  // 旧 generation 的 finally 不参与新任务的计数；只有在容量允许时才继续出队。
  if (!owned && state.activeSlots.size >= concurrency()) return
  const next = state.queue.shift()
  if (next) {
    if (next.onAbort && next.signal) next.signal.removeEventListener('abort', next.onAbort)
    next.resolve()
    return
  }
  if (state.activeSlots.size === 0) scheduleIdleClose()
}

const buildContextOptions = (options: SharedBrowserPageOptions): Record<string, unknown> => {
  if (options.purpose === 'pdf') {
    return { locale: 'zh-CN' }
  }
  return {
    userAgent: options.userAgent || CRAWLER_USER_AGENT,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  }
}

const applyRoutes = async (page: BrowserPageLike, purpose: BrowserPurpose): Promise<void> => {
  if (!page.route) return
  const settle = (action: () => Promise<void> | void): Promise<void> =>
    Promise.resolve().then(action).catch(() => undefined)
  await page.route('**/*', async (route) => {
    const request = route.request?.()
    const resourceType = request?.resourceType?.() || ''
    const requestUrl = request?.url?.() || ''
    // PDF 渲染保持完全离线；读取渲染只阻断大资源，保留脚本与 XHR/fetch。
    if (purpose === 'pdf' && /^https?:/i.test(requestUrl)) {
      await settle(() => route.abort())
      return
    }
    if (resourceType === 'media' || resourceType === 'font') {
      await settle(() => route.abort())
      return
    }
    await settle(() => route.continue())
  })
}

const createGuard = (signal?: AbortSignal) => {
  let rejectFailure: ((error: unknown) => void) | undefined
  let cleanupAbort = () => undefined as void
  let failed = false
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  const rejectFailureAndMark = (error: unknown) => {
    failed = true
    rejectFailure?.(error)
  }
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!signal) return
    const onAbort = () => {
      failed = true
      reject(abortError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupAbort = () => signal.removeEventListener('abort', onAbort)
  })
  state.crashRejects.add(rejectFailureAndMark)
  return {
    race: <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, failure, aborted]) as Promise<T>,
    fail: (error: unknown) => rejectFailureAndMark(error),
    failed: () => failed,
    cleanup: () => {
      cleanupAbort()
      state.crashRejects.delete(rejectFailureAndMark)
    },
  }
}

const DEFAULT_PRESSURE_POLL_MS = 1_000

/** 渲染期间每秒探测一次容器余量；跌破阈值即结束本次任务，避免继续吃内存。 */
const startPressureMonitor = (fail: (error: unknown) => void): (() => void) => {
  const assess = config.assessMemory ?? (() => assessBrowserMemory())
  const timer = setInterval(() => {
    void assess().then((verdict) => {
      if (verdict.allowed) return
      state.stats.pressureAborts += 1
      fail(new BrowserCapacityError(
        'BROWSER_MEMORY',
        '浏览器渲染已中止：容器内存余量低于建议值，任务已关闭以避免挤占服务内存',
      ))
    }).catch(() => undefined)
  }, DEFAULT_PRESSURE_POLL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function withSharedBrowserPage<T>(
  options: SharedBrowserPageOptions,
  task: (page: BrowserPageLike, context: BrowserContextLike) => Promise<T>,
): Promise<T> {
  throwIfAborted(options.signal)
  const slotId = await acquire(options.signal)
  const guard = createGuard(options.signal)
  let slotHeld = true
  let context: BrowserContextLike | undefined
  let stopPressureMonitor: (() => void) | undefined
  try {
    // 取消发生在 acquire 与首个 await 之间时，必须在 try 内抛出，slot 才会释放。
    throwIfAborted(options.signal)
    const browser = await guard.race(ensureBrowser(options.executablePath, options.remainingMs?.() ?? 30_000))
    // 出队后、建 context 前再检查一次：等待期间内存可能已被其它任务占用。
    await guard.race(checkMemory())
    const contextPromise = browser.newContext(buildContextOptions(options))
    void contextPromise.then(async (lateContext) => {
      // 只有本次任务已失败（取消/崩溃）时才需要回收晚到的 context；
      // 成功路径上 context 变量可能尚未赋值，但任务仍在正常使用它。
      if (!guard.failed() && !options.signal?.aborted) return
      if (lateContext === context) return
      await lateContext.close().catch(() => undefined)
    }).catch(() => undefined)
    context = await guard.race(contextPromise)
    state.stats.contextsOpened += 1
    stopPressureMonitor = startPressureMonitor((error) => guard.fail(error))
    const page = await guard.race(context.newPage())
    await applyRoutes(page, options.purpose)
    return await guard.race(task(page, context))
  } finally {
    stopPressureMonitor?.()
    guard.cleanup()
    if (context) {
      try {
        await withTimeout(context.close(), 2_000, 'context close')
        state.stats.contextsClosed += 1
      } catch {
        // Context may already be gone after a crash; the slot is still released.
      }
    }
    if (slotHeld) {
      slotHeld = false
      release(slotId)
    }
  }
}

export interface RenderWithSharedBrowserOptions extends Omit<SharedBrowserPageOptions, 'purpose'> {
  waitMs?: number
}

const MAX_RENDER_PHASE_MS = 8_000

const clampWaitMs = (value?: number): number => {
  if (!Number.isFinite(value) || (value as number) < 0) return 1_500
  return Math.max(0, Math.min(8_000, Math.floor(value as number)))
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.() })

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const waitForContentSignal = async (
  page: BrowserPageLike,
  options: { waitMs?: number; remainingMs?: number },
): Promise<void> => {
  const cap = Math.min(clampWaitMs(options.waitMs), Math.max(0, options.remainingMs ?? 30_000))
  if (cap <= 0 || !page.waitForFunction) return
  try {
    await Promise.race([
      page.waitForFunction(
        `() => {
          const body = document.body;
          const text = (body?.innerText || '').trim();
          const paragraphs = body ? body.querySelectorAll('p').length : 0;
          return text.length > 400 || paragraphs >= 3;
        }`,
        undefined,
        { polling: 250, timeout: cap },
      ),
      delay(cap),
    ])
  } catch {
    // Content signal is best-effort; the caller still gets the current DOM.
  }
}

export async function renderWithSharedBrowser(
  url: string,
  options: RenderWithSharedBrowserOptions,
): Promise<{ html: string; finalUrl: string; title: string }> {
  // 浏览器阶段自身独立预算：覆盖排队、launch、导航、内容信号与取回 DOM；
  // 总预算更短时只使用剩余时间，且与调用方取消信号合并。
  const cap = Math.max(1, Math.min(MAX_RENDER_PHASE_MS, options.remainingMs?.() ?? MAX_RENDER_PHASE_MS))
  const phaseController = new AbortController()
  const phaseDeadline = Date.now() + cap
  const timer = scheduleUnrefTimeout(() => {
    phaseController.abort(new DOMException('browser render phase exceeded', 'TimeoutError'))
  }, cap)
  const combined = combineAbortSignals(options.signal, phaseController.signal)
  const phaseRemaining = () => Math.max(1, Math.min(cap, phaseDeadline - Date.now()))
  try {
    return await withSharedBrowserPage(
      { ...options, purpose: 'read', signal: combined.signal, remainingMs: phaseRemaining },
      async (page) => {
        await page.goto?.(url, { waitUntil: 'domcontentloaded', timeout: phaseRemaining() })
        await waitForContentSignal(page, { waitMs: options.waitMs, remainingMs: phaseRemaining() })
        return {
          html: await page.content(),
          finalUrl: page.url(),
          title: await page.title().catch(() => ''),
        }
      },
    )
  } finally {
    clearTimeout(timer)
    combined.cleanup()
  }
}

export interface SharedBrowserStats {
  launched: number
  closed: number
  contextsOpened: number
  contextsClosed: number
  active: number
  queued: number
  idleCloses: number
  launchFailures: number
  memorySkips: number
  pressureAborts: number
  crashed: number
  connected: boolean
}

export function getSharedBrowserStats(): SharedBrowserStats {
  return {
    ...state.stats,
    active: state.activeSlots.size,
    queued: state.queue.length,
    connected: Boolean(state.browser),
  }
}

export function configureSharedBrowser(next: SharedBrowserConfig): void {
  config = { ...config, ...next }
}

export async function shutdownSharedBrowser(): Promise<void> {
  await closeBrowser('shutdown')
}

export async function resetSharedBrowserForTests(): Promise<void> {
  clearIdleTimer()
  const waiters = state.queue.splice(0, state.queue.length)
  for (const waiter of waiters) {
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.reject(new BrowserCrashError('测试重置'))
  }
  const rejects = [...state.crashRejects]
  state.crashRejects.clear()
  for (const reject of rejects) reject(new BrowserCrashError('测试重置'))
  const browser = state.browser
  state.browser = undefined
  state.browserExecutablePath = undefined
  state.browserPromise = undefined
  if (browser) await browser.close().catch(() => undefined)
  state = createState()
  config = {}
}