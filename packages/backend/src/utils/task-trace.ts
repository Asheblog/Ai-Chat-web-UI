import { appendFile, mkdir } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { prisma } from '../db'
import { BackendLogger as log } from './logger'
import type { Actor } from '../types'

export type TaskTraceStatus = 'running' | 'completed' | 'error' | 'cancelled'

export interface TaskTraceConfig {
  enabled: boolean
  defaultOn: boolean
  adminOnly: boolean
  env: 'dev' | 'prod' | 'both'
  retentionDays: number
  maxEvents: number
  idleTimeoutMs: number
}

interface TaskTraceConfigCache {
  value: TaskTraceConfig
  expiresAt: number
}

const CONFIG_KEYS = [
  'task_trace_enabled',
  'task_trace_default_on',
  'task_trace_admin_only',
  'task_trace_env',
  'task_trace_retention_days',
  'task_trace_max_events',
  'task_trace_idle_timeout_ms',
] as const

const CACHE_TTL_MS = 30_000
let cachedConfig: TaskTraceConfigCache | null = null

const parseBoolean = (input: unknown, fallback: boolean): boolean => {
  if (typeof input === 'boolean') return input
  if (input == null) return fallback
  const normalized = String(input).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

const clampNumber = (input: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(String(input ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min) return min
  if (parsed > max) return max
  return parsed
}

const resolveConfigFromMap = (map?: Record<string, string> | null): TaskTraceConfig => {
  const enabled = parseBoolean(map?.task_trace_enabled, false)
  const defaultOn = parseBoolean(map?.task_trace_default_on, false)
  const adminOnly = parseBoolean(map?.task_trace_admin_only, true)
  const rawEnv = (map?.task_trace_env || '').toLowerCase()
  const env: TaskTraceConfig['env'] = rawEnv === 'both' || rawEnv === 'prod' ? (rawEnv as TaskTraceConfig['env']) : 'dev'
  const retentionDays = clampNumber(map?.task_trace_retention_days ?? process.env.TASK_TRACE_RETENTION_DAYS, 7, 1, 365)
  const maxEvents = clampNumber(map?.task_trace_max_events ?? process.env.TASK_TRACE_MAX_EVENTS ?? 2000, 200, 200000)
  const idleTimeoutMs = clampNumber(map?.task_trace_idle_timeout_ms ?? process.env.TASK_TRACE_IDLE_TIMEOUT_MS ?? 30000, 1000, 600000)
  return {
    enabled,
    defaultOn,
    adminOnly,
    env,
    retentionDays,
    maxEvents,
    idleTimeoutMs,
  }
}

export const getTaskTraceConfig = async (map?: Record<string, string>): Promise<TaskTraceConfig> => {
  if (map) return resolveConfigFromMap(map)
  const now = Date.now()
  if (cachedConfig && cachedConfig.expiresAt > now) {
    return cachedConfig.value
  }
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: CONFIG_KEYS as unknown as string[] } },
    select: { key: true, value: true },
  })
  const fetchedMap = rows.reduce((acc, row) => {
    acc[row.key] = row.value
    return acc
  }, {} as Record<string, string>)
  const value = resolveConfigFromMap(fetchedMap)
  cachedConfig = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

export const invalidateTaskTraceConfig = () => {
  cachedConfig = null
}

export interface ShouldEnableTaskTraceResult {
  enabled: boolean
  traceLevel: 'standard' | 'explicit'
  reason?: string
  config: TaskTraceConfig
}

interface ShouldEnableParams {
  actor?: Actor | null
  requestFlag?: boolean | null
  sysMap?: Record<string, string>
  env?: string
}

export const shouldEnableTaskTrace = async (params: ShouldEnableParams): Promise<ShouldEnableTaskTraceResult> => {
  const config = params.sysMap ? resolveConfigFromMap(params.sysMap) : await getTaskTraceConfig()
  if (!config.enabled) {
    return { enabled: false, traceLevel: 'standard', reason: 'disabled', config }
  }
  const envName = (params.env ?? process.env.NODE_ENV ?? 'development').toLowerCase()
  const isProd = envName === 'production'
  const envAllowed =
    config.env === 'both' ||
    (config.env === 'prod' ? isProd : !isProd)
  if (!envAllowed) {
    return { enabled: false, traceLevel: 'standard', reason: 'env_blocked', config }
  }
  const actor = params.actor
  const actorAllowed = !config.adminOnly || (actor?.type === 'user' && actor.role === 'ADMIN')
  if (!actorAllowed) {
    return { enabled: false, traceLevel: 'standard', reason: 'actor_blocked', config }
  }
  const requestFlag = params.requestFlag
  const desired = typeof requestFlag === 'boolean' ? requestFlag : config.defaultOn
  if (!desired) {
    return { enabled: false, traceLevel: 'standard', reason: 'opt_out', config }
  }
  return {
    enabled: true,
    traceLevel: requestFlag === true ? 'explicit' : 'standard',
    config,
  }
}

