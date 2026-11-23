/**
 * Task Trace 纯工具与 Recorder。
 *
 * 配置代理（getTaskTraceConfig / shouldEnableTaskTrace / configureTaskTraceUtils）
 * 已迁移至 services/task-trace/legacy-utils.ts。
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { prisma } from '../db'
import { BackendLogger as log } from './logger'

export type TaskTraceStatus = 'running' | 'completed' | 'error' | 'cancelled'

// ============================================================================
// 事件文件路径解析
// ============================================================================
//
// 事件写在持久化卷里才有意义：容器重建会丢掉可写层。默认目录按以下顺序解析，
// 与 compose / start-backend.sh 显式注入的 TASK_TRACE_LOG_DIR 保持一致。
//
// 已存库的 logFilePath 可能是旧目录的绝对路径。读取时只承认两类目录：
// 当前目录与已知 legacy 目录，并且文件名必须等于 trace-<id>.log。
// 不满足时返回明确原因，绝不退化成「读另一个 trace 的文件」。

const CONTAINER_APP_ROOT = '/app'
const CONTAINER_TASK_TRACE_DIR = '/app/logs/task-trace'

export interface TaskTraceLogDirInput {
  env?: Record<string, string | undefined>
  cwd?: string
  /** 是否运行在镜像内（/app 存在）。测试可显式传入。 */
  containerAppRoot?: boolean
}

export interface LegacyTraceLogDirInput {
  baseDir: string
  cwd?: string
  env?: Record<string, string | undefined>
}

export type TraceLogPathReason =
  | 'stored'
  | 'legacy-remap'
  | 'empty'
  | 'missing'
  | 'legacy-target-missing'
  | 'legacy-name-mismatch'
  | 'legacy-root-unknown'

export interface TraceLogPathResult {
  path: string | null
  via: 'stored' | 'legacy-remap' | null
  reason: TraceLogPathReason
  expectedFileName: string
}

const CONTAINER_LATEX_TRACE_DIR = '/app/logs/latex-trace'

/** LaTeX 事件目录与 task-trace 同源（LOG_DIR），但保持独立的子目录名。 */
export const resolveLatexTraceLogDir = (input: TaskTraceLogDirInput = {}): string => {
  const env = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const logDir = readEnvPath(env.LOG_DIR)
  if (logDir) return resolvePath(logDir, 'latex-trace')
  const containerAppRoot = input.containerAppRoot ?? existsSync(CONTAINER_APP_ROOT)
  if (containerAppRoot) return resolvePath(CONTAINER_LATEX_TRACE_DIR)
  return resolvePath(cwd, 'logs', 'latex-trace')
}

