import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse, ModelConfig } from '../types';

const models = new Hono();

// 创建模型配置schema
const createModelSchema = z.object({
  name: z.string().min(1).max(100),
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
  supportsImages: z.boolean().optional().default(false),
});

// 更新模型配置schema
const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  supportsImages: z.boolean().optional(),
});

// 获取所有可用的模型配置（个人+系统）
models.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');

    // 并行获取个人模型和系统模型
    const [personalModels, systemModels] = await Promise.all([
      prisma.modelConfig.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          name: true,
          apiUrl: true,
          supportsImages: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.modelConfig.findMany({
        where: { userId: null },
        select: {
          id: true,
          name: true,
          apiUrl: true,
          supportsImages: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return c.json<ApiResponse<{
      personal: ModelConfig[];
      system: ModelConfig[];
    }>>({
      success: true,
      data: {
        personal: personalModels.map((model: { id: number; name: string; apiUrl: string; supportsImages: boolean; createdAt: Date }) => ({
          ...model,
          userId: user.id,
          apiKey: '', // 不返回API Key
        })),
        system: systemModels.map((model: { id: number; name: string; apiUrl: string; supportsImages: boolean; createdAt: Date }) => ({
          ...model,
          userId: null,
          apiKey: '', // 不返回API Key
        })),
      },
    });

  } catch (error) {
    console.error('Get models error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch models',
    }, 500);
  }
});

// 创建个人模型配置
models.post('/', authMiddleware, zValidator('json', createModelSchema), async (c) => {
  try {
    const user = c.get('user');
    const { name, apiUrl, apiKey, supportsImages } = c.req.valid('json');

    // 验证URL格式
    if (!AuthUtils.validateUrl(apiUrl)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid API URL format',
      }, 400);
    }

    // 检查名称是否重复（个人模型范围内）
    const existingModel = await prisma.modelConfig.findFirst({
      where: {
        userId: user.id,
        name,
      },
    });

    if (existingModel) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model name already exists',
      }, 409);
    }

    // 加密API Key
    const encryptedApiKey = AuthUtils.encryptApiKey(apiKey);

    // 创建模型配置
    const modelConfig = await prisma.modelConfig.create({
      data: {
        userId: user.id,
        name,
        apiUrl,
        apiKey: encryptedApiKey,
        supportsImages: !!supportsImages,
      },
      select: {
        id: true,
        name: true,
        apiUrl: true,
        supportsImages: true,
        createdAt: true,
      },
    });

    return c.json<ApiResponse<ModelConfig>>({
      success: true,
      data: {
        ...modelConfig,
        userId: user.id,
        apiKey: '', // 不返回API Key
      },
      message: 'Model configuration created successfully',
    });

  } catch (error) {
    console.error('Create model error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to create model configuration',
    }, 500);
  }
});

// 获取单个模型配置详情
models.get('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const modelId = parseInt(c.req.param('id'));

    if (isNaN(modelId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid model ID',
      }, 400);
    }

    const modelConfig = await prisma.modelConfig.findFirst({
      where: {
        id: modelId,
        OR: [
          { userId: user.id }, // 个人模型
          { userId: null },    // 系统模型
        ],
      },
      select: {
        id: true,
        name: true,
        apiUrl: true,
        supportsImages: true,
        userId: true,
        createdAt: true,
      },
    });

    if (!modelConfig) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model configuration not found',
      }, 404);
    }

    return c.json<ApiResponse<ModelConfig>>({
      success: true,
      data: {
        ...modelConfig,
        apiKey: '', // 不返回API Key
      },
    });

  } catch (error) {
    console.error('Get model error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch model configuration',
    }, 500);
  }
});