export interface TaskTraceRecorderOptions {
  enabled: boolean
  sessionId?: number | null
  messageId?: number | null
  clientMessageId?: string | null
  actorIdentifier: string
  traceLevel?: string
  metadata?: Record<string, unknown>
  maxEvents?: number
  batchSize?: number
}

interface PendingEvent {
  seq: number
  eventType: string
  payload: any
  timestamp: Date
}

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_ITEMS = 10
const MAX_OBJECT_ENTRIES = 20

export const truncateString = (value: string, limit = MAX_STRING_LENGTH) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`

export const sanitizePayload = (payload: unknown, depth = 0): any => {
  if (payload == null) return payload
  if (typeof payload === 'string') {
    return truncateString(payload)
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
    if (depth > 2) return `[array(${payload.length})]`
    return payload.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizePayload(item, depth + 1))
  }
  if (typeof payload === 'object') {
    if (depth > 2) return '[object]'
    const entries = Object.entries(payload as Record<string, unknown>)
    const sliced = entries.slice(0, MAX_OBJECT_ENTRIES)
    return sliced.reduce<Record<string, unknown>>((acc, [key, value]) => {
      const sanitized = sanitizePayload(value, depth + 1)
      if (sanitized !== undefined) {
        acc[key] = sanitized
      }
      return acc
    }, {})
  }
  return null
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
  private startedAt: Date
  private seq = 0
  private pending: PendingEvent[] = []
  private flushPromise: Promise<void> | null = null
  private batchSize: number
  private maxEvents: number
  private overflowed = false
  private finalized = false
  private logFilePath: string | null = null
  private logDirEnsured = false

  private constructor(options: TaskTraceRecorderOptions) {
    this.enabled = options.enabled
    this.sessionId = options.sessionId ?? null
    this.messageId = options.messageId ?? null
    this.clientMessageId = options.clientMessageId ?? null
    this.actorIdentifier = options.actorIdentifier
    this.traceLevel = options.traceLevel || 'standard'
    this.metadata = options.metadata ? sanitizePayload(options.metadata) : {}
    this.startedAt = new Date()
    this.batchSize = Math.max(1, options.batchSize ?? 20)
    this.maxEvents = Math.max(100, options.maxEvents ?? 2000)
  }

  static async create(options: TaskTraceRecorderOptions): Promise<TaskTraceRecorder> {
    const recorder = new TaskTraceRecorder(options)
    if (!recorder.enabled) {
      return recorder
    }
    try {
      const trace = await prisma.taskTrace.create({
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
    const baseDir =
      process.env.TASK_TRACE_LOG_DIR ||
      (process.env.LOG_DIR ? resolvePath(process.env.LOG_DIR, 'task-trace') : resolvePath(process.cwd(), 'logs', 'task-trace'))
    await this.ensureDir(baseDir)
    const filePath = resolvePath(baseDir, `trace-${traceId}.log`)
    this.logFilePath = filePath
    try {
      await prisma.taskTrace.update({
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

  setMessageContext(messageId?: number | null, clientMessageId?: string | null) {
    this.messageId = messageId ?? this.messageId ?? null
    this.clientMessageId = clientMessageId ?? this.clientMessageId ?? null
  }

  log(eventType: string, payload?: Record<string, unknown>) {
    if (!this.isEnabled() || this.finalized) return
    if (this.seq >= this.maxEvents) {
      if (!this.overflowed) {
        this.overflowed = true
        this.pushEvent('trace_overflow', { maxEvents: this.maxEvents })
      }
      return
    }
    this.pushEvent(eventType, payload)
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
    const chunk = this.pending.splice(0, this.pending.length)
    if (chunk.length === 0) return
    if (!this.traceId) return
    if (!this.logFilePath) {
      log.warn('[task-trace] logFilePath missing, skip flush')
      return
    }
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
    await this.flush(true)
    if (!this.traceId) return
    const endedAt = new Date()
    const durationMs = endedAt.getTime() - this.startedAt.getTime()
    const mergedMetadata = extra?.metadata
      ? { ...(this.metadata || {}), ...sanitizePayload(extra.metadata) }
      : this.metadata
    try {
      await prisma.taskTrace.update({
        where: { id: this.traceId },
        data: {
          status,
          endedAt,
          durationMs,
          metadata: JSON.stringify(mergedMetadata ?? {}),
          eventCount: this.seq,
        },
      })
    } catch (error) {
      log.error('[task-trace] finalize failed', error)
    }
  }
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