export const defaultLegacyLatexTraceLogDirs = (input: LegacyTraceLogDirInput): string[] => {
  const cwd = input.cwd ?? process.cwd()
  const candidates = [
    resolvePath('/app/packages/backend/logs/latex-trace'),
    resolvePath(cwd, 'logs', 'latex-trace'),
    resolvePath(cwd, 'packages', 'backend', 'logs', 'latex-trace'),
    resolvePath(CONTAINER_LATEX_TRACE_DIR),
  ]
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (isSamePath(candidate, input.baseDir)) continue
    const key = normalizeComparablePath(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

export interface ResolveTraceLogPathInput {
  storedPath?: string | null
  traceId: number
  baseDir?: string
  legacyDirs?: string[]
  exists?: (path: string) => boolean
}

const readEnvPath = (value: string | undefined): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeComparablePath = (value: string): string => {
  const normalized = resolvePath(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const isSamePath = (a: string, b: string): boolean => normalizeComparablePath(a) === normalizeComparablePath(b)

export const resolveTaskTraceLogDir = (input: TaskTraceLogDirInput = {}): string => {
  const env = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const explicitDir = readEnvPath(env.TASK_TRACE_LOG_DIR)
  if (explicitDir) return resolvePath(explicitDir)
  const logDir = readEnvPath(env.LOG_DIR)
  if (logDir) return resolvePath(logDir, 'task-trace')
  const containerAppRoot = input.containerAppRoot ?? existsSync(CONTAINER_APP_ROOT)
  if (containerAppRoot) return resolvePath(CONTAINER_TASK_TRACE_DIR)
  return resolvePath(cwd, 'logs', 'task-trace')
}

export const buildTraceLogFilePath = (dir: string, traceId: number): string =>
  resolvePath(dir, `trace-${traceId}.log`)

export const defaultLegacyTraceLogDirs = (input: LegacyTraceLogDirInput): string[] => {
  const env = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const candidates = [
    resolvePath('/app/packages/backend/logs/task-trace'),
    // 旧部署里 backend 的工作目录就是 /app/packages/backend，日志曾落在它下面。
    resolvePath(cwd, 'logs', 'task-trace'),
    // 从仓库根启动的宿主机开发：<repo>/packages/backend/logs/task-trace
    resolvePath(cwd, 'packages', 'backend', 'logs', 'task-trace'),
    resolvePath(CONTAINER_TASK_TRACE_DIR),
  ]
  const envDirs = (readEnvPath(env.TASK_TRACE_LEGACY_LOG_DIRS) ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolvePath(item))
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of [...candidates, ...envDirs]) {
    if (isSamePath(candidate, input.baseDir)) continue
    const key = normalizeComparablePath(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

interface ResolveLogPathInput {
  storedPath?: string | null
  baseDir: string
  expectedFileName: string
  legacyDirs: string[]
  exists: (path: string) => boolean
  /** trace 文件必须与记录 id 同名；latex 文件名字自带时间戳，用原文件名做身份。 */
  enforceExpectedName: boolean
}

const resolveLogPath = (input: ResolveLogPathInput): TraceLogPathResult => {
  const { baseDir, expectedFileName, exists } = input
  const stored = typeof input.storedPath === 'string' ? input.storedPath.trim() : ''
  if (!stored) {
    return { path: null, via: null, reason: 'empty', expectedFileName }
  }
  const normalizedStored = resolvePath(stored)
  const storedDir = dirname(normalizedStored)
  const inBaseDir = isSamePath(storedDir, baseDir)
  const inLegacyDir = input.legacyDirs.some((dir) => isSamePath(resolvePath(dir), storedDir))
  if (!inBaseDir && !inLegacyDir) {
    return { path: null, via: null, reason: 'legacy-root-unknown', expectedFileName }
  }
  if (exists(normalizedStored)) {
    return { path: normalizedStored, via: 'stored', reason: 'stored', expectedFileName }
  }
  if (inBaseDir) {
    return { path: null, via: null, reason: 'missing', expectedFileName }
  }
  if (input.enforceExpectedName && basename(normalizedStored) !== expectedFileName) {
    return { path: null, via: null, reason: 'legacy-name-mismatch', expectedFileName }
  }
  const remapped = resolvePath(baseDir, expectedFileName)
  if (exists(remapped)) {
    return { path: remapped, via: 'legacy-remap', reason: 'legacy-remap', expectedFileName }
  }
  return { path: null, via: null, reason: 'legacy-target-missing', expectedFileName }
}

export const resolveTraceLogPath = (input: ResolveTraceLogPathInput): TraceLogPathResult => {
  const baseDir = resolvePath(input.baseDir ?? resolveTaskTraceLogDir())
  return resolveLogPath({
    storedPath: input.storedPath,
    baseDir,
    expectedFileName: `trace-${input.traceId}.log`,
    legacyDirs: input.legacyDirs ?? defaultLegacyTraceLogDirs({ baseDir }),
    exists: input.exists ?? existsSync,
    enforceExpectedName: true,
  })
}

export interface ResolveLatexTraceLogPathInput {
  storedPath?: string | null
  baseDir?: string
  legacyDirs?: string[]
  exists?: (path: string) => boolean
}

export const resolveLatexTraceLogPath = (input: ResolveLatexTraceLogPathInput): TraceLogPathResult => {
  const baseDir = resolvePath(input.baseDir ?? resolveLatexTraceLogDir())
  const stored = typeof input.storedPath === 'string' ? input.storedPath.trim() : ''
  return resolveLogPath({
    storedPath: input.storedPath,
    baseDir,
    expectedFileName: stored ? basename(resolvePath(stored)) : 'latex-trace.log',
    legacyDirs: input.legacyDirs ?? defaultLegacyLatexTraceLogDirs({ baseDir }),
    exists: input.exists ?? existsSync,
    enforceExpectedName: false,
  })
}

// ============================================================================
// 负载裁剪（带省略报告）
// ============================================================================

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_ITEMS = 10
const MAX_OBJECT_ENTRIES = 20
const MAX_DEPTH = 3

export const truncateString = (value: string, limit = MAX_STRING_LENGTH) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`

export interface PayloadLimits {
  maxStringLength: number
  maxArrayItems: number
  maxObjectEntries: number
  maxDepth: number
}

/** 单个事件负载的上限：SSE 分片与工具摘要都用它，保持既有紧凑形状。 */
export const EVENT_PAYLOAD_LIMITS: PayloadLimits = {
  maxStringLength: MAX_STRING_LENGTH,
  maxArrayItems: MAX_ARRAY_ITEMS,
  maxObjectEntries: MAX_OBJECT_ENTRIES,
  maxDepth: MAX_DEPTH,
}

/**
 * 结束 metadata 的上限。比事件更宽：工具日志条目本身很小，
 * 10 项的上限会把 #105 那种 82 条工具日志压成 10 条且不留痕迹。
 */
export const METADATA_PAYLOAD_LIMITS: PayloadLimits = {
  maxStringLength: 800,
  maxArrayItems: 100,
  maxObjectEntries: 40,
  maxDepth: 4,
}

export interface PayloadOmission {
  path: string
  kept: number
  total: number
}

export interface SanitizedPayload {
  value: any
  omissions: PayloadOmission[]
}

const sanitizeWithLimits = (
  payload: unknown,
  limits: PayloadLimits,
  depth: number,
  path: string,
  omissions: PayloadOmission[],
): any => {
  if (payload == null) return payload
  if (typeof payload === 'string') {
    return truncateString(payload, limits.maxStringLength)
  }
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return payload
  }
  if (typeof payload === 'bigint') {
    return payload.toString()
  }
  if (payload instanceof Date) {
    return payload.toISOString()
  }
  if (typeof payload === 'function') {
    return undefined
  }
  if (Array.isArray(payload)) {
    if (depth >= limits.maxDepth) {
      if (payload.length > 0) omissions.push({ path, kept: 0, total: payload.length })
      return `[array(${payload.length})]`
    }
    const kept = payload.slice(0, limits.maxArrayItems)
    if (payload.length > kept.length) {
      omissions.push({ path, kept: kept.length, total: payload.length })
    }
    return kept.map((item, index) => sanitizeWithLimits(item, limits, depth + 1, `${path}[${index}]`, omissions))
  }
  if (typeof payload === 'object') {
    if (depth >= limits.maxDepth) {
      const total = Object.keys(payload as Record<string, unknown>).length
      if (total > 0) omissions.push({ path, kept: 0, total })
      return '[object]'
    }
    const entries = Object.entries(payload as Record<string, unknown>)
    const sliced = entries.slice(0, limits.maxObjectEntries)
    if (entries.length > sliced.length) {
      omissions.push({ path, kept: sliced.length, total: entries.length })
    }
    return sliced.reduce<Record<string, unknown>>((acc, [key, value]) => {
      const sanitized = sanitizeWithLimits(value, limits, depth + 1, path ? `${path}.${key}` : key, omissions)
      if (sanitized !== undefined) {
        acc[key] = sanitized
      }
      return acc
    }, {})
  }
  return null
}

/** 兼容入口：既有的单事件裁剪语义保持不变。 */
export const sanitizePayload = (payload: unknown, depth = 0): any => {
  const result = sanitizeWithLimits(payload, EVENT_PAYLOAD_LIMITS, depth, '', [])
  return result
}

/**
 * 调用方自己可能先切过数组（例如 toolLogs 只取前 50 条）。
 * 约定：与数组同级的 `<key>Total` 数字表示裁剪前的真实条数，
 * recorder 用它补齐 metadataOmissions，避免「只剩 50 条却看不出丢了东西」。
 */
const applyDeclaredTotals = (value: any, omissions: PayloadOmission[]): PayloadOmission[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return omissions
  const merged = new Map<string, PayloadOmission>()
  for (const omission of omissions) merged.set(omission.path, { ...omission })
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue
    const declared = (value as Record<string, unknown>)[`${key}Total`]
    if (typeof declared !== 'number' || !Number.isFinite(declared)) continue
    const total = Math.floor(declared)
    if (total <= entry.length) continue
    const existing = merged.get(key)
    merged.set(key, {
      path: key,
      kept: existing ? Math.min(existing.kept, entry.length) : entry.length,
      total: existing ? Math.max(existing.total, total) : total,
    })
  }
  return [...merged.values()]
}

/** 需要知道「裁掉了什么」时用它，例如结束 metadata。 */
export const sanitizePayloadWithOmissions = (
  payload: unknown,
  limits: PayloadLimits = METADATA_PAYLOAD_LIMITS,
): SanitizedPayload => {
  const omissions: PayloadOmission[] = []
  const value = sanitizeWithLimits(payload, limits, 0, '', omissions)
  return { value, omissions: applyDeclaredTotals(value, omissions) }
}

// ============================================================================
// 事件分层
// ============================================================================
//
// 噪声（SSE 分片、进度持久化）可以大量出现，也必须被限流；
// 关键事件（错误、取消、结束）不能被噪声挤掉，因此单独计数。
// 分层预算让「2000 条噪声之后工具错误与结束事件仍可查询」成为结构保证，
// 而不是调大总数上限的运气。

export type TaskTraceEventTier = 'noise' | 'normal' | 'critical'

export interface TraceTierCounts {
  noise: number
  normal: number
  critical: number
}

const NOISE_EVENT_TYPES = new Set(['db:persist_progress'])

const CRITICAL_EVENT_TYPES = new Set([
  'stream:error',
  'stream:cancelled',
  'stream:downstream_closed',
  'stream.first_chunk_timeout',
  'stream.keepalive_timeout',
  'agent:stopped_without_answer',
  'agent:first_visible_content',
  'agent:provider_usage',
  'agent:answer_outcome',
  'agent:retrieval_chain_ended',
  'agent:concurrency_denied',
  'agent:tool_context_guard',
  'agent:tool_context_guard_retry',
  'agent:tool_schema_fallback',
  'agent:tool_call_repair_retry',
  'reasoning:unavailable',
  'reasoning:protocol_fallback',
  'deep_research:plan_terminated',
  'db:persist_final',
  'db:persist_progress_error',
  'http:provider_error_body',
  'trace_overflow',
  'trace_finalized',
])

const FAILURE_STATUS_VALUES = new Set(['error', 'rejected', 'aborted', 'failed', 'timeout'])

const hasPayloadFailure = (payload: Record<string, unknown> | null | undefined): boolean => {
  if (!payload || typeof payload !== 'object') return false
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) return true
  if (typeof payload.errorCode === 'string' && payload.errorCode.trim().length > 0) return true
  if (payload.type === 'error') return true
  for (const key of ['status', 'phase', 'stage'] as const) {
    const value = payload[key]
    if (typeof value === 'string' && FAILURE_STATUS_VALUES.has(value.toLowerCase())) return true
  }
  return false
}

/**
 * 结束 metadata 的保留键。格式属于对外契约，见
 * `src/services/task-trace/README.md`：
 *
 * ```json
 * {
 *   "eventCount": 2212,
 *   "omitted": { "noise": 150, "normal": 0, "critical": 2 },
 *   "overflow": { "noise": true, "normal": false, "critical": true },
 *   "metadataOmissions": [{ "path": "toolLogs", "kept": 100, "total": 500 }]
 * }
 * ```
 *
 * 只有记录器写这个键；调用方的 metadata 键原样保留。
 */
export const TRACE_METADATA_RETENTION_KEY = '__trace'

export interface TraceMetadataRetention {
  /** 实际写入文件的事件条数，与数据库 eventCount 同义。 */
  eventCount: number
  /** 各分层因预算被丢弃的条数；非零即代表该记录不完整。 */
  omitted: TraceTierCounts
  /** 各分层是否已写过 trace_overflow 标记。 */
  overflow: Record<TaskTraceEventTier, boolean>
  /** 结束 metadata 自身被截断的位置。 */
  metadataOmissions: PayloadOmission[]
}

export const classifyTraceEventTier = (
  eventType: string,
  payload?: Record<string, unknown> | null,
): TaskTraceEventTier => {
  if (eventType.startsWith('sse:')) return 'noise'
  if (NOISE_EVENT_TYPES.has(eventType)) return 'noise'
  if (CRITICAL_EVENT_TYPES.has(eventType)) return 'critical'
  if (eventType === 'tool:event') {
    const retrieval = asTraceRecord(payload?.retrievalOutcome)
    const status = retrieval?.status
    if (status === 'failed' || status === 'timeout' || status === 'cancelled' || status === 'partial') {
      return 'critical'
    }
  }
  if (hasPayloadFailure(payload)) return 'critical'
  return 'normal'
}

// ============================================================================
// TaskTraceRecorder（使用可注入的 prisma）
// ============================================================================

export interface TaskTraceRecorderOptions {
  enabled: boolean
  sessionId?: number | null
  messageId?: number | null
  clientMessageId?: string | null
  actorIdentifier: string
  traceLevel?: string
  metadata?: Record<string, unknown>
  /** 兼容旧参数：噪声事件预算。 */
  maxEvents?: number
  /** 噪声事件预算（SSE 分片、进度持久化）。默认取 maxEvents 或 2000。 */
  maxNoiseEvents?: number
  /** 普通事件预算。默认与噪声预算相同。 */
  maxNormalEvents?: number
  /** 关键事件预算（错误、取消、结束）。默认 min(10000, max(1000, 噪声预算))。 */
  maxCriticalEvents?: number
  batchSize?: number
}

interface PendingEvent {
  seq: number
  eventType: string
  payload: any
  timestamp: Date
}

interface TaskTraceRecorderDeps {
  prisma: typeof prisma
}

const DEFAULT_MAX_EVENTS = 2000
const MIN_BUDGET = 1

const readBudget = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(MIN_BUDGET, parsed)
}

const readEnvBudget = (value: string | undefined): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export class TaskTraceRecorder {
  private enabled: boolean
  private traceId: number | null = null
  private sessionId?: number | null
  private messageId?: number | null
  private clientMessageId?: string | null
  private actorIdentifier: string
  private traceLevel: string
  private metadata: Record<string, unknown>
  private metadataOmissions: PayloadOmission[] = []
  private startedAt: Date
  private seq = 0
  private writtenEvents = 0
  private pending: PendingEvent[] = []
  private flushPromise: Promise<void> | null = null
  private batchSize: number
  private budgets: TraceTierCounts
  private accepted: TraceTierCounts = { noise: 0, normal: 0, critical: 0 }
  private omitted: TraceTierCounts = { noise: 0, normal: 0, critical: 0 }
  private overflowed: TraceTierCounts = { noise: 0, normal: 0, critical: 0 }
  private finalized = false
  private logFilePath: string | null = null
  private logDirEnsured = false
  private deps: TaskTraceRecorderDeps

  private constructor(options: TaskTraceRecorderOptions, deps: TaskTraceRecorderDeps) {
    this.enabled = options.enabled
    this.sessionId = options.sessionId ?? null
    this.messageId = options.messageId ?? null
    this.clientMessageId = options.clientMessageId ?? null
    this.actorIdentifier = options.actorIdentifier
    this.traceLevel = options.traceLevel || 'standard'
    const sanitizedMetadata = options.metadata
      ? sanitizePayloadWithOmissions(options.metadata)
      : { value: {}, omissions: [] as PayloadOmission[] }
    this.metadata = sanitizedMetadata.value ?? {}
    this.metadataOmissions = [...sanitizedMetadata.omissions]
    this.startedAt = new Date()
    this.batchSize = Math.max(1, options.batchSize ?? 20)

    const noiseBudget = readBudget(options.maxNoiseEvents ?? options.maxEvents, DEFAULT_MAX_EVENTS)
    const normalBudget = readBudget(
      options.maxNormalEvents ?? readEnvBudget(process.env.TASK_TRACE_MAX_NORMAL_EVENTS),
      noiseBudget,
    )
    const criticalDefault = Math.min(10000, Math.max(1000, noiseBudget))
    const criticalBudget = readBudget(
      options.maxCriticalEvents ?? readEnvBudget(process.env.TASK_TRACE_MAX_CRITICAL_EVENTS),
      criticalDefault,
    )
    this.budgets = { noise: noiseBudget, normal: normalBudget, critical: criticalBudget }
    this.deps = deps
  }

  static async create(options: TaskTraceRecorderOptions, deps?: TaskTraceRecorderDeps): Promise<TaskTraceRecorder> {
    const effectiveDeps = deps ?? { prisma }
    const recorder = new TaskTraceRecorder(options, effectiveDeps)
    if (!recorder.enabled) {
      return recorder
    }
    try {
      const trace = await effectiveDeps.prisma.taskTrace.create({
        data: {
          sessionId: options.sessionId ?? undefined,
          messageId: options.messageId ?? undefined,
          clientMessageId: options.clientMessageId ?? undefined,
          actor: options.actorIdentifier,
          traceLevel: recorder.traceLevel,
          status: 'running',
          metadata: JSON.stringify(recorder.metadata ?? {}),
        },
      })
      recorder.traceId = trace.id
      await recorder.prepareLogFile(trace.id)
    } catch (error) {
      recorder.enabled = false
      log.error('[task-trace] create failed', error)
    }
    return recorder
  }

  private async prepareLogFile(traceId: number) {
    const baseDir = resolveTaskTraceLogDir()
    await this.ensureDir(baseDir)
    const filePath = buildTraceLogFilePath(baseDir, traceId)
    this.logFilePath = filePath
    try {
      await this.deps.prisma.taskTrace.update({
        where: { id: traceId },
        data: {
          logFilePath: filePath,
        },
      })
    } catch (error) {
      log.warn('[task-trace] failed to persist logFilePath', error)
    }
  }

  private async ensureDir(dir: string) {
    if (this.logDirEnsured) return
    try {
      await mkdir(dir, { recursive: true })
      this.logDirEnsured = true
    } catch (error) {
      log.error('[task-trace] ensure log dir failed', error)
    }
  }

  isEnabled() {
    return this.enabled && this.traceId != null
  }

  getTraceId() {
    return this.traceId
  }

  getLogFilePath() {
    return this.logFilePath
  }

  setMessageContext(messageId?: number | null, clientMessageId?: string | null) {
    this.messageId = messageId ?? this.messageId ?? null
    this.clientMessageId = clientMessageId ?? this.clientMessageId ?? null
  }

  log(eventType: string, payload?: Record<string, unknown>) {
    if (!this.isEnabled() || this.finalized) return
    const eventPayload = sanitizePayload(payload ?? {})
    const tier = classifyTraceEventTier(eventType, eventPayload)
    if (this.accepted[tier] >= this.budgets[tier]) {
      this.omitted[tier] += 1
      if (this.overflowed[tier] === 0) {
        this.overflowed[tier] = 1
        // 截断标记本身必须留下，否则读文件的人无法知道丢过东西。
        this.pushEvent('trace_overflow', { tier, limit: this.budgets[tier] })
        this.scheduleFlush()
      }
      return
    }
    this.accepted[tier] += 1
    this.pushEvent(eventType, eventPayload)
    if (this.pending.length >= this.batchSize) {
      this.scheduleFlush()
    }
  }

  private pushEvent(eventType: string, payload?: Record<string, unknown>) {
    const eventPayload = sanitizePayload(payload ?? {})
    this.seq += 1
    this.pending.push({
      seq: this.seq,
      eventType,
      payload: eventPayload,
      timestamp: new Date(),
    })
    return this.seq
  }

  private scheduleFlush(force = false) {
    if (!this.isEnabled()) return
    if (this.flushPromise) {
      if (force) {
        this.flushPromise = this.flushPromise.then(() => this.flushInternal()).finally(() => {
          this.flushPromise = null
        })
      }
      return
    }
    this.flushPromise = this.flushInternal().finally(() => {
      this.flushPromise = null
    })
  }

  private async flushInternal() {
    if (!this.isEnabled()) return
    if (!this.logFilePath || !this.traceId) {
      // 不能先 splice：路径缺失时保留待写事件，等路径可用再写，避免静默丢事件。
      log.warn('[task-trace] log file path or trace id missing, skip flush')
      return
    }
    const chunk = this.pending.splice(0, this.pending.length)
    if (chunk.length === 0) return
    try {
      const lines = chunk
        .map((evt) =>
          JSON.stringify({
            seq: evt.seq,
            eventType: evt.eventType,
            payload: evt.payload,
            timestamp: evt.timestamp.toISOString(),
          }),
        )
        .join('\n')
      await appendFile(this.logFilePath, `${lines}\n`, { encoding: 'utf8' })
      this.writtenEvents += chunk.length
    } catch (error) {
      log.error('[task-trace] flush failed', error)
      this.enabled = false
    }
  }

  async flush(force = false) {
    if (!this.isEnabled()) return
    if (force && this.pending.length > 0) {
      this.scheduleFlush(true)
    }
    if (this.flushPromise) {
      await this.flushPromise
    }
  }

  async finalize(status: TaskTraceStatus, extra?: { metadata?: Record<string, unknown>; error?: string | null }) {
    if (!this.isEnabled() || this.finalized) return
    this.finalized = true
    const endedAt = new Date()
    const durationMs = endedAt.getTime() - this.startedAt.getTime()

    // 结束标记走独立通道：不受任何预算约束，保证文件末尾一定有真实终点。
    this.pushEvent('trace_finalized', {
      status,
      durationMs,
      eventCount: this.seq + 1,
      omitted: { ...this.omitted },
      overflow: Object.fromEntries(
        Object.entries(this.overflowed).map(([tier, flag]) => [tier, flag === 1]),
      ) as Record<TaskTraceEventTier, boolean>,
    })
    await this.flush(true)
    if (!this.traceId) return

    const mergedMetadata: Record<string, unknown> = { ...(this.metadata || {}) }
    if (extra?.metadata) {
      const sanitized = sanitizePayloadWithOmissions(extra.metadata)
      Object.assign(mergedMetadata, sanitized.value ?? {})
      this.metadataOmissions = [...this.metadataOmissions, ...sanitized.omissions]
    }
    if (extra?.error) {
      mergedMetadata.error = truncateString(extra.error, 800)
    }
    const retention: TraceMetadataRetention = {
      eventCount: this.writtenEvents,
      omitted: { ...this.omitted },
      overflow: Object.fromEntries(
        Object.entries(this.overflowed).map(([tier, flag]) => [tier, flag === 1]),
      ) as Record<TaskTraceEventTier, boolean>,
      metadataOmissions: this.metadataOmissions,
    }
    mergedMetadata[TRACE_METADATA_RETENTION_KEY] = retention

    try {
      await this.deps.prisma.taskTrace.update({
        where: { id: this.traceId },
        data: {
          status,
          endedAt,
          durationMs,
          metadata: JSON.stringify(mergedMetadata),
          eventCount: this.writtenEvents,
        },
      })
    } catch (error) {
      log.error('[task-trace] finalize failed', error)
    }
  }
}

// ============================================================================
// SSE 汇总工具 (纯函数)
// ============================================================================

const summarizeAttempts = (attempts: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(attempts) || attempts.length === 0) return undefined
  const kept = attempts.slice(0, 8).map((attempt) => {
    if (!attempt || typeof attempt !== 'object') return attempt
    const source = attempt as Record<string, unknown>
    return {
      engine: source.engine,
      status: source.status,
      durationMs: source.durationMs,
      errorCode: source.errorCode,
      httpStatus: source.httpStatus,
      error: typeof source.error === 'string' ? truncateString(source.error, 200) : undefined,
    }
  })
  return { count: attempts.length, kept }
}

function asTraceRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

const pickTraceScalars = (record: Record<string, unknown> | undefined, keys: readonly string[]) => {
  const summary: Record<string, string | number | boolean | null> = {}
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string') summary[key] = truncateString(value, 80)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) summary[key] = value
  }
  return summary
}

const summarizeRetrievalOutcome = (summary: Record<string, unknown>, value: unknown) => {
  const outcome = asTraceRecord(value)
  if (typeof outcome?.status !== 'string' || typeof outcome.reason !== 'string') return
  const search = asTraceRecord(outcome.search)
  const read = asTraceRecord(outcome.autoRead)
  const cancellation = asTraceRecord(outcome.cancellation)
  summary.retrievalOutcome = {
    ...pickTraceScalars(outcome, ['status', 'reason', 'retryable', 'retryAfterMs', 'degraded']),
    ...pickTraceScalars(search, ['attempted', 'succeeded', 'failed', 'empty', 'timedOut', 'skippedBackoff', 'exhaustion']),
    ...(typeof read?.state === 'string' ? { autoReadState: truncateString(read.state, 80) } : {}),
    ...(cancellation?.source === 'request' ? { cancellationSource: 'request' } : {}),
  }
  if (Array.isArray(outcome.engines)) {
    summary.searchEngines = outcome.engines.slice(0, 10).flatMap((item: unknown) => {
      const engine = asTraceRecord(item)
      if (typeof engine?.engine !== 'string' || typeof engine.state !== 'string') return []
      return [pickTraceScalars(engine, ['engine', 'state', 'failureKind', 'errorCode', 'httpStatus', 'retryAfterMs'])]
    })
    if (outcome.engines.length > 10) summary.searchEngineTaskCount = outcome.engines.length
  }
}

/**
 * 工具调用摘要：只挑白名单字段。
 * 不透传 details / argumentsText / headers，避免把凭据或整段参数写进追踪。
 */
const summarizeToolCallPayload = (payload: any, summary: Record<string, unknown>) => {
  const details = payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
    ? (payload.details as Record<string, unknown>)
    : null
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      const value = payload[key]
      if (value !== undefined && value !== null && value !== '') return value
      const detailValue = details?.[key]
      if (detailValue !== undefined && detailValue !== null && detailValue !== '') return detailValue
    }
    return undefined
  }

  const tool = pick('tool', 'identifier', 'apiName')
  if (typeof tool === 'string') summary.tool = truncateString(tool, 80)
  for (const key of ['stage', 'phase', 'status', 'source'] as const) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) summary[key] = value
  }
  const callId = pick('id', 'callId')
  if (typeof callId === 'string' && callId.trim()) summary.callId = truncateString(callId, 80)

  const url = pick('url', 'finalUrl')
  if (typeof url === 'string' && url.trim()) summary.url = truncateString(url, 300)
  if (payload.query) summary.query = truncateString(String(payload.query), 200)

  if (typeof payload.error === 'string' && payload.error.trim()) {
    summary.error = truncateString(payload.error, 300)
  } else if (typeof details?.error === 'string' && details.error.trim()) {
    summary.error = truncateString(details.error, 300)
  }
  const errorCode = pick('errorCode')
  if (typeof errorCode === 'string' && errorCode.trim()) summary.errorCode = errorCode
  const httpStatus = pick('httpStatus')
  if (typeof httpStatus === 'number') summary.httpStatus = httpStatus

  const excerpt = pick('summary')
  if (typeof excerpt === 'string' && excerpt.trim()) summary.summaryText = truncateString(excerpt, 200)
  const wordCount = pick('wordCount')
  if (typeof wordCount === 'number') summary.wordCount = wordCount
  const engine = pick('engine')
  if (typeof engine === 'string' && engine.trim()) summary.engine = engine
  const fallbackUsed = pick('fallbackUsed', 'contentFormat')
  if (typeof fallbackUsed === 'string' && fallbackUsed.trim()) summary.fallbackUsed = fallbackUsed

  if (Array.isArray(payload.hits)) summary.hits = payload.hits.length
  const attempts = summarizeAttempts(pick('attempts'))
  if (attempts) summary.attempts = attempts
  if (tool === 'web_search') summarizeRetrievalOutcome(summary, details?.retrievalOutcome)
  return summary
}

export const summarizeSsePayload = (payload: any): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object') {
    return { type: typeof payload }
  }
  const type = typeof payload.type === 'string' ? payload.type : 'unknown'
  const summary: Record<string, unknown> = { type }
  if (type === 'content' && typeof payload.content === 'string') {
    summary.length = payload.content.length
    summary.preview = truncateString(payload.content, 120)
  }
  if (type === 'reasoning') {
    if (payload.keepalive) {
      summary.keepalive = true
      if (typeof payload.idle_ms === 'number') summary.idleMs = payload.idle_ms
    } else if (payload.done) {
      summary.done = true
      if (typeof payload.duration === 'number') summary.duration = payload.duration
    } else if (typeof payload.content === 'string') {
      summary.preview = truncateString(payload.content, 120)
      summary.length = payload.content.length
    }
  }
  if (type === 'usage' && payload.usage) {
    summary.usage = sanitizePayload(payload.usage)
  }
  if (type === 'quota' && payload.quota) {
    summary.quota = sanitizePayload(payload.quota)
  }
  // tool_call 是实际发送的类型（normalizeToolCallEventPayload 的产物），
  // tool 是旧形态；两者都要保留错误与阶段，否则追踪里只剩 { type }。
  if (type === 'tool_call') {
    summarizeToolCallPayload(payload, summary)
  }
  if (type === 'tool') {
    summary.tool = payload.tool
    summary.stage = payload.stage
    if (payload.query) summary.query = truncateString(String(payload.query), 160)
    if (Array.isArray(payload.hits)) summary.hits = payload.hits.length
    if (payload.error) summary.error = truncateString(String(payload.error), 160)
  }
  if (type === 'error' && payload.error) {
    summary.error = truncateString(String(payload.error), 200)
  }
  if (typeof payload.messageId === 'number') {
    summary.messageId = payload.messageId
  }
  return summary
}

export const summarizeSseLine = (line: string): Record<string, unknown> | null => {
  if (!line) return null
  if (line.startsWith(':')) {
    return { type: 'keepalive' }
  }
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload) return null
  if (payload === '[DONE]') {
    return { type: 'done' }
  }
  try {
    const parsed = JSON.parse(payload)
    return summarizeSsePayload(parsed)
  } catch {
    return { type: 'raw', preview: truncateString(payload, 120) }
  }
}
