import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { CHAT_IMAGE_PUBLIC_PATH, CHAT_IMAGE_STORAGE_ROOT } from './config/storage';
import { createAppContainer } from './container/app-container';

// 导入路由
import { createAuthApi } from './api/auth';
import { createUsersApi } from './api/users';
import { createSessionsApi } from './api/sessions';
import chat from './api/chat';
import { createSettingsApi } from './api/settings';
import { createConnectionsApi } from './api/connections';
import { createCatalogApi } from './api/catalog';
import { createOpenAICompatApi } from './api/openai-compatible';
import { scheduleModelCatalogAutoRefresh, setModelCatalogTtlSeconds } from './utils/model-catalog';
import { createTaskTraceApi } from './api/task-trace';
import { setChatConfig } from './modules/chat/chat-common';
import { createSharesApi } from './api/shares';
import { createDocumentsApi } from './api/documents';
import { initDocumentServices, setDocumentServices, getDocumentServices } from './services/document-services-factory';

// 导入中间件
import { errorHandler, notFoundHandler } from './middleware/error';

const container = createAppContainer();
const appContext = container.context;
setChatConfig(appContext.config);

// 初始化文档服务（从数据库设置或环境变量读取配置）
async function initializeDocumentServicesFromSettings() {
  try {
    // 从数据库读取 RAG 设置
    const settings = await appContext.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'rag_enabled',
            'rag_embedding_engine',
            'rag_embedding_model',
            'rag_embedding_api_url',
            'rag_top_k',
            'rag_relevance_threshold',
            'rag_max_context_tokens',
            'rag_chunk_size',
            'rag_chunk_overlap',
            'rag_max_file_size_mb',
            'rag_retention_days',
          ],
        },
      },
    });

    const settingsMap = settings.reduce<Record<string, string>>((acc, s) => {
      acc[s.key] = s.value ?? '';
      return acc;
    }, {});

    // 检查是否启用 RAG（数据库设置优先，默认为 false）
    const ragEnabled = settingsMap.rag_enabled?.toLowerCase() === 'true';
    if (!ragEnabled) {
      console.log('ℹ️  Document RAG services disabled (rag_enabled=false in system settings)');
      console.log('   To enable: set rag_enabled=true in system settings');
      return;
    }

    // 从数据库或环境变量获取配置
    const ragEmbeddingEngine = (settingsMap.rag_embedding_engine || process.env.RAG_EMBEDDING_ENGINE || 'openai') as 'openai' | 'ollama';
    const ragEmbeddingModel = settingsMap.rag_embedding_model || process.env.RAG_EMBEDDING_MODEL || (ragEmbeddingEngine === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small');
    const ragEmbeddingApiUrl = settingsMap.rag_embedding_api_url || process.env.RAG_EMBEDDING_API_URL || process.env.OPENAI_API_URL || (ragEmbeddingEngine === 'ollama' ? process.env.OLLAMA_API_URL : undefined);
    const ragApiKey = process.env.OPENAI_API_KEY; // API Key 只从环境变量读取，不存储在数据库

    // 检查是否有必要的配置
    const canInitialize =
      (ragEmbeddingEngine === 'openai' && Boolean(ragApiKey)) ||
      (ragEmbeddingEngine === 'ollama' && Boolean(ragEmbeddingApiUrl));

    if (!canInitialize) {
      console.log('⚠️  Document RAG enabled but missing API configuration');
      console.log(`   Engine: ${ragEmbeddingEngine}`);
      if (ragEmbeddingEngine === 'openai') {
        console.log('   Missing: OPENAI_API_KEY environment variable');
      } else {
        console.log('   Missing: rag_embedding_api_url setting or OLLAMA_API_URL environment variable');
      }
      return;
    }

    const documentServices = initDocumentServices(appContext.prisma, {
      dataDir: './data',
      embedding: {
        engine: ragEmbeddingEngine,
        model: ragEmbeddingModel,
        apiKey: ragApiKey,
        apiUrl: ragEmbeddingApiUrl,
      },
      document: {
        maxFileSize: (parseInt(settingsMap.rag_max_file_size_mb || '50', 10) || 50) * 1024 * 1024,
        chunkSize: parseInt(settingsMap.rag_chunk_size || '1500', 10) || 1500,
        chunkOverlap: parseInt(settingsMap.rag_chunk_overlap || '100', 10) || 100,
        retentionDays: parseInt(settingsMap.rag_retention_days || '30', 10) || 30,
      },
      rag: {
        topK: parseInt(settingsMap.rag_top_k || '5', 10) || 5,
        relevanceThreshold: parseFloat(settingsMap.rag_relevance_threshold || '0.3') || 0.3,
        maxContextTokens: parseInt(settingsMap.rag_max_context_tokens || '4000', 10) || 4000,
      },
    });
    setDocumentServices(documentServices);
    documentServices.cleanupScheduler.start();
    console.log('✅ Document RAG services initialized');
    console.log(`   Engine: ${ragEmbeddingEngine}, Model: ${ragEmbeddingModel}`);
  } catch (error) {
    console.warn('⚠️  Failed to initialize document services:', error instanceof Error ? error.message : error);
  }
}

