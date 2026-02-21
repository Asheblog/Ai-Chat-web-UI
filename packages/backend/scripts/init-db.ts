#!/usr/bin/env tsx

/**
 * 数据库初始化脚本
 * 用于初始化数据库结构和默认数据
 */

import { PrismaClient } from '@prisma/client';
import { AuthUtils } from '../src/utils/auth';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const prisma = new PrismaClient();

const readEnvFlag = (value: unknown): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y'
}

const getMissingSkillTable = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null
  }

  const record = error as {
    code?: unknown
    meta?: {
      table?: unknown
      modelName?: unknown
    }
  }

  if (record.code !== 'P2021') {
    return null
  }

  const table = typeof record.meta?.table === 'string' ? record.meta.table : ''
  const modelName = typeof record.meta?.modelName === 'string' ? record.meta.modelName : ''
  const relatedKeywords = ['skills', 'skill_versions', 'skill_bindings', 'Skill', 'SkillVersion', 'SkillBinding']
  const matched = relatedKeywords.some((keyword) => table.includes(keyword) || modelName.includes(keyword))
  if (!matched) {
    return null
  }

  return table || modelName || 'skills'
}

async function initDatabase() {
  try {
    console.log('🔄 开始初始化数据库...');

    // 1. 检查数据库连接
    await prisma.$connect();
    console.log('✅ 数据库连接成功');

    const initialUserCount = await prisma.user.count()

    // 2. 初始化系统设置
    await initSystemSettings();

    // 3. 检查是否需要创建默认管理员
    await createDefaultAdmin(initialUserCount);

    // 4. 创建示例系统连接（可选）
    await createExampleSystemConnection();

    // 5. 初始化首次启动引导状态（可选）
    await initSetupState({ initialUserCount })

    // 6. 初始化内置 Skills（系统级默认绑定）
    await initBuiltinSkills()

    console.log('🎉 数据库初始化完成！');

  } catch (error) {
    const missingSkillTable = getMissingSkillTable(error)
    if (missingSkillTable) {
      console.error('❌ 数据库初始化失败：Skill 相关数据表不存在')
      console.error(`   缺失表/模型: ${missingSkillTable}`)
      console.error('   请先同步 Prisma schema 后重试：')
      console.error('   1) pnpm --filter @aichat/backend db:deploy')
      console.error('   2) pnpm --filter @aichat/backend db:init')
      process.exit(1)
    }
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
      value: process.env.DEFAULT_REGISTRATION_ENABLED === 'false' ? 'false' : 'true',
    },
    {
      key: 'max_context_tokens',
      value: process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000',
    },
    {
      key: 'app_version',
      value: '1.9.0',
    },
    {
      key: 'anonymous_retention_days',
      value: process.env.ANONYMOUS_RETENTION_DAYS || '15',
    },
    {
      key: 'anonymous_daily_quota',
      value: process.env.ANONYMOUS_DAILY_QUOTA || '20',
    },
    {
      key: 'default_user_daily_quota',
      value: process.env.DEFAULT_USER_DAILY_QUOTA || '200',
    },
    {
      key: 'battle_allow_anonymous',
      value: process.env.BATTLE_ALLOW_ANONYMOUS === 'false' ? 'false' : 'true',
    },
    {
      key: 'battle_allow_users',
      value: process.env.BATTLE_ALLOW_USERS === 'false' ? 'false' : 'true',
    },
    {
      key: 'battle_anonymous_daily_quota',
      value: process.env.BATTLE_ANONYMOUS_DAILY_QUOTA || '20',
    },
    {
      key: 'battle_user_daily_quota',
      value: process.env.BATTLE_USER_DAILY_QUOTA || '200',
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

async function createDefaultAdmin(initialUserCount: number) {
  if (initialUserCount === 0) {
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
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    console.log(`✅ 默认管理员账户创建完成: ${defaultUsername}`);
    console.log('⚠️ 请立即修改默认密码以确保安全！');
  } else {
    console.log('✅ 已存在用户账户，跳过默认管理员创建');
  }
}

async function initSetupState(params: { initialUserCount: number }) {
  const existing = await prisma.systemSetting.findUnique({
    where: { key: 'setup_state' },
    select: { value: true },
  })
  if (existing?.value) {
    return
  }

  const shouldRequire =
    readEnvFlag(process.env.DB_INIT_ON_START) || params.initialUserCount === 0
  if (!shouldRequire) {
    return
  }

  const nowIso = new Date().toISOString()
  await prisma.systemSetting.upsert({
    where: { key: 'setup_state' },
    update: { value: 'required' },
    create: { key: 'setup_state', value: 'required' },
  })
  await prisma.systemSetting.upsert({
    where: { key: 'setup_required_at' },
    update: { value: nowIso },
    create: { key: 'setup_required_at', value: nowIso },
  })
  console.log('✅ 已启用首次启动引导（setup_state=required）')
}

async function createExampleSystemConnection() {
  const connCount = await prisma.connection.count({ where: { ownerUserId: null } })
  if (connCount === 0) {
    const exampleApiKey = process.env.EXAMPLE_SYSTEM_API_KEY;
    const exampleBaseUrl = process.env.EXAMPLE_SYSTEM_API_URL;
    if (exampleBaseUrl) {
      await prisma.connection.create({
        data: {
          ownerUserId: null,
          provider: 'openai',
          baseUrl: exampleBaseUrl.replace(/\/$/, ''),
          enable: true,
          authType: exampleApiKey ? 'bearer' : 'none',
          apiKey: exampleApiKey ? AuthUtils.encryptApiKey(exampleApiKey) : '',
          prefixId: 'example',
          connectionType: 'external',
        },
      })
      console.log('✅ 示例系统连接创建完成')
    } else {
      console.log('ℹ️ 未提供示例连接配置，跳过示例系统连接创建')
    }
  } else {
    console.log('✅ 已存在系统连接，跳过示例创建')
  }
}

async function initBuiltinSkills() {
  const now = new Date()
  const builtinVersion = 'builtin-1.0.0'
  const builtins: Array<{
    slug: string
    displayName: string
    description: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
  }> = [
    {
      slug: 'web-search',
      displayName: 'Web Search',
      description: '内置联网搜索能力',
      riskLevel: 'medium',
      tools: [
        {
          name: 'web_search',
          description: 'Search the web for up-to-date information.',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      ],
    },
    {
      slug: 'python-runner',
      displayName: 'Python Runner',
      description: '内置 Python 执行能力',
      riskLevel: 'high',
      tools: [
        {
          name: 'python_runner',
          description: 'Run deterministic Python snippets.',
          input_schema: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Python source code' },
            },
            required: ['code'],
          },
        },
      ],
    },
    {
      slug: 'url-reader',
      displayName: 'URL Reader',
      description: '内置网页正文读取能力',
      riskLevel: 'medium',
      tools: [
        {
          name: 'read_url',
          description: 'Read and extract text from a URL.',
          input_schema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to read' },
            },
            required: ['url'],
          },
        },
      ],
    },
    {
      slug: 'document-search',
      displayName: 'Document Search',
      description: '会话文档检索能力',
      riskLevel: 'low',
      tools: [
        { name: 'document_list', description: 'List attached documents.', input_schema: { type: 'object', properties: {} } },
        {
          name: 'document_search',
          description: 'Search within attached documents.',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'document_get_content',
          description: 'Get full document content.',
          input_schema: {
            type: 'object',
            properties: { document_id: { type: 'number' } },
            required: ['document_id'],
          },
        },
        {
          name: 'document_get_toc',
          description: 'Get document table of contents.',
          input_schema: {
            type: 'object',
            properties: { document_id: { type: 'number' } },
            required: ['document_id'],
          },
        },
        {
          name: 'document_get_section',
          description: 'Get a section from document.',
          input_schema: {
            type: 'object',
            properties: {
              document_id: { type: 'number' },
              section_id: { type: 'string' },
            },
            required: ['document_id', 'section_id'],
          },
        },
      ],
    },
    {
      slug: 'knowledge-base-search',
      displayName: 'Knowledge Base Search',
      description: '知识库检索能力',
      riskLevel: 'low',
      tools: [
        {
          name: 'kb_search',
          description: 'Search in knowledge bases.',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'kb_get_documents',
          description: 'List knowledge base documents.',
          input_schema: {
            type: 'object',
            properties: { kb_id: { type: 'number' } },
            required: ['kb_id'],
          },
        },
        {
          name: 'kb_get_document_content',
          description: 'Get knowledge base document content.',
          input_schema: {
            type: 'object',
            properties: { document_id: { type: 'number' } },
            required: ['document_id'],
          },
        },
        {
          name: 'kb_get_toc',
          description: 'Get knowledge base document TOC.',
          input_schema: {
            type: 'object',
            properties: { document_id: { type: 'number' } },
            required: ['document_id'],
          },
        },
        {
          name: 'kb_get_section',
          description: 'Get section from knowledge base document.',
          input_schema: {
            type: 'object',
            properties: {
              document_id: { type: 'number' },
              section_id: { type: 'string' },
            },
            required: ['document_id', 'section_id'],
          },
        },
      ],
    },
  ]

  for (const skill of builtins) {
    const manifest = {
      id: skill.slug,
      name: skill.displayName,
      version: builtinVersion,
      entry: 'builtin',
      tools: skill.tools,
      capabilities: ['builtin'],
      runtime: {
        type: 'node',
        command: 'builtin',
        args: [],
        timeout_ms: 30_000,
        max_output_chars: 20_000,
      },
      permissions: [],
      platforms: ['linux', 'windows', 'darwin'],
      risk_level: skill.riskLevel,
    }

    const skillRow = await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: {
        displayName: skill.displayName,
        description: skill.description,
        sourceType: 'builtin',
        sourceUrl: `builtin://${skill.slug}`,
        status: 'active',
      },
      create: {
        slug: skill.slug,
        displayName: skill.displayName,
        description: skill.description,
        sourceType: 'builtin',
        sourceUrl: `builtin://${skill.slug}`,
        status: 'active',
      },
    })

    const versionRow = await prisma.skillVersion.upsert({
      where: {
        skillId_version: {
          skillId: skillRow.id,
          version: builtinVersion,
        },
      },
      update: {
        status: 'active',
        riskLevel: skill.riskLevel,
        entry: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        approvedAt: now,
        activatedAt: now,
      },
      create: {
        skillId: skillRow.id,
        version: builtinVersion,
        status: 'active',
        riskLevel: skill.riskLevel,
        entry: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        packageHash: `builtin:${skill.slug}:${builtinVersion}`,
        sourceRef: 'builtin',
        approvedAt: now,
        activatedAt: now,
      },
    })

    await prisma.skill.update({
      where: { id: skillRow.id },
      data: {
        defaultVersionId: versionRow.id,
        status: 'active',
      },
    })

    await prisma.skillBinding.upsert({
      where: {
        skillId_scopeType_scopeId: {
          skillId: skillRow.id,
          scopeType: 'system',
          scopeId: 'global',
        },
      },
      update: {
        versionId: versionRow.id,
        enabled: true,
        policyJson: '{}',
        overridesJson: '{}',
      },
      create: {
        skillId: skillRow.id,
        versionId: versionRow.id,
        scopeType: 'system',
        scopeId: 'global',
        enabled: true,
        policyJson: '{}',
        overridesJson: '{}',
      },
    })
  }

  console.log('✅ 内置 Skills 初始化完成')
}

// 如果直接运行此脚本（ESM 兼容）
// 兼容 Linux/Windows：使用规范化绝对路径进行比较
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = path.normalize(__filename) === path.normalize(process.argv[1] || '');
if (isDirectRun) {
  // 避免未处理的 Promise 警告
  void initDatabase();
}

export { initDatabase };
