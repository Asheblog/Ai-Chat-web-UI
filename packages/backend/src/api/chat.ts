import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { Tokenizer } from '../utils/tokenizer';
import { authMiddleware } from '../middleware/auth';
import type { ApiResponse, Message } from '../types';

const chat = new Hono();

// 发送消息schema
const sendMessageSchema = z.object({
  sessionId: z.number().int().positive(),
  content: z.string().min(1).max(10000),
});

// 获取会话消息历史
chat.get('/sessions/:sessionId/messages', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const sessionId = parseInt(c.req.param('sessionId'));

    if (isNaN(sessionId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid session ID',
      }, 400);
    }

    // 验证会话是否存在且属于当前用户
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!session) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { sessionId },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.message.count({
        where: { sessionId },
      }),
    ]);

    return c.json<ApiResponse<{
      messages: Message[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>>({
      success: true,
      data: {
        messages,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('Get messages error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch messages',
    }, 500);
  }
});

// 发送消息并获取AI响应（流式）
chat.post('/stream', authMiddleware, zValidator('json', sendMessageSchema), async (c) => {
  try {
    const user = c.get('user');
    const { sessionId, content } = c.req.valid('json');

    // 验证会话是否存在且属于当前用户
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        modelConfig: true,
      },
    });

    if (!session) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    if (session.userId !== user.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Access denied',
      }, 403);
    }

    // 验证模型配置访问权限
    const hasModelAccess = session.modelConfig.userId === user.id ||
                          session.modelConfig.userId === null;

    if (!hasModelAccess) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model configuration access denied',
      }, 403);
    }

    // 保存用户消息
    const userMessage = await prisma.message.create({
      data: {
        sessionId,
        role: 'user',
        content,
      },
    });

    // 获取用户上下文token限制
    const defaultLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000');
    let contextTokenLimit = defaultLimit;

    // 这里可以从用户设置中获取个性化限制，暂时使用默认值
    // TODO: 实现用户个性化设置功能

    // 获取历史消息并构建上下文
    const recentMessages = await prisma.message.findMany({
      where: { sessionId },
      select: {
        role: true,
        content: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // 最多获取50条历史消息
    });

    // 构建对话历史（不包括刚保存的用户消息）
    const conversationHistory = recentMessages
      .filter((msg: { role: string; content: string }) => msg.role !== 'user' || msg.content !== content)
      .reverse(); // 按时间正序

    // 添加当前用户消息
    const fullConversation = [
      ...conversationHistory,
      { role: 'user', content },
    ];

    // 使用tokenizer截断上下文
    const truncatedContext = await Tokenizer.truncateMessages(
      fullConversation,
      contextTokenLimit
    );

    // 解密API Key
    const decryptedApiKey = AuthUtils.decryptApiKey(session.modelConfig.apiKey);

    // 构建AI API请求
    const messagesPayload = truncatedContext.map((msg: { role: string; content: string }) => ({
      role: msg.role,
      content: msg.content,
    }));

    const requestData = {
      model: session.modelConfig.name,
      messages: messagesPayload,
      stream: true,
      temperature: 0.7,
    };

    console.log('Starting AI stream request to:', session.modelConfig.apiUrl);

    // 设置SSE响应头
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Headers', 'Cache-Control');

    let aiResponseContent = '';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送开始事件
          const startEvent = `data: ${JSON.stringify({
            type: 'start',
            messageId: userMessage.id,
          })}\n\n`;
          controller.enqueue(encoder.encode(startEvent));

          // 调用第三方AI API
          const response = await fetch(session.modelConfig.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${decryptedApiKey}`,
            },
            body: JSON.stringify(requestData),
          });

          if (!response.ok) {
            throw new Error(`AI API request failed: ${response.status} ${response.statusText}`);
          }

          // 处理流式响应
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body reader');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);

                if (data === '[DONE]') {
                  // 流结束
                  const endEvent = `data: ${JSON.stringify({
                    type: 'end',
                  })}\n\n`;
                  controller.enqueue(encoder.encode(endEvent));
                  break;
                }

                try {
                  const parsed = JSON.parse(data);

                  // 提取AI响应内容
                  if (parsed.choices?.[0]?.delta?.content) {
                    const content = parsed.choices[0].delta.content;
                    aiResponseContent += content;

                    // 转发内容到客户端
                    const contentEvent = `data: ${JSON.stringify({
                      type: 'content',
                      content,
                    })}\n\n`;
                    controller.enqueue(encoder.encode(contentEvent));
                  }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', data, parseError);
                }
              }
            }
          }

          // 保存AI完整回复
          if (aiResponseContent.trim()) {
            await prisma.message.create({
              data: {
                sessionId,
                role: 'assistant',
                content: aiResponseContent.trim(),
              },
            });
          }

          // 发送完成事件
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
          })}\n\n`;
          controller.enqueue(encoder.encode(completeEvent));

        } catch (error) {
          console.error('Streaming error:', error);

          // 发送错误事件
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream);

  } catch (error) {
    console.error('Chat stream error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to process chat request',
    }, 500);
  }
});

// 停止生成（前端可通过关闭连接实现，这里提供确认接口）
chat.post('/stop', authMiddleware, zValidator('json', z.object({
  sessionId: z.number().int().positive(),
})), async (c) => {
  // 这个接口主要用于前端确认停止生成
  // 实际的停止是通过客户端关闭SSE连接实现的
  return c.json<ApiResponse>({
    success: true,
    message: 'Stop request received',
  });
});

// 重新生成AI回复
chat.post('/regenerate', authMiddleware, zValidator('json', z.object({
  sessionId: z.number().int().positive(),
  messageId: z.number().int().positive(), // 要重新生成的消息ID
})), async (c) => {
  try {
    const user = c.get('user');
    const { sessionId, messageId } = c.req.valid('json');

    // 验证会话和消息权限
    const [session, message] = await Promise.all([
      prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: { modelConfig: true },
      }),
      prisma.message.findUnique({
        where: { id: messageId },
      }),
    ]);

    if (!session || session.userId !== user.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Chat session not found',
      }, 404);
    }

    if (!message || message.sessionId !== sessionId) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Message not found',
      }, 404);
    }

    if (message.role !== 'assistant') {
      return c.json<ApiResponse>({
        success: false,
        error: 'Can only regenerate assistant messages',
      }, 400);
    }

    // 找到对应的用户消息
    const userMessage = await prisma.message.findFirst({
      where: {
        sessionId,
        role: 'user',
        createdAt: { lt: message.createdAt },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!userMessage) {
      return c.json<ApiResponse>({
        success: false,
        error: 'No corresponding user message found',
      }, 404);
    }

    // 删除原有的AI回复
    await prisma.message.delete({
      where: { id: messageId },
    });

    // 这里简化处理，实际应该重新调用AI API
    // 为了简化，我们返回一个提示让前端重新发送请求
    return c.json<ApiResponse>({
      success: true,
      data: {
        userMessageId: userMessage.id,
        prompt: 'Please use the chat stream endpoint to regenerate the response',
      },
      message: 'Original assistant message deleted. Please regenerate using stream endpoint.',
    });

  } catch (error) {
    console.error('Regenerate error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to regenerate response',
    }, 500);
  }
});

export default chat;
