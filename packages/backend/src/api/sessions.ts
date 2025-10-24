import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { ApiResponse, ChatSession } from '../types';
import { fetchModelsForConnection } from '../utils/providers'
import { AuthUtils } from '../utils/auth'

const sessions = new Hono();

// 创建会话schema
const createSessionSchema = z.object({
  modelId: z.string().min(1), // 聚合模型ID（含前缀）
  title: z.string().min(1).max(200).optional(),
  // 会话级推理默认（可选）
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low','medium','high']).optional(),
  ollamaThink: z.boolean().optional(),
});

// 获取用户的聊天会话列表
sessions.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');

    const [sessionsList, total] = await Promise.all([
      prisma.chatSession.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          userId: true,
          connectionId: true,
          modelRawId: true,
          title: true,
          createdAt: true,
          reasoningEnabled: true,
          reasoningEffort: true,
          ollamaThink: true,
          connection: {
            select: { id: true, provider: true, baseUrl: true, prefixId: true }
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.chatSession.count({
        where: { userId: user.id },
      }),
    ]);

    return c.json<ApiResponse<{
      sessions: Array<{
        id: number;
        userId: number;
        title: string;
        createdAt: Date;
        reasoningEnabled: boolean | null;
        reasoningEffort: 'low'|'medium'|'high' | null;
        ollamaThink: boolean | null;
        _count: { messages: number };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>>({
      success: true,
      data: {
        sessions: sessionsList.map((s) => ({
          ...s,
          // 附加一个模型标签，供前端展示
          modelLabel: s.modelRawId || undefined,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('Get sessions error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch chat sessions',
    }, 500);
  }
});

// 创建新的聊天会话
sessions.post('/', authMiddleware, zValidator('json', createSessionSchema), async (c) => {
  try {
    const user = c.get('user');
    const { modelId, title, reasoningEnabled, reasoningEffort, ollamaThink } = c.req.valid('json');

    // 解析 modelId -> (connectionId, rawId)
    // 先查缓存表
    let connectionId: number | null = null
    let rawId: string | null = null
    const cached = await prisma.modelCatalog.findFirst({ where: { modelId } })
    if (cached) {
      connectionId = cached.connectionId
      rawId = cached.rawId
    } else {
      // 无缓存命中：基于前缀与“实际可用模型列表”精确解析，避免误选到其他连接
      const conns = await prisma.connection.findMany({ where: { OR: [ { ownerUserId: null }, { ownerUserId: user.id } ], enable: true } })

      // 1) 若 modelId 含前缀，优先用前缀锁定连接
      for (const conn of conns) {
        const px = (conn.prefixId || '')
        if (px && modelId.startsWith(px + '.')) {
          connectionId = conn.id
          rawId = modelId.substring(px.length + 1)
          break
        }
      }

      // 2) 若依然未命中：动态拉取每个连接的模型目录（与 /catalog/models 一致）做精确匹配
      if (!connectionId || !rawId) {
        const candidates: Array<{ connectionId: number; rawId: string }> = []
        for (const conn of conns) {
          const cfg = {
            provider: conn.provider as any,
            baseUrl: conn.baseUrl,
            enable: conn.enable,
            authType: conn.authType as any,
            apiKey: conn.apiKey ? AuthUtils.decryptApiKey(conn.apiKey) : undefined,
            headers: conn.headersJson ? JSON.parse(conn.headersJson) : undefined,
            azureApiVersion: conn.azureApiVersion || undefined,
            prefixId: conn.prefixId || undefined,
            tags: conn.tagsJson ? JSON.parse(conn.tagsJson) : [],
            modelIds: conn.modelIdsJson ? JSON.parse(conn.modelIdsJson) : [],
            connectionType: (conn.connectionType as any) || 'external',
          }
          try {
            const items = await fetchModelsForConnection(cfg)
            const hit = items.find((it) => it.id === modelId)
            if (hit) candidates.push({ connectionId: conn.id, rawId: hit.rawId })
          } catch {
            // 单个连接失败不影响整体解析
          }
        }

        if (candidates.length === 1) {
          connectionId = candidates[0].connectionId
          rawId = candidates[0].rawId
        } else if (candidates.length > 1) {
          // 同名模型在多个连接中存在且均无前缀：返回歧义，要求使用带前缀的 modelId
          return c.json<ApiResponse>({ success: false, error: 'Ambiguous modelId across multiple connections. Please set a unique prefix for connections or use a prefixed modelId.' }, 400)
        }
      }
    }

    if (!connectionId || !rawId) {
      return c.json<ApiResponse>({ success: false, error: 'Model not found in connections' }, 400)
    }

    // 创建会话
    const session = await prisma.chatSession.create({
      data: {
        userId: user.id,
        connectionId,
        modelRawId: rawId,
        title: title || 'New Chat',
        reasoningEnabled,
        reasoningEffort,
        ollamaThink,
      },
      select: {
        id: true,
        userId: true,
        connectionId: true,
        modelRawId: true,
        title: true,
        createdAt: true,
        reasoningEnabled: true,
        reasoningEffort: true,
        ollamaThink: true,
        connection: { select: { id: true, provider: true, baseUrl: true, prefixId: true } },
      },
    });

    return c.json<ApiResponse<{
      id: number;
      userId: number;
      title: string;
      createdAt: Date;
      reasoningEnabled: boolean | null;
      reasoningEffort: 'low' | 'medium' | 'high' | null;
      ollamaThink: boolean | null;
    }>>({
      success: true,
      data: { ...session, modelLabel: session.modelRawId },
      message: 'Chat session created successfully',
    });

  } catch (error) {
    console.error('Create session error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to create chat session',
    }, 500);
  }
});

// 获取单个聊天会话详情
sessions.get('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('id'));

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
      select: {
        id: true,
        userId: true,
        connectionId: true,
        modelRawId: true,
        title: true,
        createdAt: true,
        reasoningEnabled: true,
        reasoningEffort: true,
        ollamaThink: true,
        connection: { select: { id: true, provider: true, baseUrl: true, prefixId: true } },
        messages: {
          select: {
            id: true,
            sessionId: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    return c.json<ApiResponse<any>>({
      success: true,
      data: { ...session, modelLabel: session?.modelRawId },
    });

  } catch (error) {
    console.error('Get session error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch chat session',
    }, 500);
  }
});

// 更新会话标题
sessions.put('/:id', authMiddleware, zValidator('json', z.object({
  title: z.string().min(1).max(200).optional(),
  reasoningEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['low','medium','high']).optional(),
  ollamaThink: z.boolean().optional(),
})), async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('id'));
    const { title, reasoningEnabled, reasoningEffort, ollamaThink } = c.req.valid('json');

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    // 验证会话是否存在且属于当前用户
    const existingSession = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!existingSession) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    // 更新会话字段
    const updatedSession = await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof reasoningEnabled === 'boolean' ? { reasoningEnabled } : {}),
        ...(typeof reasoningEffort === 'string' ? { reasoningEffort } : {}),
        ...(typeof ollamaThink === 'boolean' ? { ollamaThink } : {}),
      },
      select: {
        id: true,
        userId: true,
        title: true,
        createdAt: true,
        reasoningEnabled: true,
        reasoningEffort: true,
        ollamaThink: true,
      },
    });

    return c.json<ApiResponse<{
      id: number;
      userId: number;
      title: string;
      createdAt: Date;
      reasoningEnabled: boolean | null;
      reasoningEffort: 'low'|'medium'|'high' | null;
      ollamaThink: boolean | null;
    }>>({
      success: true,
      data: updatedSession,
      message: 'Session updated successfully',
    });

  } catch (error) {
    console.error('Update session error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update session title',
    }, 500);
  }
});