// 异步初始化 RAG 服务
initializeDocumentServicesFromSettings();

const app = new Hono();

// 基础中间件
app.use('*', logger());

// CORS 开关与来源配置
// ENABLE_CORS: 默认为 true；为 false 时不注册 CORS 中间件
// CORS_ORIGIN: 允许的来源；未设置时默认为 "*"；当为 "*" 时将自动禁用 credentials
const enableCors = appContext.config.server.corsEnabled
const corsOrigin = appContext.config.server.corsOrigin

if (enableCors) {
  app.use('*', cors({
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
    credentials: corsOrigin !== '*',
  }));
} else {
  console.log('⚠️  CORS is disabled by ENABLE_CORS=false')
}

// 静态文件服务（可选）
app.use('/static/*', serveStatic({ root: './public' }));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

app.use(
  `${CHAT_IMAGE_PUBLIC_PATH}/*`,
  serveStatic({
    root: CHAT_IMAGE_STORAGE_ROOT,
    rewriteRequestPath: (path) =>
      path.replace(new RegExp(`^${escapeRegex(CHAT_IMAGE_PUBLIC_PATH)}`), ''),
  }),
);

// API路由
app.route('/api/auth', createAuthApi({ config: appContext.config, authService: container.authService }));
app.route('/api/users', createUsersApi({ userService: container.userService }));
app.route(
  '/api/connections',
  createConnectionsApi({ connectionService: container.connectionService }),
);
app.route('/api/catalog', createCatalogApi({ modelCatalogService: container.modelCatalogService }));
app.route('/api/sessions', createSessionsApi({ sessionService: container.sessionService }));
app.route('/api/chat', chat);
app.route('/api/settings', createSettingsApi({ settingsFacade: container.settingsFacade }));
app.route('/api/task-trace', createTaskTraceApi({
  taskTraceService: container.taskTraceService,
  taskTraceFileService: container.taskTraceFileService,
}));
app.route('/api/shares', createSharesApi({ shareService: container.shareService }));

// 仅在文档服务初始化成功时注册文档路由
const docServices = getDocumentServices();
if (docServices) {
  app.route('/api/documents', createDocumentsApi({
    documentService: docServices.documentService,
    ragService: docServices.ragService,
  }));
}

app.route(
  '/v1',
  createOpenAICompatApi({
    modelResolverService: container.modelResolverService,
  }),
);

// 根路径
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'AI Chat Platform Backend API',
    version: 'v1.1.0',
    docs: '/api/settings/health',
  });
});

