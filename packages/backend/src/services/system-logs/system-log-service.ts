/**
 * 系统日志查询服务
 * 用于读取和查询系统运行日志文件
 */

import { createReadStream, existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { createInterface } from 'readline'
import { join, resolve } from 'path'
import type { LogEntry, LogLevel } from '../../utils/logger'

export interface SystemLogQuery {
  page: number
  pageSize: number
  level?: LogLevel
  tag?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

export interface SystemLogItem extends LogEntry {
  id: number // 用于前端唯一标识
}

export interface SystemLogQueryResult {
  items: SystemLogItem[]
  total: number
  hasMore: boolean
}

export interface SystemLogStats {
  totalFiles: number
  totalSizeBytes: number
  oldestDate: string | null
  newestDate: string | null
  fileList: Array<{ name: string; sizeBytes: number; date: string }>
}

export class SystemLogService {
  private logDir: string

  constructor(logDir?: string) {
    this.logDir = resolve(logDir || process.env.SYSTEM_LOG_DIR || process.env.LOG_DIR || './logs')
  }

  /**
   * 获取日志目录
   */
  getLogDir(): string {
    return this.logDir
  }

  /**
   * 获取日志统计信息
   */
  async getStats(): Promise<SystemLogStats> {
    const stats: SystemLogStats = {
      totalFiles: 0,
      totalSizeBytes: 0,
      oldestDate: null,
      newestDate: null,
      fileList: [],
    }

    if (!existsSync(this.logDir)) {
      return stats
    }

    try {
      const files = readdirSync(this.logDir)
        .filter((f) => f.startsWith('system-') && f.endsWith('.log'))
        .sort()

      for (const file of files) {
        const filePath = join(this.logDir, file)
        try {
          const fileStat = statSync(filePath)
          const dateMatch = file.match(/system-(\d{4}-\d{2}-\d{2})\.log/)
          const date = dateMatch ? dateMatch[1] : ''

          stats.fileList.push({
            name: file,
            sizeBytes: fileStat.size,
            date,
          })
          stats.totalFiles++
          stats.totalSizeBytes += fileStat.size

          if (!stats.oldestDate || date < stats.oldestDate) {
            stats.oldestDate = date
          }
          if (!stats.newestDate || date > stats.newestDate) {
            stats.newestDate = date
          }
        } catch {
          // 忽略单个文件错误
        }
      }
    } catch {
      // 忽略目录读取错误
    }

    return stats
  }

  /**
   * 查询日志
   * 注意：为了支持分页，需要从最新日志开始倒序读取
   */
  async query(params: SystemLogQuery): Promise<SystemLogQueryResult> {
    const { page = 1, pageSize = 50, level, tag, search, dateFrom, dateTo } = params
    const skip = (page - 1) * pageSize

    const allEntries: LogEntry[] = []

    if (!existsSync(this.logDir)) {
      return { items: [], total: 0, hasMore: false }
    }

    // 获取日期范围内的日志文件（倒序，最新在前）
    const files = this.getLogFilesInRange(dateFrom, dateTo)

    // 从每个文件读取并过滤
    for (const file of files) {
      const entries = await this.readLogFile(file, { level, tag, search })
      allEntries.push(...entries)
    }

    // 按时间倒序排列（最新在前）
    allEntries.sort((a, b) => b.ts.localeCompare(a.ts))

    // 分页
    const total = allEntries.length
    const pageEntries = allEntries.slice(skip, skip + pageSize)

    // 添加唯一ID
    const items: SystemLogItem[] = pageEntries.map((entry, idx) => ({
      ...entry,
      id: skip + idx + 1,
    }))

    return {
      items,
      total,
      hasMore: skip + pageSize < total,
    }
  }

  /**
   * 获取日期范围内的日志文件列表（倒序）
   */
  private getLogFilesInRange(dateFrom?: string, dateTo?: string): string[] {
    if (!existsSync(this.logDir)) {
      return []
    }

    try {
      const files = readdirSync(this.logDir)
        .filter((f) => f.startsWith('system-') && f.endsWith('.log'))
        .map((f) => {
          const match = f.match(/system-(\d{4}-\d{2}-\d{2})\.log/)
          return { name: f, date: match ? match[1] : '' }
        })
        .filter((f) => {
          if (!f.date) return false
          if (dateFrom && f.date < dateFrom) return false
          if (dateTo && f.date > dateTo) return false
          return true
        })
        .sort((a, b) => b.date.localeCompare(a.date)) // 倒序
        .map((f) => join(this.logDir, f.name))

      return files
    } catch {
      return []
    }
  }

  /**
   * 读取单个日志文件并过滤
   */
  private async readLogFile(
    filePath: string,
    filter: { level?: LogLevel; tag?: string; search?: string }
  ): Promise<LogEntry[]> {
    const entries: LogEntry[] = []

    if (!existsSync(filePath)) {
      return entries
    }

    const levelPriority: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    }
    const minLevel = filter.level ? levelPriority[filter.level] : 0

    return new Promise((resolve) => {
      const stream = createReadStream(filePath, { encoding: 'utf8' })
      const rl = createInterface({ input: stream, crlfDelay: Infinity })

      rl.on('line', (line) => {
        if (!line.trim()) return

        try {
          const entry = JSON.parse(line) as LogEntry

          // 级别过滤
          if (levelPriority[entry.level] < minLevel) return

          // 标签过滤
          if (filter.tag && entry.tag !== filter.tag) return

          // 关键词搜索
          if (filter.search) {
            const searchLower = filter.search.toLowerCase()
            const msgMatch = entry.msg?.toLowerCase().includes(searchLower)
            const tagMatch = entry.tag?.toLowerCase().includes(searchLower)
            const ctxMatch = entry.ctx && JSON.stringify(entry.ctx).toLowerCase().includes(searchLower)
            if (!msgMatch && !tagMatch && !ctxMatch) return
          }

          entries.push(entry)
        } catch {
          // 忽略解析失败的行
        }
      })

      rl.on('close', () => {
        resolve(entries)
      })

      rl.on('error', () => {
        resolve(entries)
      })
    })
  }

  /**
   * 清理过期日志
   */
  async cleanup(retentionDays: number): Promise<{ deleted: number; freedBytes: number }> {
    const result = { deleted: 0, freedBytes: 0 }

    if (!existsSync(this.logDir)) {
      return result
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffStr = cutoffDate.toISOString().slice(0, 10)

    try {
      const files = readdirSync(this.logDir)
      for (const file of files) {
        if (!file.startsWith('system-') || !file.endsWith('.log')) continue

        const match = file.match(/system-(\d{4}-\d{2}-\d{2})\.log/)
        if (!match) continue

        const fileDate = match[1]
        if (fileDate < cutoffStr) {
          const filePath = join(this.logDir, file)
          try {
            const stats = statSync(filePath)
            unlinkSync(filePath)
            result.deleted++
            result.freedBytes += stats.size
          } catch {
            // 忽略删除失败
          }
        }
      }
    } catch {
      // 忽略目录读取错误
    }

    return result
  }

  /**
   * 获取所有唯一的标签列表
   */
  async getTags(): Promise<string[]> {
    const tags = new Set<string>()

    if (!existsSync(this.logDir)) {
      return []
    }

    // 只读取最近3天的文件以提高性能
    const today = new Date()
    const files: string[] = []
    for (let i = 0; i < 3; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().slice(0, 10)
      const filePath = join(this.logDir, `system-${dateStr}.log`)
      if (existsSync(filePath)) {
        files.push(filePath)
      }
    }

    for (const filePath of files) {
      const entries = await this.readLogFile(filePath, {})
      for (const entry of entries) {
        if (entry.tag) {
          tags.add(entry.tag)
        }
      }
    }

    return Array.from(tags).sort()
  }
}

// 单例实例
let systemLogService: SystemLogService | null = null

export function getSystemLogService(): SystemLogService {
  if (!systemLogService) {
    systemLogService = new SystemLogService()
  }
  return systemLogService
}

export function setSystemLogService(service: SystemLogService): void {
  systemLogService = service
}