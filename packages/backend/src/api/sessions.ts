import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { ApiResponse, ChatSession } from '../types';
// 保留原有创建会话解析逻辑；前端可传 connectionId/rawId 以避免歧义

const sessions = new Hono();

// 容错解析连接配置的模型ID列表
const parseModelIds = (json?: string | null): string[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

const composeModelLabel = (rawId?: string | null, prefix?: string | null, fallback?: string | null): string | null => {
  const cleanRaw = (rawId || '').trim()
  const cleanPrefix = (prefix || '').trim()
  if (cleanRaw && cleanPrefix) return `${cleanPrefix}.${cleanRaw}`
  if (cleanRaw) return cleanRaw
  return fallback || null
}

// 创建会话schema
// 支持同时传入 connectionId + rawId 以绕开字符串解析歧义
const createSessionSchema = z.object({
  modelId: z.string().min(1), // 聚合模型ID（含前缀）
  title: z.string().min(1).max(200).optional(),
  // 直接指定连接与原始模型ID（推荐，避免歧义）
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
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
          modelLabel: composeModelLabel(s.modelRawId, s.connection?.prefixId || null) || undefined,
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
  return (async () => {
    const user = c.get('user');
    const { modelId, title, connectionId: reqConnectionId, rawId: reqRawId, reasoningEnabled, reasoningEffort, ollamaThink } = c.req.valid('json');

    // 解析 modelId -> (connectionId, rawId)
    // 优先使用客户端直传（更可靠）
    let connectionId: number | null = null
    let rawId: string | null = null
    if (reqConnectionId && reqRawId) {
      // 校验连接对当前用户可见且启用
      const conn = await prisma.connection.findFirst({ where: { id: reqConnectionId, enable: true, OR: [ { ownerUserId: null }, { ownerUserId: user.id } ] } })
      if (!conn) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid connectionId for current user' }, 400)
      }
      connectionId = reqConnectionId
      rawId = reqRawId
    } else {
      // 先查缓存表
      const cached = await prisma.modelCatalog.findFirst({ where: { modelId } })
      if (cached) {
        connectionId = cached.connectionId
        rawId = cached.rawId
      } else {
        // 回退：尝试匹配 prefix 到连接（旧逻辑留作兼容；优先使用前端直传 connectionId/rawId）
        const conns = await prisma.connection.findMany({ where: { OR: [ { ownerUserId: null }, { ownerUserId: user.id } ], enable: true } })
        let fallbackExact: { connectionId: number; rawId: string } | null = null
        let fallbackFirst: { connectionId: number; rawId: string } | null = null
        for (const conn of conns) {
          const px = (conn.prefixId || '').trim()
          if (px && modelId.startsWith(px + '.')) {
            connectionId = conn.id
            rawId = modelId.substring(px.length + 1)
            break
          }
          if (!px) {
            if (!fallbackFirst) {
              fallbackFirst = { connectionId: conn.id, rawId: modelId }
            }
            if (!fallbackExact) {
              const ids = parseModelIds(conn.modelIdsJson)
              if (ids.includes(modelId)) {
                fallbackExact = { connectionId: conn.id, rawId: modelId }
              }
            }
          }
        }
        if (!connectionId || !rawId) {
          const selected = fallbackExact || fallbackFirst
          if (selected) {
            connectionId = selected.connectionId
            rawId = selected.rawId
          }
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
      data: { ...session, modelLabel: modelId || composeModelLabel(session.modelRawId, session.connection?.prefixId || null) },
      message: 'Chat session created successfully',
    });
  } )().catch((error) => {
    console.error('Create session error:', error)
    return c.json<ApiResponse>({ success: false, error: 'Failed to create chat session' }, 500)
  })
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
      data: { ...session, modelLabel: composeModelLabel(session?.modelRawId, session?.connection?.prefixId || null) },
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
  connectionId: z.number().int().positive().optional(),
  rawId: z.string().min(1).optional(),
})), async (c) => {
  try {
    const user = c.get('user')
    const sessionId = parseInt(c.req.param('id'))
    const { modelId, connectionId: reqConnectionId, rawId: reqRawId } = c.req.valid('json') as { modelId: string; connectionId?: number; rawId?: string }

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

    if (reqConnectionId && reqRawId) {
      const conn = await prisma.connection.findFirst({
        where: {
          id: reqConnectionId,
          enable: true,
          OR: [ { ownerUserId: null }, { ownerUserId: user.id } ],
        },
      })
      if (!conn) {
        return c.json<ApiResponse>({ success: false, error: 'Connection not found for current user' }, 404)
      }
      connectionId = conn.id
      rawId = reqRawId
    }

    if (!connectionId || !rawId) {
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
        let fallbackExact: { connectionId: number; rawId: string } | null = null
        let fallbackFirst: { connectionId: number; rawId: string } | null = null
        for (const conn of conns) {
          const px = (conn.prefixId || '').trim()
          if (px && modelId.startsWith(px + '.')) {
            connectionId = conn.id
            rawId = modelId.substring(px.length + 1)
            break
          }
          if (!px) {
            if (!fallbackFirst) {
              fallbackFirst = { connectionId: conn.id, rawId: modelId }
            }
            if (!fallbackExact) {
              const ids = parseModelIds(conn.modelIdsJson)
              if (ids.includes(modelId)) {
                fallbackExact = { connectionId: conn.id, rawId: modelId }
              }
            }
          }
        }
        if (!connectionId || !rawId) {
          const selected = fallbackExact || fallbackFirst
          if (selected) {
            connectionId = selected.connectionId
            rawId = selected.rawId
          }
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

    return c.json<ApiResponse<any>>({ success: true, data: { ...updated, modelLabel: modelId } })
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
