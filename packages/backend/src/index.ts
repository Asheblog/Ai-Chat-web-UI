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
import { createChatApi } from './api/chat';
import { createSettingsApi } from './api/settings';
import { createConnectionsApi } from './api/connections';
import { createCatalogApi } from './api/catalog';
import { createOpenAICompatApi } from './api/openai-compatible';
import { scheduleModelCatalogAutoRefresh, setModelCatalogTtlSeconds } from './utils/model-catalog';
import { createTaskTraceApi } from './api/task-trace';
import { setChatConfig } from './modules/chat/chat-common';
import { createSharesApi } from './api/shares';
import { createBattleApi } from './api/battle';
import { createDocumentsApi } from './api/documents';
import { createKnowledgeBasesApi } from './api/knowledge-bases';
import { getDocumentServices } from './services/document-services-factory';
import { setRAGInitializerDeps, reloadRAGServices } from './services/rag-initializer';
import { createSystemLogsApi } from './api/system-logs';
import { createSkillsApi } from './api/skills';
import { createArtifactsApi } from './api/artifacts';
import { createPromptTemplatesApi } from './api/prompt-templates';
import { SkillInstaller } from './modules/skills/skill-installer';
import { SkillApprovalService } from './modules/skills/skill-approval-service';
import { ChatMessageQueryService } from './modules/chat/services/message-query-service';
import { ConversationCompressionService } from './modules/chat/services/conversation-compression-service';
import { NonStreamChatService } from './modules/chat/services/non-stream-chat-service';
import { TitleSummaryService } from './modules/chat/services/title-summary-service';
import { ChatRequestBuilder } from './modules/chat/services/chat-request-builder';
import { ReasoningCompatibilityService } from './modules/chat/services/reasoning-compatibility-service';
import { ProviderRequester } from './modules/chat/services/provider-requester';
import { NonStreamFallbackService } from './modules/chat/services/non-stream-fallback-service';
import { AssistantProgressService } from './modules/chat/services/assistant-progress-service';
import { StreamUsageService } from './modules/chat/services/stream-usage-service';
import { StreamTraceService } from './modules/chat/services/stream-trace-service';
import { StreamSseService } from './modules/chat/services/stream-sse-service';

// 导入中间件
import { errorHandler, notFoundHandler } from './middleware/error';

const container = createAppContainer();
const appContext = container.context;
setChatConfig(appContext.config);

