import type { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import { actorMiddleware } from '../../../middleware/auth'
import type { Actor, ApiResponse } from '../../../types'
import { BackendLogger as log } from '../../../utils/logger'
import { sessionOwnershipClause } from '../chat-common'
import {
  titleSummaryService,
  TitleSummaryServiceError,
  type TitleSummaryService,
  type TitleSummaryConfig,
} from '../services/title-summary-service'
import { SettingsService } from '../../../services/settings/settings-service'

const titleSummarySchema = z.object({
  content: z.string().min(1).max(5000),
})

export interface TitleSummaryRoutesDeps {
  prisma?: PrismaClient
  service?: TitleSummaryService
  settingsService?: SettingsService
}

export const registerTitleSummaryRoutes = (
  router: Hono,
  deps: TitleSummaryRoutesDeps = {},
) => {
  const prisma = deps.prisma ?? defaultPrisma
  const service = deps.service ?? titleSummaryService
  const settingsService = deps.settingsService ?? new SettingsService()

  router.post(
    '/sessions/:sessionId/summarize-title',
    actorMiddleware,
    zValidator('json', titleSummarySchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const sessionId = parseInt(c.req.param('sessionId'), 10)
        const { content } = c.req.valid('json')

        if (Number.isNaN(sessionId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
        }

        // 验证会话所有权
        const session = await prisma.chatSession.findFirst({
          where: {
            id: sessionId,
            ...sessionOwnershipClause(actor),
          },
        })

        if (!session) {
          return c.json<ApiResponse>({ success: false, error: 'Session not found' }, 404)
        }

        // 获取标题总结配置
        const settings = await settingsService.getSystemSettings(actor)
        const config: TitleSummaryConfig = {
          enabled: settings.title_summary_enabled as boolean ?? false,
          maxLength: settings.title_summary_max_length as number ?? 20,
          modelSource: (settings.title_summary_model_source as 'current' | 'specified') ?? 'current',
          connectionId: settings.title_summary_connection_id as number | null ?? null,
          modelId: settings.title_summary_model_id as string | null ?? null,
        }

        if (!config.enabled) {
          return c.json<ApiResponse>({ success: false, error: 'Title summary is disabled' }, 400)
        }

        const result = await service.generateTitle({
          sessionId,
          content,
          config,
        })

        // 更新会话标题
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { title: result.title },
        })

        log.info('[title-summary] Session title updated', {
          sessionId,
          title: result.title,
        })

        return c.json<ApiResponse<{ title: string }>>({
          success: true,
          data: { title: result.title },
        })
      } catch (error) {
        if (error instanceof TitleSummaryServiceError) {
          return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as ContentfulStatusCode)
        }
        log.error('[title-summary] Unexpected error', { error })
        return c.json<ApiResponse>({ success: false, error: 'Failed to summarize title' }, 500)
      }
    },
  )
}