// 更新个人模型配置
models.put('/:id', authMiddleware, zValidator('json', updateModelSchema), async (c) => {
  try {
    const user = c.get('user');
    const modelId = parseInt(c.req.param('id'));
    const updateData = c.req.valid('json');

    if (isNaN(modelId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid model ID',
      }, 400);
    }

    // 验证模型是否存在且属于当前用户
    const existingModel = await prisma.modelConfig.findFirst({
      where: {
        id: modelId,
        userId: user.id, // 只能更新个人模型
      },
    });

    if (!existingModel) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model configuration not found or cannot be modified',
      }, 404);
    }

    // 验证URL格式（如果提供）
    if (updateData.apiUrl && !AuthUtils.validateUrl(updateData.apiUrl)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid API URL format',
      }, 400);
    }

    // 检查名称是否重复（如果更新名称）
    if (updateData.name) {
      const duplicateModel = await prisma.modelConfig.findFirst({
        where: {
          userId: user.id,
          name: updateData.name,
          id: { not: modelId },
        },
      });

      if (duplicateModel) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Model name already exists',
        }, 409);
      }
    }

    // 处理数据更新
    const data: any = {};
    if (updateData.name) data.name = updateData.name;
    if (updateData.apiUrl) data.apiUrl = updateData.apiUrl;
    if (updateData.apiKey) data.apiKey = AuthUtils.encryptApiKey(updateData.apiKey);
    if (typeof (updateData as any).supportsImages === 'boolean') data.supportsImages = (updateData as any).supportsImages;

    const updatedModel = await prisma.modelConfig.update({
      where: { id: modelId },
      data,
      select: {
        id: true,
        name: true,
        apiUrl: true,
        supportsImages: true,
        createdAt: true,
      },
    });

    return c.json<ApiResponse<ModelConfig>>({
      success: true,
      data: {
        ...updatedModel,
        userId: user.id,
        apiKey: '', // 不返回API Key
      },
      message: 'Model configuration updated successfully',
    });

  } catch (error) {
    console.error('Update model error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update model configuration',
    }, 500);
  }
});

// 删除个人模型配置
models.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const modelId = parseInt(c.req.param('id'));

    if (isNaN(modelId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid model ID',
      }, 400);
    }

    // 验证模型是否存在且属于当前用户
    const existingModel = await prisma.modelConfig.findFirst({
      where: {
        id: modelId,
        userId: user.id, // 只能删除个人模型
      },
    });

    if (!existingModel) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Model configuration not found or cannot be deleted',
      }, 404);
    }

    // 检查是否有关联的聊天会话
    const sessionCount = await prisma.chatSession.count({
      where: { modelConfigId: modelId },
    });

    if (sessionCount > 0) {
      return c.json<ApiResponse>({
        success: false,
        error: `Cannot delete model: ${sessionCount} chat sessions are using this model`,
      }, 400);
    }

    // 删除模型配置
    await prisma.modelConfig.delete({
      where: { id: modelId },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'Model configuration deleted successfully',
    });

  } catch (error) {
    console.error('Delete model error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to delete model configuration',
    }, 500);
  }
});

// ========== 系统模型管理（仅管理员） ==========

// 创建系统模型配置
models.post('/system', authMiddleware, adminOnlyMiddleware, zValidator('json', createModelSchema), async (c) => {
  try {
    const { name, apiUrl, apiKey, supportsImages } = c.req.valid('json');

    // 验证URL格式
    if (!AuthUtils.validateUrl(apiUrl)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid API URL format',
      }, 400);
    }

    // 检查名称是否重复
    const existingModel = await prisma.modelConfig.findFirst({
      where: {
        userId: null, // 系统模型
        name,
      },
    });

    if (existingModel) {
      return c.json<ApiResponse>({
        success: false,
        error: 'System model name already exists',
      }, 409);
    }

    // 加密API Key
    const encryptedApiKey = AuthUtils.encryptApiKey(apiKey);

    // 创建系统模型配置
    const modelConfig = await prisma.modelConfig.create({
      data: {
        userId: null, // 系统模型
        name,
        apiUrl,
        apiKey: encryptedApiKey,
        supportsImages: !!supportsImages,
      },
      select: {
        id: true,
        name: true,
        apiUrl: true,
        supportsImages: true,
        createdAt: true,
      },
    });

    return c.json<ApiResponse<ModelConfig>>({
      success: true,
      data: {
        ...modelConfig,
        userId: null,
        apiKey: '', // 不返回API Key
      },
      message: 'System model configuration created successfully',
    });

  } catch (error) {
    console.error('Create system model error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to create system model configuration',
    }, 500);
  }
});