// 设置 RAG 初始化器依赖并启动
setRAGInitializerDeps({ prisma: appContext.prisma });
reloadRAGServices();
const skillInstaller = new SkillInstaller({ prisma: appContext.prisma });
const skillApprovalService = new SkillApprovalService({ prisma: appContext.prisma });
const providerRequester = new ProviderRequester();
const chatRequestBuilder = new ChatRequestBuilder({ prisma: appContext.prisma });
const nonStreamFallbackService = new NonStreamFallbackService();
const assistantProgressService = new AssistantProgressService({ prisma: appContext.prisma });
const streamUsageService = new StreamUsageService();
const streamTraceService = new StreamTraceService();
const streamSseService = new StreamSseService();
const reasoningCompatibilityService = new ReasoningCompatibilityService({ prisma: appContext.prisma });
const conversationCompressionService = new ConversationCompressionService({ prisma: appContext.prisma });
const chatMessageQueryService = new ChatMessageQueryService({ prisma: appContext.prisma });
const nonStreamChatService = new NonStreamChatService({
  prisma: appContext.prisma,
  requestBuilder: chatRequestBuilder,
  requester: providerRequester,
});
const titleSummaryService = new TitleSummaryService({ prisma: appContext.prisma });

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
    onFound: (servedPath, c) => {
      // 头像文件名为时间戳+UUID，内容更新会更换路径，可安全使用 immutable 缓存。
      const normalized = servedPath.replace(/\\/g, '/')
      if (/(^|\/)profiles\//.test(normalized)) {
        c.header('Cache-Control', 'public, max-age=604800, immutable')
      }
    },
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
app.route('/api/chat', createChatApi({
  messageRoutes: {
    prisma: appContext.prisma,
    chatService: container.chatService,
    chatMessageQueryService,
  },
  compressionRoutes: {
    chatService: container.chatService,
    conversationCompressionService,
  },
  attachmentRoutes: {
    prisma: appContext.prisma,
  },
  streamRoutes: {
    prisma: appContext.prisma,
    chatService: container.chatService,
    chatRequestBuilder,
    reasoningCompatibilityService,
    providerRequester,
    nonStreamFallbackService,
    assistantProgressService,
    streamUsageService,
    streamTraceService,
    streamSseService,
    conversationCompressionService,
  },
  completionRoutes: {
    prisma: appContext.prisma,
    nonStreamService: nonStreamChatService,
    conversationCompressionService,
  },
  controlRoutes: {
    prisma: appContext.prisma,
  },
  usageRoutes: {
    prisma: appContext.prisma,
    chatService: container.chatService,
  },
  titleSummaryRoutes: {
    prisma: appContext.prisma,
    service: titleSummaryService,
    settingsService: container.settingsService,
  },
  workspaceRoutes: {
    prisma: appContext.prisma,
    chatService: container.chatService,
    artifactService: container.artifactService,
    workspaceService: container.workspaceService,
  },
}));
app.route('/api/settings', createSettingsApi({
  settingsFacade: container.settingsFacade,
  pythonRuntimeService: container.pythonRuntimeService,
}));
app.route('/api/task-trace', createTaskTraceApi({
  taskTraceService: container.taskTraceService,
  taskTraceFileService: container.taskTraceFileService,
}));
app.route('/api/shares', createSharesApi({ shareService: container.shareService }));
app.route('/api/battle', createBattleApi({ battleService: container.battleService }));

// 文档路由（RAG 服务状态在请求时动态检查）
app.route('/api/documents', createDocumentsApi({
  resolveServices: () => {
    const services = getDocumentServices();
    if (!services) return null;
    return {
      documentService: services.documentService,
      ragService: services.ragService,
    };
  },
}));

// 知识库路由
app.route('/api/knowledge-bases', createKnowledgeBasesApi(appContext.prisma));

// 系统日志路由
app.route('/api/system-logs', createSystemLogsApi({ systemLogService: container.systemLogService }));
app.route('/api/skills', createSkillsApi({
  prisma: appContext.prisma,
  skillInstaller,
  skillApprovalService,
  pythonRuntimeService: container.pythonRuntimeService,
}));
app.route('/api/artifacts', createArtifactsApi({ artifactService: container.artifactService }));
app.route('/api/prompt-templates', createPromptTemplatesApi({ promptTemplateService: container.promptTemplateService }));

app.route(
  '/v1',
  createOpenAICompatApi({
    modelResolverService: container.modelResolverService,
    messageService: container.openaiCompatMessageService,
  }),
);

