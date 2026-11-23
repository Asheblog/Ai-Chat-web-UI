/**
 * 搜索引擎退避：进程内有界，按「连接 + 凭据身份 + 引擎 + endpoint 源」隔离。
 *
 * 目的与边界（#119）：
 * - 持续上游失败时停止打击同一个凭据，但不同连接/不同轮换凭据互不影响；
 * - 指数退避有上限，冷却后只放行一次半开探测（单飞，不允许并发绕过）；
 * - 取消、缺凭据、不支持与固定形态的无效响应不计入退避；
 * - 键里的凭据指纹只用于隔离，不写日志、不进模型载荷。
 */

import { createHash } from 'node:crypto'
import type { WebSearchTaskFailureKind } from '../../../utils/web-search'

export interface BackoffInspection {
  blocked: boolean
  /** 冷却结束，允许一次半开探测（需要先 acquireProbe 成功）。 */
  probe: boolean
  retryAfterMs: number
}

export interface EngineBackoffOptions {
  now?: () => number
  /** 连续多少次可重试失败后开启退避。 */
  threshold?: number
  baseMs?: number
  factor?: number
  maxMs?: number
  maxEntries?: number
  /** 冷却期内「提前探测」的最小间隔：保证探测自身也有界。 */
  minProbeIntervalMs?: number
}

const DEFAULT_OPTIONS: Required<EngineBackoffOptions> = {
  now: () => Date.now(),
  threshold: 2,
  baseMs: 5_000,
  factor: 2,
  maxMs: 60_000,
  maxEntries: 64,
  minProbeIntervalMs: 2_000,
}

/**
 * 只有可重试的失败才计入退避。
 * 取消是调用方行为，缺凭据/不支持是配置或能力问题，invalid_response 是契约不匹配：
 * 重试它们不会改变结果，只会延长问题。
 */
const RETRYABLE_FAILURE_KINDS: ReadonlySet<WebSearchTaskFailureKind> = new Set([
  'upstream_error',
  'rate_limited',
  'network',
  'timeout',
])

interface BackoffEntry {
  failures: number
  retryAt: number
  probeInFlight: boolean
  lastProbeAt: number | null
  lastUsedAt: number
}

export class EngineBackoffRegistry {
  private readonly options: Required<EngineBackoffOptions>
  private readonly entries = new Map<string, BackoffEntry>()

  constructor(options: EngineBackoffOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  inspect(key: string): BackoffInspection {
    const entry = this.entries.get(key)
    if (!entry || entry.failures < this.options.threshold) {
      return { blocked: false, probe: false, retryAfterMs: 0 }
    }
    const now = this.options.now()
    entry.lastUsedAt = now
    if (now >= entry.retryAt) return { blocked: false, probe: true, retryAfterMs: 0 }
    return { blocked: true, probe: false, retryAfterMs: entry.retryAt - now }
  }

  /**
   * 半开探测必须单飞：并发的同类请求不能各自绕过一次冷却。
   * allowCooling 用于「所有引擎都在冷却」时的一次受控提前探测，
   * 它同样受单飞与最小间隔约束，不会让每次请求都绕过退避。
   */
  acquireProbe(key: string, options: { allowCooling?: boolean } = {}): boolean {
    const entry = this.entries.get(key)
    if (!entry) return true
    if (entry.failures < this.options.threshold) return true
    if (entry.probeInFlight) return false
    const now = this.options.now()
    if (now >= entry.retryAt) {
      entry.probeInFlight = true
      entry.lastProbeAt = now
      return true
    }
    if (!options.allowCooling) return false
    if (entry.lastProbeAt !== null && now - entry.lastProbeAt < this.options.minProbeIntervalMs) return false
    entry.probeInFlight = true
    entry.lastProbeAt = now
    return true
  }

  releaseProbe(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.probeInFlight = false
  }

  recordSuccess(key: string): void {
    this.entries.delete(key)
  }

  recordFailure(
    key: string,
    kind: WebSearchTaskFailureKind,
    options: { retryAfterMs?: number } = {},
  ): void {
    if (!RETRYABLE_FAILURE_KINDS.has(kind)) return
    const now = this.options.now()
    const entry = this.entries.get(key) ?? {
      failures: 0,
      retryAt: 0,
      probeInFlight: false,
      lastProbeAt: null,
      lastUsedAt: now,
    }
    entry.failures += 1
    entry.lastUsedAt = now
    entry.probeInFlight = false
    // 上游显式给出 Retry-After 时直接进入冷却，不额外累计到阈值
    if (typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs)) {
      entry.failures = Math.max(entry.failures, this.options.threshold)
    }
    const exponent = Math.max(0, entry.failures - this.options.threshold)
    const exponential = this.options.baseMs * Math.pow(this.options.factor, exponent)
    const hinted = typeof options.retryAfterMs === 'number' ? Math.max(this.options.baseMs, options.retryAfterMs) : 0
    const delay = Math.min(this.options.maxMs, Math.max(exponential, hinted))
    entry.retryAt = now + delay
    this.entries.set(key, entry)
    this.evictOverflow()
  }

  size(): number {
    return this.entries.size
  }

  reset(): void {
    this.entries.clear()
  }

  private evictOverflow(): void {
    if (this.entries.size <= this.options.maxEntries) return
    let oldestKey: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt
        oldestKey = key
      }
    }
    if (oldestKey) this.entries.delete(oldestKey)
  }
}

/**
 * 凭据指纹只用于把不同 key 的退避状态隔离开，不输出、不落日志。
 * 同一份 key 轮换前后是不同的身份，各自独立恢复。
 */
export const credentialFingerprint = (apiKey?: string): string => {
  const key = (apiKey || '').trim()
  if (!key) return 'no-credential'
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

const endpointOrigin = (endpoint?: string): string => {
  if (!endpoint) return ''
  try {
    return new URL(endpoint).origin
  } catch {
    return endpoint
  }
}

export const buildEngineBackoffKey = (input: {
  engine: string
  apiKey?: string
  endpoint?: string
  connectionId?: number | null
}): string =>
  [
    input.connectionId ?? 'anonymous',
    input.engine.trim().toLowerCase(),
    credentialFingerprint(input.apiKey),
    endpointOrigin(input.endpoint),
  ].join('|')

let registry = new EngineBackoffRegistry()

export const getEngineBackoff = (): EngineBackoffRegistry => registry

/** 测试与进程级重置：清空所有引擎的退避状态。 */
export const resetWebSearchBackoff = (): void => {
  registry = new EngineBackoffRegistry()
}