// API文档路径
app.get('/api', (c) => {
  return c.json({
    success: true,
    message: 'AI Chat Platform API',
    endpoints: {
      auth: {
        'POST /api/auth/register': '用户注册',
        'POST /api/auth/login': '用户登录',
        'GET /api/auth/me': '获取当前用户信息',
        'PUT /api/auth/password': '修改密码',
      },
      models: {
        'GET /api/catalog/models': '聚合模型列表（连接，含capabilities）',
        'POST /api/catalog/models/refresh': '刷新聚合模型缓存（管理员）',
        'PUT /api/catalog/models/tags': '设置模型标签（管理员，覆盖）',
        'DELETE /api/catalog/models/tags': '批量/全部清除模型覆写（管理员）',
        'GET /api/catalog/models/overrides': '导出所有覆写记录（管理员）',
      },
      connections: {
        'GET /api/connections': '系统连接列表（管理员）',
        'POST /api/connections': '新增系统连接（管理员）',
        'PUT /api/connections/:id': '更新系统连接（管理员）',
        'DELETE /api/connections/:id': '删除系统连接（管理员）',
        'POST /api/connections/verify': '验证连接',
      },
      sessions: {
        'GET /api/sessions': '获取会话列表',
        'POST /api/sessions': '创建新会话',
        'GET /api/sessions/:id': '获取会话详情',
        'PUT /api/sessions/:id': '更新会话标题',
        'DELETE /api/sessions/:id': '删除会话',
        'DELETE /api/sessions/:id/messages': '清空会话消息',
      },
      chat: {
        'GET /api/chat/sessions/:sessionId/messages': '获取会话消息',
        'POST /api/chat/stream': '发送消息（流式响应）',
        'POST /api/chat/completion': '发送消息（非流式响应）',
        'POST /api/chat/stop': '停止生成',
        'POST /api/chat/generate': '统一生成接口（非会话态）',
        'POST /api/chat/regenerate': '重新生成回复',
        'GET /api/chat/usage?sessionId={id}': '查询会话用量聚合',
        'GET /api/chat/sessions/usage': '查询当前用户所有会话用量聚合',
        'GET /api/chat/usage/daily?from&to&sessionId': '按日统计用量（导出报表）',
      },
      settings: {
        'GET /api/settings/system': '获取系统设置（管理员）',
        'PUT /api/settings/system': '更新系统设置（管理员）',
        'GET /api/settings/personal': '获取个人设置',
        'PUT /api/settings/personal': '更新个人设置',
        'GET /api/settings/app-info': '获取应用信息',
        'GET /api/settings/health': '健康检查',
      },
      users: {
        'GET /api/users': '获取用户列表（管理员）',
        'GET /api/users/:id': '获取用户详情（管理员）',
        'PUT /api/users/:id/role': '更新用户角色（管理员）',
        'DELETE /api/users/:id': '删除用户（管理员）',
      },
      ...(getDocumentServices() ? {
        documents: {
          'GET /api/documents/supported-types': '获取支持的文件类型',
          'POST /api/documents/upload': '上传文档',
          'GET /api/documents': '获取文档列表',
          'GET /api/documents/:id': '获取文档详情',
          'DELETE /api/documents/:id': '删除文档',
          'POST /api/documents/:id/attach': '附加文档到会话',
          'DELETE /api/documents/:id/detach/:sessionId': '从会话移除文档',
          'GET /api/documents/session/:sessionId': '获取会话文档列表',
          'POST /api/documents/search': 'RAG 文档搜索',
        },
      } : {}),
    },
  });
});

// 错误处理中间件
app.notFound(notFoundHandler);
app.onError(errorHandler);

setModelCatalogTtlSeconds(appContext.config.modelCatalog.ttlSeconds);
const stopCatalogRefresh = scheduleModelCatalogAutoRefresh({
  refreshIntervalMs: appContext.config.modelCatalog.refreshIntervalMs,
});

// 启动服务器
// 端口解析：优先 PORT，其次兼容 BACKEND_PORT，最后回退 8001（统一本地/容器内行为）
const port = appContext.config.server.port;
// 容器内 HOSTNAME 会被设置为容器ID，若直接绑定会导致仅监听在容器IP，健康检查访问 localhost 失败。
// 因此仅当显式配置 HOST 时才使用，否则回退到 0.0.0.0 （监听全部接口）。
const bindHost = appContext.config.server.host;
const displayHost = appContext.config.server.displayHost;

console.log(`🚀 AI Chat Platform Backend starting on ${displayHost}:${port}`);
console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔗 API Base URL (local): http://localhost:${port}/api`);

serve({
  fetch: app.fetch,
  port,
  hostname: bindHost,
}, (info) => {
  const loggingHost = bindHost === '0.0.0.0' ? '0.0.0.0' : displayHost;
  console.log(`✅ Server is listening on http://${loggingHost}:${info.port}`);
  console.log(`📖 API Documentation: http://localhost:${info.port}/api`);
  console.log(`🏥 Health Check: http://localhost:${info.port}/api/settings/health`);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  try { stopCatalogRefresh(); } catch {}
  try { getDocumentServices()?.cleanupScheduler.stop(); } catch {}
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  try { stopCatalogRefresh(); } catch {}
  try { getDocumentServices()?.cleanupScheduler.stop(); } catch {}
  process.exit(0);
});

// 兜底：捕获未处理错误，避免静默失败
process.on('unhandledRejection', (reason: any, p) => {
  try {
    console.error('[UnhandledRejection]', reason)
  } catch (_) {}
})
process.on('uncaughtException', (err) => {
  try {
    console.error('[UncaughtException]', err)
  } catch (_) {}
})
