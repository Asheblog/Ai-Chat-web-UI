# AI Chat Platform Backend

基于 Hono 框架的轻量级 AI 聊天平台后端服务。

## 技术栈

- **框架**: Hono (Node.js)
- **语言**: TypeScript
- **数据库**: SQLite3 + Prisma ORM
- **认证**: JWT (JSON Web Token)
- **加密**: bcryptjs (密码) + crypto-js (API Key)

## 功能特性

### 🔐 用户认证
- JWT 无状态认证
- 密码安全哈希存储
- 支持单用户/多用户模式
- 角色权限管理 (ADMIN/USER)

### 🤖 模型管理
- 个人模型配置
- 系统模型配置 (管理员)
- API Key 加密存储
- 模型权限控制

### 💬 聊天功能
- 会话管理
- 消息历史记录
- 基于Token的上下文管理
- 流式响应 (SSE)
- 第三方AI模型代理

### ⚙️ 系统设置
- 系统设置管理 (管理员)
- 个人设置配置
- 健康检查接口
- 应用信息查询

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 环境配置（集中化）

推荐使用仓库根目录的环境文件集中管理：

- 复制根模板：`cp .env.example .env`（在仓库根目录）
- 通过 `docker-compose.dev.yml` / `docker-compose.yml` 启动时会自动读取根 `.env`

如需“单独在此目录开发后端且不通过 docker-compose 启动”，可以在本目录创建 `.env` 临时覆盖少量变量（可选）。
与跨域相关的变量：
- `ENABLE_CORS`（默认 `true`，设为 `false` 将完全关闭 CORS 中间件）
- `CORS_ORIGIN`（允许的前端地址；为空时为 `*`，此时自动禁用 credentials）
否则请不要在包内维护独立的 `.env`，以避免配置漂移。

### 数据库初始化

```bash
# 生成 Prisma 客户端
npm run db:generate

# 推送数据库架构
npm run db:push

# (可选) 查看数据库
npm run db:studio
```

### 启动开发服务器

```bash
npm run dev
```

服务器将在 `http://localhost:3001` 启动。

## API 文档

### 认证接口

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息
- `PUT /api/auth/password` - 修改密码

### 模型管理

- `GET /api/models` - 获取模型配置列表
- `POST /api/models` - 创建个人模型配置
- `GET /api/models/:id` - 获取模型配置详情
- `PUT /api/models/:id` - 更新模型配置
- `DELETE /api/models/:id` - 删除模型配置
- `POST /api/models/system` - 创建系统模型配置 (管理员)

### 会话管理

- `GET /api/sessions` - 获取会话列表
- `POST /api/sessions` - 创建新会话
- `GET /api/sessions/:id` - 获取会话详情
- `PUT /api/sessions/:id` - 更新会话标题
- `DELETE /api/sessions/:id` - 删除会话

### 聊天功能

- `POST /api/chat/stream` - 发送消息 (流式响应)
- `POST /api/chat/stop` - 停止生成
- `POST /api/chat/regenerate` - 重新生成回复

### 系统设置

- `GET /api/settings/system` - 获取系统设置 (管理员)
- `PUT /api/settings/system` - 更新系统设置 (管理员)
- `GET /api/settings/personal` - 获取个人设置
- `GET /api/settings/health` - 健康检查

## 项目结构

```
src/
├── api/           # API 路由
│   ├── auth.ts    # 认证相关
│   ├── users.ts   # 用户管理
│   ├── models.ts  # 模型配置
│   ├── sessions.ts # 会话管理
│   ├── chat.ts    # 聊天功能
│   └── settings.ts # 系统设置
├── db/            # 数据库
│   └── index.ts   # Prisma 客户端
├── middleware/    # 中间件
│   ├── auth.ts    # 认证中间件
│   └── error.ts   # 错误处理
├── utils/         # 工具函数
│   ├── auth.ts    # 认证工具
│   └── tokenizer.ts # Token 计算器
├── types/         # 类型定义
│   └── index.ts
└── index.ts       # 应用入口
```

## Docker 部署

### 构建镜像

```bash
# 生产环境构建
docker build -t aichat-backend .

# 开发环境构建
docker build --target development -t aichat-backend:dev .
```

### 运行容器

```bash
# 生产环境
docker run -d \
  --name aichat-backend \
  -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  aichat-backend

# 开发环境
docker run -it \
  --name aichat-backend-dev \
  -p 3001:3001 \
  -v $(pwd):/app \
  --env-file .env \
  aichat-backend:dev
```

## 开发指南

### 添加新的API端点

1. 在 `src/api/` 目录下创建新的路由文件
2. 在 `src/index.ts` 中注册路由
3. 在 `src/types/index.ts` 中添加相关类型定义
4. 编写测试用例

### 数据库变更

1. 修改 `prisma/schema.prisma`
2. 运行 `npm run db:generate` 更新客户端
3. 运行 `npm run db:push` 应用变更
4. （可选）创建迁移文件 `npm run db:migrate`

### 错误处理

所有API都遵循统一的错误响应格式：

```json
{
  "success": false,
  "error": "错误信息",
  "data": null
}
```

## 性能优化

- **内存占用**: 设计目标 < 500MB
- **响应时间**: API 处理时间 < 100ms
- **数据库**: 使用 SQLite3，零配置
- **并发处理**: 支持 SSE 流式响应

## 安全特性

- JWT Token 认证
- 密码 bcrypt 哈希
- API Key AES 加密存储
- CORS 跨域保护
- 输入验证和清理
- SQL 注入防护 (Prisma ORM)

## 许可证

MIT License
