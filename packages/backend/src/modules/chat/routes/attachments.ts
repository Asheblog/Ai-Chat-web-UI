import type { Hono } from 'hono';
import { prisma } from '../../../db';
import { actorMiddleware, adminOnlyMiddleware, requireUserActor } from '../../../middleware/auth';
import type { ApiResponse } from '../../../types';
import {
  determineChatImageBaseUrl,
  resolveChatImageUrls,
  isMessageAttachmentTableMissing,
  MESSAGE_ATTACHMENT_MIGRATION_HINT,
} from '../../../utils/chat-images';

export const registerChatAttachmentRoutes = (router: Hono) => {
  router.post('/admin/attachments/refresh', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const siteBaseSetting = await prisma.systemSetting.findUnique({
        where: { key: 'site_base_url' },
        select: { value: true },
      });
      const baseUrl = determineChatImageBaseUrl({
        request: c.req.raw,
        siteBaseUrl: siteBaseSetting?.value ?? null,
      });

      let total = 0;
      let samples: Array<{ id: number; messageId: number; relativePath: string }> = [];
      try {
        total = await prisma.messageAttachment.count();
        samples = await prisma.messageAttachment.findMany({
          orderBy: { id: 'desc' },
          take: 5,
          select: { id: true, messageId: true, relativePath: true },
        });
      } catch (error) {
        if (isMessageAttachmentTableMissing(error)) {
          return c.json<ApiResponse>({
            success: false,
            error: `图片附件功能尚未初始化：${MESSAGE_ATTACHMENT_MIGRATION_HINT}`,
          }, 503);
        }
        throw error;
      }

      const sampleUrls = samples.map((item) => ({
        id: item.id,
        messageId: item.messageId,
        url: resolveChatImageUrls([item.relativePath], baseUrl)[0] || '',
      }));

      return c.json<ApiResponse>({
        success: true,
        data: {
          baseUrl,
          attachments: total,
          samples: sampleUrls,
          refreshedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[attachments.refresh] error', error);
      return c.json<ApiResponse>({
        success: false,
        error: error instanceof Error ? error.message : '刷新图片链接失败',
      }, 500);
    }
  });
};
