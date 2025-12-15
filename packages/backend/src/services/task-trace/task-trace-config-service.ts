/**
 * TaskTraceConfigService - Task Trace 配置服务
 *
 * 从 utils/task-trace.ts 迁移配置获取逻辑，使用依赖注入。
 */

import type { PrismaClient } from '@prisma/client'

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

export interface TaskTraceConfigServiceDeps {
  prisma: PrismaClient
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

export const resolveConfigFromMap = (map?: Record<string, string> | null): TaskTraceConfig => {
  const enabled = parseBoolean(map?.task_trace_enabled, false)
  const defaultOn = parseBoolean(map?.task_trace_default_on, false)
  const adminOnly = parseBoolean(map?.task_trace_admin_only, true)
  const rawEnv = (map?.task_trace_env || '').toLowerCase()
  const env: TaskTraceConfig['env'] = rawEnv === 'both' || rawEnv === 'prod' ? (rawEnv as TaskTraceConfig['env']) : 'dev'
  const retentionDays = clampNumber(map?.task_trace_retention_days ?? process.env.TASK_TRACE_RETENTION_DAYS, 7, 1, 365)
  const maxEvents = clampNumber(map?.task_trace_max_events ?? process.env.TASK_TRACE_MAX_EVENTS, 2000, 200, 200000)
  const idleTimeoutMs = clampNumber(map?.task_trace_idle_timeout_ms ?? process.env.TASK_TRACE_IDLE_TIMEOUT_MS, 30000, 1000, 600000)
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

export class TaskTraceConfigService {
  private prisma: PrismaClient
  private cachedConfig: { value: TaskTraceConfig; expiresAt: number } | null = null

  constructor(deps: TaskTraceConfigServiceDeps) {
    this.prisma = deps.prisma
  }

  async getConfig(map?: Record<string, string>): Promise<TaskTraceConfig> {
    if (map) return resolveConfigFromMap(map)
    const now = Date.now()
    if (this.cachedConfig && this.cachedConfig.expiresAt > now) {
      return this.cachedConfig.value
    }
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: CONFIG_KEYS as unknown as string[] } },
      select: { key: true, value: true },
    })
    const fetchedMap = rows.reduce((acc, row) => {
      acc[row.key] = row.value
      return acc
    }, {} as Record<string, string>)
    const value = resolveConfigFromMap(fetchedMap)
    this.cachedConfig = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  }

  invalidateCache(): void {
    this.cachedConfig = null
  }
}