// 更新系统模型配置（仅管理员）
models.put('/system/:id', authMiddleware, adminOnlyMiddleware, zValidator('json', updateModelSchema), async (c) => {
  try {
    const modelId = parseInt(c.req.param('id'));
    const updateData = c.req.valid('json');

    if (isNaN(modelId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid model ID' }, 400);
    }

    // 验证模型是否存在且为系统模型
    const existingModel = await prisma.modelConfig.findFirst({ where: { id: modelId, userId: null } });
    if (!existingModel) {
      return c.json<ApiResponse>({ success: false, error: 'System model configuration not found or cannot be modified' }, 404);
    }

    // 验证URL格式（如果提供）
    if (updateData.apiUrl && !AuthUtils.validateUrl(updateData.apiUrl)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid API URL format' }, 400);
    }

    // 检查名称是否重复（如果更新名称）
    if (updateData.name) {
      const duplicateModel = await prisma.modelConfig.findFirst({
        where: { userId: null, name: updateData.name, id: { not: modelId } },
      });
      if (duplicateModel) {
        return c.json<ApiResponse>({ success: false, error: 'System model name already exists' }, 409);
      }
    }

    const data: any = {};
    if (updateData.name) data.name = updateData.name;
    if (updateData.apiUrl) data.apiUrl = updateData.apiUrl;
    if (updateData.apiKey) data.apiKey = AuthUtils.encryptApiKey(updateData.apiKey);
    if (typeof (updateData as any).supportsImages === 'boolean') data.supportsImages = (updateData as any).supportsImages;

    const updatedModel = await prisma.modelConfig.update({
      where: { id: modelId },
      data,
      select: { id: true, name: true, apiUrl: true, supportsImages: true, createdAt: true },
    });

    return c.json<ApiResponse<ModelConfig>>({
      success: true,
      data: { ...updatedModel, userId: null, apiKey: '' },
      message: 'System model configuration updated successfully',
    });
  } catch (error) {
    console.error('Update system model error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to update system model configuration' }, 500);
  }
});

// 删除系统模型配置（仅管理员）
models.delete('/system/:id', authMiddleware, adminOnlyMiddleware, async (c) => {
  try {
    const modelId = parseInt(c.req.param('id'));
    if (isNaN(modelId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid model ID' }, 400);
    }

    const existingModel = await prisma.modelConfig.findFirst({ where: { id: modelId, userId: null } });
    if (!existingModel) {
      return c.json<ApiResponse>({ success: false, error: 'System model configuration not found or cannot be deleted' }, 404);
    }

    const sessionCount = await prisma.chatSession.count({ where: { modelConfigId: modelId } });
    if (sessionCount > 0) {
      return c.json<ApiResponse>({ success: false, error: `Cannot delete model: ${sessionCount} chat sessions are using this model` }, 400);
    }

    await prisma.modelConfig.delete({ where: { id: modelId } });
    return c.json<ApiResponse>({ success: true, message: 'System model configuration deleted successfully' });
  } catch (error) {
    console.error('Delete system model error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete system model configuration' }, 500);
  }
});

// 获取所有系统模型配置
models.get('/system/list', authMiddleware, adminOnlyMiddleware, async (c) => {
  try {
    const systemModels = await prisma.modelConfig.findMany({
      where: { userId: null },
      select: {
        id: true,
        name: true,
        apiUrl: true,
        supportsImages: true,
        createdAt: true,
        _count: {
          select: {
            chatSessions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return c.json<ApiResponse<ModelConfig[]>>({
      success: true,
      data: systemModels.map((model: { id: number; name: string; apiUrl: string; supportsImages: boolean; createdAt: Date; _count?: any }) => ({
        ...model,
        userId: null,
        apiKey: '', // 不返回API Key
      })),
    });

  } catch (error) {
    console.error('Get system models error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch system models',
    }, 500);
  }
});

export default models;
