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

### 会话管理

- `GET /api/sessions` - 获取会话列表
- `POST /api/sessions` - 创建新会话
- `GET /api/sessions/:id` - 获取会话详情
- `PUT /api/sessions/:id` - 更新会话标题
- `DELETE /api/sessions/:id` - 删除会话

### 聊天功能

- `POST /api/chat/stream` - 发送消息 (流式响应)
- `POST /api/chat/completion` - 发送消息 (非流式响应)
- `POST /api/chat/stop` - 停止生成
- `POST /api/chat/regenerate` - 重新生成回复

#### 用量聚合查询

- `GET /api/chat/usage?sessionId={id}` - 返回会话维度的用量统计：
  - `totals`: 累计 `prompt_tokens/completion_tokens/total_tokens`
  - `last_round`: 最近一轮用量（若存在），含 `prompt_tokens/completion_tokens/total_tokens/context_limit/createdAt/model/provider`
  - `current`: 即时上下文占用（估算）`prompt_tokens/context_limit/context_remaining`

#### 流式响应（SSE）事件类型

服务端通过 `text/event-stream` 推送以下事件：

- `start`：开始生成，包含 `messageId`
- `content`：增量内容片段（delta）
- `usage`：用量统计事件（OpenAI 兼容字段）。示例：
  - `{ "type": "usage", "usage": { "prompt_tokens": 123, "completion_tokens": 45, "total_tokens": 168, "context_limit": 4000, "context_remaining": 3877 } }`
  - 若上游厂商在流中返回 `usage` 字段，会被原样透出；否则在开始时发送一次基于上下文估算的 `usage`，在结束前补齐 `completion_tokens` 与 `total_tokens`（估算）。
- `reasoning`：推理链事件，包含 `content`（增量文本）、`done`（推理结束）、`duration`（秒），以及 `keepalive`（仅保活提示，表示模型仍在思考，可配合 `idle_ms` 展示静默时长）。
- `tool_call`：工具调用事件。统一输出 `callId/identifier/apiName/source/phase/status`，同时保留 `id/tool/stage` 兼容字段用于历史渲染。
- `end`：上游流结束（如收到 `[DONE]`）
- `complete`：服务端完成收尾
- `stop`：可选的结束原因（如 `finish_reason`）

#### 网络稳定性与降级

- 心跳保活：服务端每隔固定时间（默认 15s）推送 `: ping` 注释帧，避免代理空闲断开。
- 上游退避：
  - 429 → 退避 15s 后重试 1 次
  - 5xx/超时 → 退避 2s 后重试 1 次
- 推理空闲策略：首次收到增量前遵循“初始宽限”（默认 120s），之后采用“推理阶段最大静默”（默认 300s）。在静默超过可配置阈值时发送保活提示事件，并在超过上限后才主动中止。
- 自动降级：流式失败且尚未输出内容时，会自动改走一次非流式请求并返回完整文本。

可配置环境变量：

- `SSE_HEARTBEAT_INTERVAL_MS`（默认 15000）SSE 心跳间隔（毫秒）
- `PROVIDER_MAX_IDLE_MS`（默认 60000）兼容旧行为的退避阈值（系统设置中更细粒度配置会覆盖）
- `PROVIDER_TIMEOUT_MS`（默认 300000）上游请求总体超时（毫秒）
- `PROVIDER_INITIAL_GRACE_MS`（默认 120000）首个增量到达的最长宽限时间（毫秒）
- `PROVIDER_REASONING_IDLE_MS`（默认 300000）推理阶段允许的最大静默（毫秒）
- `REASONING_KEEPALIVE_INTERVAL_MS`（默认 0，禁用）推理静默阶段多久发送一次保活提示（毫秒）

#### Usage 统计与环境变量

- 统计逻辑
  - `prompt_tokens`：基于 `Tokenizer.countConversationTokens` 对本轮上下文（历史+当前）进行估算；
  - `completion_tokens`：基于 `Tokenizer.countTokens` 对生成结果进行估算；
  - 当上游厂商在流式数据中提供 `usage` 字段时，服务端会优先透传厂商统计结果。

- 环境变量
  - `USAGE_EMIT`（默认 `true`）：是否发送 `usage` 事件；
  - `USAGE_PROVIDER_ONLY`（默认 `false`）：是否仅透传厂商 `usage`（不发送本地估算）。
  - `TOKENIZER_MODE`（`precise`|`heuristic`，默认 `precise`）：是否启用精确分词（依赖 `gpt-tokenizer`），失败或关闭时回退启发式估算。

> 注意：估算方法为启发式，中文/多模态存在偏差；需高精度可接入模型对应分词器并替换 `Tokenizer` 实现。

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
# 在仓库根目录构建（context 必须是 monorepo 根）
# 生产镜像会安装与 playwright-core 匹配的 Chromium（PLAYWRIGHT_BROWSERS_PATH=/ms-playwright）
docker build -f packages/backend/Dockerfile --target production -t aichat-backend:local .

# 开发阶段镜像
docker build -f packages/backend/Dockerfile --target development -t aichat-backend:dev .
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
