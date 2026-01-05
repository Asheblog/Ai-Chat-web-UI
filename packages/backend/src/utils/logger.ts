/**
 * 后端日志工具
 *
 * 支持功能：
 * - 动态日志级别配置（可通过系统设置或环境变量）
 * - 日志文件写入（JSON Lines 格式）
 * - 按日期自动轮转日志文件
 *
 * 日志级别：
 * - debug: 输出所有日志
 * - info: 输出 info/warn/error
 * - warn: 仅输出 warn/error
 * - error: 仅输出 error
 *
 * 使用方式：
 * ```ts
 * import { log, createLogger } from '../utils/logger'
 * const myLog = createLogger('MyModule')
 * myLog.info('操作完成', { count: 10 })
 * ```
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// ============================================================================
// 日志配置（可动态更新）
// ============================================================================

interface LogConfig {
  level: LogLevel
  toFile: boolean
  logDir: string
  retentionDays: number
}

let currentConfig: LogConfig = {
  level: getInitialLevel(),
  toFile: process.env.SYSTEM_LOG_TO_FILE !== 'false',
  logDir: process.env.SYSTEM_LOG_DIR || process.env.LOG_DIR || './logs',
  retentionDays: parseInt(process.env.SYSTEM_LOG_RETENTION_DAYS || '7', 10) || 7,
}

function getInitialLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase()
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

/**
 * 获取当前日志配置
 */
export function getLogConfig(): Readonly<LogConfig> {
  return { ...currentConfig }
}

/**
 * 更新日志配置（由系统设置服务调用）
 */
export function setLogConfig(config: Partial<LogConfig>): void {
  if (config.level && config.level in LOG_LEVELS) {
    currentConfig.level = config.level
  }
  if (config.toFile !== undefined) {
    currentConfig.toFile = config.toFile
  }
  if (config.logDir) {
    currentConfig.logDir = config.logDir
  }
  if (config.retentionDays !== undefined && config.retentionDays > 0) {
    currentConfig.retentionDays = config.retentionDays
  }
}

// ============================================================================
// 日志文件写入
// ============================================================================

let logDirEnsured = false
let currentLogDate = ''
let currentLogFilePath = ''

function ensureLogDir(): void {
  if (logDirEnsured) return
  try {
    const dir = resolve(currentConfig.logDir)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    logDirEnsured = true
  } catch {
    // 忽略目录创建失败
  }
}

function getLogFilePath(): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  if (today !== currentLogDate) {
    currentLogDate = today
    currentLogFilePath = join(resolve(currentConfig.logDir), `system-${today}.log`)
  }
  return currentLogFilePath
}

export interface LogEntry {
  ts: string
  level: LogLevel
  tag: string
  msg: string
  ctx?: Record<string, unknown>
}

function writeToFile(entry: LogEntry): void {
  if (!currentConfig.toFile) return
  
  try {
    ensureLogDir()
    const filePath = getLogFilePath()
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(filePath, line, 'utf8')
  } catch {
    // 忽略写入失败，不影响主流程
  }
}

/**
 * 清理过期日志文件
 */
export function cleanupOldLogFiles(): { deleted: number; errors: string[] } {
  const result = { deleted: 0, errors: [] as string[] }
  
  try {
    ensureLogDir()
    const dir = resolve(currentConfig.logDir)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - currentConfig.retentionDays)
    
    const files = readdirSync(dir)
    for (const file of files) {
      if (!file.startsWith('system-') || !file.endsWith('.log')) continue
      
      const filePath = join(dir, file)
      try {
        const stats = statSync(filePath)
        if (stats.mtime < cutoffDate) {
          unlinkSync(filePath)
          result.deleted++
        }
      } catch (e) {
        result.errors.push(`Failed to process ${file}: ${e instanceof Error ? e.message : e}`)
      }
    }
  } catch (e) {
    result.errors.push(`Cleanup failed: ${e instanceof Error ? e.message : e}`)
  }
  
  return result
}

// ============================================================================
// 核心日志函数
// ============================================================================

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentConfig.level]
}

function formatArgs(args: any[]): { message: string; context?: Record<string, unknown> } {
  if (args.length === 0) {
    return { message: '' }
  }
  
  // 如果最后一个参数是对象，作为 context
  const lastArg = args[args.length - 1]
  if (args.length > 1 && typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg) && !(lastArg instanceof Error)) {
    const messageArgs = args.slice(0, -1)
    return {
      message: messageArgs.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
      context: lastArg as Record<string, unknown>,
    }
  }
  
  // 否则全部拼接为消息
  return {
    message: args.map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}`
      if (typeof a === 'string') return a
      return JSON.stringify(a)
    }).join(' '),
  }
}

function logMessage(level: LogLevel, tag: string, ...args: any[]): void {
  if (!shouldLog(level)) return
  
  const ts = new Date().toISOString()
  const { message, context } = formatArgs(args)
  
  // 写入文件（JSON 格式）
  const entry: LogEntry = { ts, level, tag, msg: message }
  if (context) entry.ctx = context
  writeToFile(entry)
  
  // 输出到控制台（人类可读格式）
  const prefix = tag ? `[${tag}]` : ''
  const levelStr = level.toUpperCase().padEnd(5)
  const consoleMsg = `[${ts}][${levelStr}]${prefix} ${message}`
  
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (context) {
    fn(consoleMsg, context)
  } else {
    fn(consoleMsg)
  }
}

/**
 * Logger 实例接口
 */
export interface Logger {
  debug: (...args: any[]) => void
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

/**
 * 创建带标签的 logger 实例
 * @param tag 日志标签，如 'RAG', 'VectorDB'
 */
export function createLogger(tag: string): Logger {
  return {
    debug: (...args: any[]) => logMessage('debug', tag, ...args),
    info: (...args: any[]) => logMessage('info', tag, ...args),
    warn: (...args: any[]) => logMessage('warn', tag, ...args),
    error: (...args: any[]) => logMessage('error', tag, ...args),
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

// ============================================================================
// 配置刷新（由系统设置服务调用）
// ============================================================================

let configRefreshInterval: NodeJS.Timeout | null = null

/**
 * 启动配置自动刷新
 * @param refreshFn 获取配置的函数
 * @param intervalMs 刷新间隔（默认 30 秒）
 */
export function startLogConfigRefresh(
  refreshFn: () => Promise<Partial<LogConfig>>,
  intervalMs = 30000
): void {
  stopLogConfigRefresh()
  
  const doRefresh = async () => {
    try {
      const config = await refreshFn()
      setLogConfig(config)
    } catch {
      // 忽略刷新失败
    }
  }
  
  // 立即执行一次
  doRefresh()
  
  // 定时刷新
  configRefreshInterval = setInterval(doRefresh, intervalMs)
}

/**
 * 停止配置自动刷新
 */
export function stopLogConfigRefresh(): void {
  if (configRefreshInterval) {
    clearInterval(configRefreshInterval)
    configRefreshInterval = null
  }
}
