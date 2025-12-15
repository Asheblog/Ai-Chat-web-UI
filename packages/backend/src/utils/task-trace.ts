/**
 * Task Trace Utils - 代理层
 *
 * 委托给 TaskTraceConfigService，无回退实现。
 * TaskTraceRecorder 使用依赖注入模式。
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { prisma } from '../db'
import { BackendLogger as log } from './logger'
import type { Actor } from '../types'
import {
  getTaskTraceConfigService,
  getAppContext,
} from '../container/service-accessor'
import { resolveConfigFromMap, type TaskTraceConfig } from '../services/task-trace/task-trace-config-service'

export type TaskTraceStatus = 'running' | 'completed' | 'error' | 'cancelled'

export type { TaskTraceConfig }

// ============================================================================
// 公共 API（代理到 TaskTraceConfigService）
// ============================================================================

export const getTaskTraceConfig = (map?: Record<string, string>): Promise<TaskTraceConfig> =>
  getTaskTraceConfigService().getConfig(map)

export const invalidateTaskTraceConfig = (): void =>
  getTaskTraceConfigService().invalidateCache()

// ============================================================================
// shouldEnableTaskTrace
// ============================================================================

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
    if (depth > 3) return `[array(${payload.length})]`
    return payload.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizePayload(item, depth + 1))
  }
  if (typeof payload === 'object') {
    if (depth > 3) return '[object]'
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

interface TaskTraceRecorderDeps {
  prisma: typeof prisma
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
  private deps: TaskTraceRecorderDeps

  private constructor(options: TaskTraceRecorderOptions, deps: TaskTraceRecorderDeps) {
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
    this.deps = deps
  }

  static async create(options: TaskTraceRecorderOptions, deps?: TaskTraceRecorderDeps): Promise<TaskTraceRecorder> {
    const effectiveDeps = deps ?? { prisma: getAppContext().prisma }
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
    const baseDir =
      process.env.TASK_TRACE_LOG_DIR ||
      (process.env.LOG_DIR ? resolvePath(process.env.LOG_DIR, 'task-trace') : resolvePath(process.cwd(), 'logs', 'task-trace'))
    await this.ensureDir(baseDir)
    const filePath = resolvePath(baseDir, `trace-${traceId}.log`)
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
      await this.deps.prisma.taskTrace.update({
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

// ============================================================================
// SSE 汇总工具 (纯函数)
// ============================================================================

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
