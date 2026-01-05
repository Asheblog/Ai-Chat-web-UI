/**
 * 后端日志工具
 *
 * 支持通过 LOG_LEVEL 环境变量控制日志级别：
 * - debug: 输出所有日志（开发环境默认）
 * - info: 输出 info/warn/error（生产环境默认）
 * - warn: 仅输出 warn/error
 * - error: 仅输出 error
 *
 * 使用方式：
 * ```ts
 * import { log } from '../utils/logger'
 * log.debug('调试信息')
 * log.info('一般信息')
 * log.warn('警告信息')
 * log.error('错误信息')
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function getConfiguredLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase()
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel
  }
  // 默认: 开发环境 debug，生产环境 info
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const configuredLevel = getConfiguredLevel()
const configuredLevelNum = LOG_LEVELS[configuredLevel]

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= configuredLevelNum
}

function formatMessage(level: LogLevel, tag: string, ...args: any[]): void {
  if (!shouldLog(level)) return
  
  const ts = new Date().toISOString()
  const prefix = tag ? `[${tag}]` : ''
  const levelStr = level.toUpperCase().padEnd(5)
  
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[${ts}][${levelStr}]${prefix}`, ...args)
}

/**
 * 创建带标签的 logger 实例
 * @param tag 日志标签，如 'RAG', 'VectorDB'
 */
export function createLogger(tag: string) {
  return {
    debug: (...args: any[]) => formatMessage('debug', tag, ...args),
    info: (...args: any[]) => formatMessage('info', tag, ...args),
    warn: (...args: any[]) => formatMessage('warn', tag, ...args),
    error: (...args: any[]) => formatMessage('error', tag, ...args),
  }
}

/**
 * 默认 logger（无标签）
 */
export const log = createLogger('')

/**
 * @deprecated 使用 `log` 或 `createLogger()` 代替
 */
export const BackendLogger = log
