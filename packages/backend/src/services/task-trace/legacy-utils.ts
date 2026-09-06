/**
 * Task Trace 配置兼容代理层。
 *
 * 从 utils/task-trace.ts 迁移至 services 层，避免 utils 依赖 services。
 * TaskTraceRecorder 与纯函数仍保留在 utils/task-trace.ts。
 */

import type { Actor } from '../../types'
import {
  resolveConfigFromMap,
  type TaskTraceConfig,
  type TaskTraceConfigService,
} from './task-trace-config-service'

export type { TaskTraceConfig }

type TaskTraceConfigServiceLike = Pick<TaskTraceConfigService, 'getConfig' | 'invalidateCache'>

interface TaskTraceUtilsDeps {
  taskTraceConfigService: TaskTraceConfigServiceLike
}

let configuredTaskTraceConfigService: TaskTraceConfigServiceLike | null = null

export const configureTaskTraceUtils = (deps: TaskTraceUtilsDeps): void => {
  configuredTaskTraceConfigService = deps.taskTraceConfigService
}

const resolveTaskTraceConfig = async (map?: Record<string, string>): Promise<TaskTraceConfig> => {
  if (map) return resolveConfigFromMap(map)
  if (!configuredTaskTraceConfigService) return resolveConfigFromMap()
  try {
    return await configuredTaskTraceConfigService.getConfig()
  } catch {
    return resolveConfigFromMap()
  }
}

export const getTaskTraceConfig = (map?: Record<string, string>): Promise<TaskTraceConfig> =>
  resolveTaskTraceConfig(map)

export const invalidateTaskTraceConfig = (): void => {
  configuredTaskTraceConfigService?.invalidateCache()
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
  const config = await resolveTaskTraceConfig(params.sysMap)
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
