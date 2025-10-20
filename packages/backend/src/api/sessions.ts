import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { ApiResponse, ChatSession } from '../types';

const sessions = new Hono();

// 创建会话schema
const createSessionSchema = z.object({
  modelConfigId: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
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
          title: true,
          createdAt: true,
          modelConfig: {
            select: {
              id: true,
              name: true,
            },
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
      sessions: ChatSession[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>>({
      success: true,
      data: {
        sessions: sessionsList,
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
    const { modelConfigId, title } = c.req.valid('json');

    // 验证模型配置是否存在且用户有权限访问
    const modelConfig = await prisma.modelConfig.findFirst({
      where: {
        id: modelConfigId,
        OR: [
          { userId: user.id },    // 个人模型
          { userId: null },       // 系统模型
        ],
      },
    });

    if (!modelConfig) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model configuration not found or access denied',
      }, 404);
    }

    // 创建会话
    const session = await prisma.chatSession.create({
      data: {
        userId: user.id,
        modelConfigId,
        title: title || 'New Chat',
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        modelConfig: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return c.json<ApiResponse<ChatSession>>({
      success: true,
      data: session,
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
        title: true,
        createdAt: true,
        modelConfig: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          select: {
            id: true,
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

    return c.json<ApiResponse<ChatSession>>({
      success: true,
      data: session,
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
  title: z.string().min(1).max(200),
})), async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('id'));
    const { title } = c.req.valid('json');

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

    // 更新会话标题
    const updatedSession = await prisma.chatSession.update({
      where: { id: sessionId },
      data: { title },
      select: {
        id: true,
        title: true,
        createdAt: true,
        modelConfig: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return c.json<ApiResponse<ChatSession>>({
      success: true,
      data: updatedSession,
      message: 'Session title updated successfully',
    });

  } catch (error) {
    console.error('Update session error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update session title',
    }, 500);
  }
});

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