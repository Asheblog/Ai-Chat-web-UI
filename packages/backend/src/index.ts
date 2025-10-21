import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

// 导入路由
import auth from './api/auth';
import users from './api/users';
import models from './api/models';
import sessions from './api/sessions';
import chat from './api/chat';
import settings from './api/settings';

// 导入中间件
import { errorHandler, notFoundHandler } from './middleware/error';

const app = new Hono();

// 基础中间件
app.use('*', logger());

// CORS 开关与来源配置
// ENABLE_CORS: 默认为 true；为 false 时不注册 CORS 中间件
// CORS_ORIGIN: 允许的来源；未设置时默认为 "*"；当为 "*" 时将自动禁用 credentials
const enableCors = (process.env.ENABLE_CORS ?? 'true').toLowerCase() === 'true'
const corsOrigin = process.env.CORS_ORIGIN || '*'

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

// API路由
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/models', models);
app.route('/api/sessions', sessions);
app.route('/api/chat', chat);
app.route('/api/settings', settings);

// 根路径
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'AI Chat Platform Backend API',
    version: '1.0.0',
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
        'GET /api/models': '获取模型配置列表',
        'POST /api/models': '创建个人模型配置',
        'GET /api/models/:id': '获取模型配置详情',
        'PUT /api/models/:id': '更新模型配置',
        'DELETE /api/models/:id': '删除模型配置',
        'POST /api/models/system': '创建系统模型配置（管理员）',
        'GET /api/models/system/list': '获取系统模型列表（管理员）',
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
        'POST /api/chat/stop': '停止生成',
        'POST /api/chat/regenerate': '重新生成回复',
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
    },
  });
});

// 错误处理中间件
app.notFound(notFoundHandler);
app.onError(errorHandler);

// 启动服务器
// 端口解析：优先 PORT，其次兼容 BACKEND_PORT，最后回退 8001（统一本地/容器内行为）
const port = parseInt(process.env.PORT || process.env.BACKEND_PORT || '8001');
const hostname = process.env.HOST || process.env.HOSTNAME || '0.0.0.0';

console.log(`🚀 AI Chat Platform Backend starting on ${hostname}:${port}`);
console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔗 API Base URL (local): http://localhost:${port}/api`);

serve({
  fetch: app.fetch,
  port,
  hostname,
}, (info) => {
  const displayedHost = hostname === '0.0.0.0' ? '0.0.0.0' : hostname;
  console.log(`✅ Server is listening on http://${displayedHost}:${info.port} (bind all interfaces if 0.0.0.0)`);
  console.log(`📖 API Documentation: http://localhost:${info.port}/api`);
  console.log(`🏥 Health Check: http://localhost:${info.port}/api/settings/health`);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  process.exit(0);
});
