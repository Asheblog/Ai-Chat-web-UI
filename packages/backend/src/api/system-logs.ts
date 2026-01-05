/**
 * 系统日志 API
 * 提供日志查询、统计、清理等功能
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { ApiResponse } from '../types'
import { getSystemLogService, SystemLogService } from '../services/system-logs/system-log-service'
import { getLogConfig, setLogConfig, cleanupOldLogFiles, type LogLevel } from '../utils/logger'
import { actorMiddleware, adminOnlyMiddleware } from '../middleware/auth'

export interface SystemLogsApiDeps {
  systemLogService?: SystemLogService
}

// 查询参数 schema
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// 配置更新 schema
const configSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  toFile: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
})

// 清理参数 schema
const cleanupSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
})

export const createSystemLogsApi = (deps: SystemLogsApiDeps = {}) => {
  const router = new Hono()
  const logService = deps.systemLogService ?? getSystemLogService()

  // 所有接口仅限管理员
  router.use('*', actorMiddleware, adminOnlyMiddleware)

  /**
   * GET /api/system-logs - 查询日志
   */
  router.get('/', zValidator('query', querySchema), async (c) => {
    try {
      const params = c.req.valid('query')
      const result = await logService.query(params)

      return c.json<ApiResponse>({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('[SystemLogs] Query failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to query logs' },
        500
      )
    }
  })

  /**
   * GET /api/system-logs/stats - 获取日志统计
   */
  router.get('/stats', async (c) => {
    try {
      const stats = await logService.getStats()
      return c.json<ApiResponse>({
        success: true,
        data: stats,
      })
    } catch (error) {
      console.error('[SystemLogs] Get stats failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to get log stats' },
        500
      )
    }
  })

  /**
   * GET /api/system-logs/tags - 获取所有标签
   */
  router.get('/tags', async (c) => {
    try {
      const tags = await logService.getTags()
      return c.json<ApiResponse>({
        success: true,
        data: { tags },
      })
    } catch (error) {
      console.error('[SystemLogs] Get tags failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to get tags' },
        500
      )
    }
  })

  /**
   * GET /api/system-logs/config - 获取当前日志配置
   */
  router.get('/config', async (c) => {
    try {
      const config = getLogConfig()
      return c.json<ApiResponse>({
        success: true,
        data: config,
      })
    } catch (error) {
      console.error('[SystemLogs] Get config failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to get log config' },
        500
      )
    }
  })

  /**
   * PUT /api/system-logs/config - 更新日志配置
   */
  router.put('/config', zValidator('json', configSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      setLogConfig(body)

      return c.json<ApiResponse>({
        success: true,
        data: getLogConfig(),
      })
    } catch (error) {
      console.error('[SystemLogs] Update config failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to update log config' },
        500
      )
    }
  })

  /**
   * POST /api/system-logs/cleanup - 清理过期日志
   */
  router.post('/cleanup', zValidator('json', cleanupSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      const config = getLogConfig()
      const retentionDays = body.retentionDays ?? config.retentionDays

      const result = await logService.cleanup(retentionDays)

      // 同时清理内存中的过期文件引用
      cleanupOldLogFiles()

      return c.json<ApiResponse>({
        success: true,
        data: {
          deleted: result.deleted,
          freedBytes: result.freedBytes,
          retentionDays,
        },
      })
    } catch (error) {
      console.error('[SystemLogs] Cleanup failed:', error)
      return c.json<ApiResponse>(
        { success: false, error: 'Failed to cleanup logs' },
        500
      )
    }
  })

  return router
}

export default createSystemLogsApi()