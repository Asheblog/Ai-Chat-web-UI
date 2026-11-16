/**
 * 读取结果的有界内存缓存与同 key 在途共享。
 *
 * - 缓存有总字节与条目上限（默认 4 MiB / 32 条），过期即丢弃。
 * - 普通文章默认最多 30 分钟；可识别的新闻页 2 分钟；行情/报价等时效页面不使用正文缓存。
 * - 同 key（URL + freshness + 影响结果的配置）共享一次在途任务；单个订阅者取消只结束自己的等待，
 *   最后一个订阅者退出才终止共享任务。
 */

export interface BoundedStoreOptions {
  maxBytes?: number
  maxEntries?: number
  now?: () => number
}

export interface StoreEntry<T> {
  value: T
  storedAt: number
  expiresAt: number
  bytes: number
}

export interface StoreSetOptions {
  ttlMs: number
  bytes?: number
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 32
const MAX_CACHE_TTL_MS = 30 * 60_000
const NEWS_CACHE_TTL_MS = 2 * 60_000

export class BoundedMemoryStore<T> {
  private readonly entries = new Map<string, StoreEntry<T>>()
  private totalBytes = 0
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: BoundedStoreOptions = {}) {
    this.maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES)
    this.maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.now = options.now ?? Date.now
  }

  get(key: string): StoreEntry<T> | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      this.totalBytes -= entry.bytes
      return undefined
    }
    // Refresh insertion order so frequently used entries survive eviction.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, value: T, options: StoreSetOptions): void {
    const bytes = Math.max(0, options.bytes ?? 0)
    if (this.maxEntries === 0 || this.maxBytes === 0 || bytes > this.maxBytes) return
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.totalBytes -= existing.bytes
    }
    const storedAt = this.now()
    this.entries.set(key, {
      value,
      storedAt,
      expiresAt: storedAt + Math.max(0, options.ttlMs),
      bytes,
    })
    this.totalBytes += bytes
    this.evictOverflow()
  }

  delete(key: string): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.delete(key)
    this.totalBytes -= existing.bytes
  }

  clear(): void {
    this.entries.clear()
    this.totalBytes = 0
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.totalBytes }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) return
      const entry = this.entries.get(oldest)
      this.entries.delete(oldest)
      if (entry) this.totalBytes -= entry.bytes
    }
  }
}

const NEWS_URL_PATTERN = /(?:^|\/)(?:news|latest|breaking)(?:\/|$)|\/\d{4}\/\d{2}\/\d{2}\//i
const TIME_SENSITIVE_PATTERNS: RegExp[] = [
  /(?:^|[./_-])(?:quote|quotes|stock|stocks|price|ticker|kline|realtime)(?:[./_?=&-]|$)/i,
  /(?:^|[./_-])(?:hangqing)(?:[./_?=&-]|$)/i,
  /(?:^|[./_-])(?:行情|股价|报价)(?:[./_?=&-]|$)/,
]

const TIME_SENSITIVE_HOSTS = ['xueqiu.com', 'quote.eastmoney.com']

export const isTimeSensitiveUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (TIME_SENSITIVE_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) return true
    const haystack = `${parsed.pathname}${parsed.search}`
    return TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(haystack))
  } catch {
    return false
  }
}

export const isNewsLikeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    if (/(?:^|\.)news(?:\.|$)/i.test(parsed.hostname)) return true
    return NEWS_URL_PATTERN.test(parsed.pathname)
  } catch {
    return false
  }
}

export function resolveReadCacheTtlMs(url: string, explicitTtlMs?: number): number {
  if (typeof explicitTtlMs === 'number' && Number.isFinite(explicitTtlMs) && explicitTtlMs >= 0) {
    return Math.min(Math.floor(explicitTtlMs), MAX_CACHE_TTL_MS)
  }
  return isNewsLikeUrl(url) ? NEWS_CACHE_TTL_MS : MAX_CACHE_TTL_MS
}

const abortError = (reason?: unknown): DOMException => {
  if (reason instanceof DOMException) return reason
  return new DOMException('Request was cancelled', 'AbortError')
}