// 切换会话的模型（聚合模型ID -> 连接ID + 原始模型ID）
sessions.put('/:id/model', authMiddleware, zValidator('json', z.object({
  modelId: z.string().min(1),
})), async (c) => {
  try {
    const user = c.get('user')
    const sessionId = parseInt(c.req.param('id'))
    const { modelId } = c.req.valid('json')

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
    }

    // 验证会话归属
    const existing = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: user.id } })
    if (!existing) {
      return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404)
    }

    // 解析 modelId -> (connectionId, rawId)
    let connectionId: number | null = null
    let rawId: string | null = null

    // 优先命中缓存目录
    const cached = await prisma.modelCatalog.findFirst({ where: { modelId } })
    if (cached) {
      connectionId = cached.connectionId
      rawId = cached.rawId
    } else {
      // 回退：从可见连接中匹配（系统级 + 用户级）
      const conns = await prisma.connection.findMany({
        where: { OR: [ { ownerUserId: null }, { ownerUserId: user.id } ], enable: true },
      })
      for (const conn of conns) {
        const px = (conn.prefixId || '')
        if (px && modelId.startsWith(px + '.')) {
          connectionId = conn.id
          rawId = modelId.substring(px.length + 1)
          break
        }
        if (!px) {
          connectionId = conn.id
          rawId = modelId
          break
        }
      }
    }

    if (!connectionId || !rawId) {
      return c.json<ApiResponse>({ success: false, error: 'Model not found in connections' }, 400)
    }

    // 更新会话的连接与模型
    const updated = await prisma.chatSession.update({
      where: { id: sessionId },
      data: { connectionId, modelRawId: rawId },
      select: {
        id: true,
        userId: true,
        connectionId: true,
        modelRawId: true,
        title: true,
        createdAt: true,
        reasoningEnabled: true,
        reasoningEffort: true,
        ollamaThink: true,
      },
    })

    return c.json<ApiResponse<any>>({ success: true, data: { ...updated, modelLabel: updated.modelRawId } })
  } catch (error) {
    console.error('Switch session model error:', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to switch session model' }, 500)
  }
})

// 删除聊天会话
sessions.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('id'));

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    // 验证会话是否存在且属于当前用户
    const existingSession = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!existingSession) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    // 删除会话（相关消息会通过Prisma的cascade删除）
    await prisma.chatSession.delete({
      where: { id: sessionId },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'Chat session deleted successfully',
    });

  } catch (error) {
    console.error('Delete session error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to delete chat session',
    }, 500);
  }
});

// 清空会话消息
sessions.delete('/:id/messages', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('id'));

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    // 验证会话是否存在且属于当前用户
    const existingSession = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!existingSession) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    // 删除会话中的所有消息
    await prisma.message.deleteMany({
      where: { sessionId },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'Session messages cleared successfully',
    });

  } catch (error) {
    console.error('Clear session messages error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to clear session messages',
    }, 500);
  }
});

export default sessions;