// 根路径
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'AI Chat Platform Backend API',
    version: 'v2.1.0',
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
      promptTemplates: {
        'GET /api/prompt-templates': '获取当前用户提示词模板',
        'POST /api/prompt-templates': '创建提示词模板',
        'PUT /api/prompt-templates/:id': '更新提示词模板',
        'DELETE /api/prompt-templates/:id': '删除提示词模板',
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
        'GET /api/chat/sessions/:sessionId/artifacts?messageId=': '列出会话产物',
        'DELETE /api/chat/sessions/:sessionId/workspace': '销毁会话 workspace',
      },
      artifacts: {
        'GET /api/artifacts/:id/download?exp=&sig=': '下载会话产物（带签名与过期校验）',
      },
      settings: {
        'GET /api/settings/system': '获取系统设置（管理员）',
        'PUT /api/settings/system': '更新系统设置（管理员）',
        'GET /api/settings/personal': '获取个人设置',
        'PUT /api/settings/personal': '更新个人设置',
        'GET /api/settings/setup-status': '获取初始化向导状态',
        'POST /api/settings/setup-state': '更新初始化向导状态（管理员）',
        'GET /api/settings/python-runtime': '获取受管 Python 运行环境状态（管理员）',
        'PUT /api/settings/python-runtime/indexes': '更新 Python 索引配置（管理员）',
        'POST /api/settings/python-runtime/install': '安装 Python 依赖（管理员）',
        'POST /api/settings/python-runtime/uninstall': '卸载 Python 包（管理员）',
        'POST /api/settings/python-runtime/reconcile': '按激活 Skill 依赖校验 Python 环境（管理员）',
        'GET /api/settings/app-info': '获取应用信息',
        'GET /api/settings/health': '健康检查',
      },
      users: {
        'GET /api/users': '获取用户列表（管理员）',
        'GET /api/users/:id': '获取用户详情（管理员）',
        'PUT /api/users/:id/role': '更新用户角色（管理员）',
        'DELETE /api/users/:id': '删除用户（管理员）',
      },
      documents: {
        'GET /api/documents/supported-types': '获取支持的文件类型',
        'POST /api/documents/upload': '上传文档（需开启RAG）',
        'GET /api/documents': '获取文档列表（需开启RAG）',
        'GET /api/documents/:id': '获取文档详情（需开启RAG）',
        'DELETE /api/documents/:id': '删除文档（需开启RAG）',
        'POST /api/documents/:id/attach': '附加文档到会话（需开启RAG）',
        'DELETE /api/documents/:id/detach/:sessionId': '从会话移除文档（需开启RAG）',
        'GET /api/documents/session/:sessionId': '获取会话文档列表（需开启RAG）',
        'POST /api/documents/search': 'RAG 文档搜索（需开启RAG）',
      },
      battle: {
        'POST /api/battle/stream': '执行模型大乱斗（SSE）',
        'GET /api/battle/runs': '获取乱斗历史列表',
        'GET /api/battle/runs/:id': '获取乱斗详情',
        'DELETE /api/battle/runs/:id': '删除乱斗记录',
        'POST /api/battle/runs/:id/cancel': '取消乱斗执行',
        'POST /api/battle/runs/:id/attempts/cancel': '取消单次模型尝试',
        'POST /api/battle/runs/:id/attempts/retry': '重试单次模型尝试',
        'POST /api/battle/runs/:id/share': '创建乱斗分享',
        'GET /api/battle/shares/:token': '查看乱斗分享',
      },
      skills: {
        'GET /api/skills/catalog': 'Skill 目录',
        'POST /api/skills/install': '从 GitHub 安装 Skill（管理员）',
        'GET /api/skills/:skillId/uninstall-plan': '预览卸载 Skill 的 Python 依赖回收计划（管理员）',
        'DELETE /api/skills/:skillId': '卸载 Skill 并自动回收可移除 Python 依赖（管理员）',
        'POST /api/skills/:skillId/versions/:versionId/approve': '审批 Skill 版本（管理员）',
        'POST /api/skills/:skillId/versions/:versionId/activate': '激活 Skill 版本（管理员）',
        'POST /api/skills/bindings': '创建/更新 Skill 绑定（管理员）',
        'GET /api/skills/bindings': '查询 Skill 绑定',
        'DELETE /api/skills/bindings/:bindingId': '删除 Skill 绑定（管理员）',
        'POST /api/skills/approvals/:requestId/respond': '响应 Skill 审批请求（管理员）',
      },
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
container.workspaceCleanupService.start();

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
  try { container.workspaceCleanupService.stop(); } catch {}
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  try { stopCatalogRefresh(); } catch {}
  try { getDocumentServices()?.cleanupScheduler.stop(); } catch {}
  try { container.workspaceCleanupService.stop(); } catch {}
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
