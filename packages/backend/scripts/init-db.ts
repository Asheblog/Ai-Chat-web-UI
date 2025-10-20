#!/usr/bin/env tsx

/**
 * 数据库初始化脚本
 * 用于初始化数据库结构和默认数据
 */

import { PrismaClient } from '@prisma/client';
import { AuthUtils } from '../src/utils/auth';

const prisma = new PrismaClient();

async function initDatabase() {
  try {
    console.log('🔄 开始初始化数据库...');

    // 1. 检查数据库连接
    await prisma.$connect();
    console.log('✅ 数据库连接成功');

    // 2. 初始化系统设置
    await initSystemSettings();

    // 3. 检查是否需要创建默认管理员
    await createDefaultAdmin();

    // 4. 创建示例系统模型（可选）
    await createExampleSystemModel();

    console.log('🎉 数据库初始化完成！');

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function initSystemSettings() {
  const defaultSettings = [
    {
      key: 'registration_enabled',
      value: process.env.APP_MODE === 'multi' ? 'true' : 'false',
    },
    {
      key: 'app_mode',
      value: process.env.APP_MODE || 'single',
    },
    {
      key: 'max_context_tokens',
      value: process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000',
    },
    {
      key: 'app_version',
      value: '1.0.0',
    },
  ];

  for (const setting of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log('✅ 系统设置初始化完成');
}

async function createDefaultAdmin() {
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    // 从环境变量获取默认管理员信息
    const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';

    if (!AuthUtils.validateUsername(defaultUsername)) {
      console.warn('⚠️ 默认管理员用户名格式无效，跳过创建');
      return;
    }

    if (!AuthUtils.validatePassword(defaultPassword)) {
      console.warn('⚠️ 默认管理员密码格式无效，跳过创建');
      return;
    }

    const hashedPassword = await AuthUtils.hashPassword(defaultPassword);

    await prisma.user.create({
      data: {
        username: defaultUsername,
        hashedPassword,
        role: 'ADMIN',
      },
    });

    console.log(`✅ 默认管理员账户创建完成: ${defaultUsername}`);
    console.log('⚠️ 请立即修改默认密码以确保安全！');
  } else {
    console.log('✅ 已存在用户账户，跳过默认管理员创建');
  }
}

async function createExampleSystemModel() {
  const modelCount = await prisma.modelConfig.count({
    where: { userId: null },
  });

  if (modelCount === 0) {
    // 只有在提供了示例API配置时才创建
    const exampleApiKey = process.env.EXAMPLE_SYSTEM_API_KEY;
    const exampleApiUrl = process.env.EXAMPLE_SYSTEM_API_URL;

    if (exampleApiKey && exampleApiUrl) {
      const encryptedApiKey = AuthUtils.encryptApiKey(exampleApiKey);

      await prisma.modelConfig.create({
        data: {
          userId: null, // 系统模型
          name: 'GPT-3.5-Turbo',
          apiUrl: exampleApiUrl,
          apiKey: encryptedApiKey,
        },
      });

      console.log('✅ 示例系统模型创建完成');
    } else {
      console.log('ℹ️ 未提供示例API配置，跳过示例系统模型创建');
    }
  } else {
    console.log('✅ 已存在系统模型，跳过示例创建');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initDatabase();
}

export { initDatabase };