interface SharedTask<T> {
  controller: AbortController
  subscribers: number
  settled: boolean
  detached: boolean
  waiters: Set<{ resolve: (value: T) => void; reject: (error: unknown) => void; cleanup: () => void }>
}

export interface InFlightReadsOptions {
  maxInFlight?: number
}

export class InFlightReads<T> {
  private readonly tasks = new Map<string, SharedTask<T>>()
  private readonly maxInFlight: number

  constructor(options: InFlightReadsOptions = {}) {
    this.maxInFlight = Math.max(1, options.maxInFlight ?? 32)
  }

  get size(): number {
    return this.tasks.size
  }

  run(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason))

    // 先看同 key 是否已有共享任务；表满只影响新任务，不破坏同 key 去重。
    const existing = this.tasks.get(key)
    if (existing) return this.subscribe(key, existing, signal)

    if (this.tasks.size >= this.maxInFlight) {
      return this.runDirect(task, signal)
    }

    const controller = new AbortController()
    const shared: SharedTask<T> = {
      controller,
      subscribers: 0,
      settled: false,
      detached: false,
      waiters: new Set(),
    }
    this.tasks.set(key, shared)
    void task(controller.signal).then(
      (value) => this.settle(key, shared, value, undefined),
      (error) => this.settle(key, shared, undefined, error ?? new Error('shared read failed')),
    )
    return this.subscribe(key, shared, signal)
  }

  private subscribe(key: string, shared: SharedTask<T>, signal?: AbortSignal): Promise<T> {
    if (shared.settled) return this.runDirect((inner) => Promise.reject(new Error('settled')), signal)
    shared.subscribers += 1
    return new Promise<T>((resolve, reject) => {
      let done = false
      const onAbort = () => {
        if (done) return
        done = true
        cleanup()
        shared.subscribers -= 1
        reject(abortError(signal?.reason))
        if (shared.subscribers <= 0 && !shared.settled) {
          // 最后一个订阅者退出：立即摘除旧任务，避免后来的订阅者接到已 abort 的任务。
          shared.detached = true
          if (this.tasks.get(key) === shared) this.tasks.delete(key)
          shared.controller.abort(signal?.reason)
        }
      }
      const cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort)
        shared.waiters.delete(waiter)
      }
      const waiter = {
        resolve: (value: T) => {
          if (done) return
          done = true
          cleanup()
          shared.subscribers -= 1
          resolve(value)
        },
        reject: (error: unknown) => {
          if (done) return
          done = true
          cleanup()
          shared.subscribers -= 1
          reject(error)
        },
        cleanup,
      }
      shared.waiters.add(waiter)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private settle(key: string, shared: SharedTask<T>, value: T | undefined, error: unknown): void {
    if (shared.settled) return
    shared.settled = true
    // 只删除仍指向自己的条目；取消后新建的同 key 任务不能被旧任务结算误删。
    if (this.tasks.get(key) === shared) this.tasks.delete(key)
    const waiters = [...shared.waiters]
    shared.waiters.clear()
    for (const waiter of waiters) {
      if (error === undefined) waiter.resolve(value as T)
      else waiter.reject(error)
    }
  }

  private runDirect(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const combined = combineSignals(controller.signal, signal)
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortError(signal?.reason))
      if (signal) {
        if (signal.aborted) {
          combined.cleanup()
          reject(abortError(signal.reason))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      Promise.resolve(task(combined.signal)).then(
        (value) => {
          if (signal) signal.removeEventListener('abort', onAbort)
          combined.cleanup()
          resolve(value)
        },
        (error) => {
          if (signal) signal.removeEventListener('abort', onAbort)
          combined.cleanup()
          reject(error)
        },
      )
    })
  }
}

const combineSignals = (...signals: Array<AbortSignal | undefined>): { signal: AbortSignal; cleanup: () => void } => {
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
  return { signal: controller.signal, cleanup: () => { for (const cleanup of cleanups) cleanup() } }
}
