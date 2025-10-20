# AI Chat Platform

🚀 **轻量级AI聊天平台** - 基于Hono框架和SQLite数据库的现代化AI聊天解决方案

## 📋 项目概述

本项目旨在开发一款以 **低资源占用、高效性能、易于部署** 为核心目标的现代化AI聊天网页应用，支持接入用户自定义的第三方模型API。

### ✨ 核心特性

- 🏗️ **极轻量架构**: Hono + SQLite，内存占用 < 500MB
- 🔐 **完整认证系统**: JWT认证，支持单用户/多用户模式
- 🤖 **灵活模型接入**: 支持个人和系统级AI模型配置
- 💬 **智能聊天体验**: 基于Token的上下文管理，流式响应
- 🛡️ **安全可靠**: API Key加密存储，权限控制
- 🐳 **一键部署**: Docker Compose，零配置启动

## 🏛️ 技术架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   前端 (Next.js) │    │  后端 (Hono)    │    │  数据库 (SQLite) │
│                 │    │                 │    │                 │
│  • 用户界面      │◄──►│  • RESTful API  │◄──►│  • 用户数据      │
│  • 状态管理      │    │  • JWT认证      │    │  • 聊天记录      │
│  • API客户端     │    │  • 流式响应     │    │  • 系统设置      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │              ┌─────────────────┐
         └──────────────►│  第三方AI模型   │
                        │                 │
                        │  • OpenAI       │
                        │  • Claude       │
                        │  • 自定义模型    │
                        └─────────────────┘
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
- Docker & Docker Compose (推荐)

### 方式一：Docker 部署 (推荐)

```bash
# 克隆项目
git clone https://github.com/your-username/aichat.git
cd aichat

# 一键启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

访问 `http://localhost:3001/api` 查看API文档

### 可配置端口与环境变量（Compose）

为便于在 1Panel 等编排平台自定义端口，compose 已支持通过环境变量覆盖端口和相关配置：

生产环境（docker-compose.yml）

```bash
# 可在同目录 .env 文件或编排面板环境变量中设置
BACKEND_PORT=8001            # 后端对外端口（默认 8001）
FRONTEND_PORT=3000           # 前端对外端口（默认 3000）

# 如使用自定义端口/域名，按需覆盖（默认会随端口联动）
CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}/api
```

开发环境（docker-compose.dev.yml）

```bash
# 可在同目录 .env 文件中设置
DEV_BACKEND_PORT=8001        # 后端开发对外端口（默认 8001）
DEV_FRONTEND_PORT=3000       # 前端开发对外端口（默认 3000）
```

说明与注意事项：
- 仅映射主机端口可变，容器内部仍为 `backend:8001`、`frontend:3000`。
- `CORS_ORIGIN` 应与前端实际访问地址一致（含端口或域名），否则浏览器将被 CORS 拦截。
- `NEXT_PUBLIC_API_URL` 会在前端构建期内嵌，修改该变量需“重建前端镜像”而非仅重启容器。
- 使用反向代理/域名时：
  - 将 `CORS_ORIGIN` 设置为前端外网地址（例 `https://web.example.com`）
  - 将 `NEXT_PUBLIC_API_URL` 设置为后端外网地址（例 `https://api.example.com/api`）

### 方式二：本地开发

```bash
# 安装依赖
pnpm install

# 初始化数据库
pnpm run setup

# 启动开发服务器
pnpm run dev
```

## 📚 API 文档

### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### 模型管理
- `GET /api/models` - 获取模型列表
- `POST /api/models` - 创建个人模型
- `POST /api/models/system` - 创建系统模型 (管理员)

### 聊天功能
- `GET /api/sessions` - 获取会话列表
- `POST /api/sessions` - 创建新会话
- `POST /api/chat/stream` - 发送消息 (流式响应)

详细API文档: [Backend README](./packages/backend/README.md)

## 🗂️ 项目结构

```
aichat/
├── docs/                    # 项目文档
│   ├── prd.md              # 产品需求文档
│   └── Architecture.md     # 架构设计文档
├── packages/               # 应用包
│   └── backend/            # 后端服务
│       ├── src/            # 源代码
│       ├── prisma/         # 数据库配置
│       ├── Dockerfile      # Docker配置
│       └── package.json    # 依赖配置
├── docker-compose.yml      # Docker编排
├── package.json           # 项目配置
└── README.md              # 项目说明
```

## ⚙️ 配置说明

### 环境变量

主要配置文件: `packages/backend/.env`

```env
# 数据库
DATABASE_URL="file:./dev.db"

# JWT密钥 (生产环境请使用强密码)
JWT_SECRET="your-super-secret-jwt-key"

# 应用模式: single (单用户) / multi (多用户)
APP_MODE="single"

# 上下文Token限制
DEFAULT_CONTEXT_TOKEN_LIMIT="4000"

# 默认管理员 (仅在无用户时创建)
DEFAULT_ADMIN_USERNAME="admin"
DEFAULT_ADMIN_PASSWORD="admin123456"
```

### Docker Compose 配置

```yaml
environment:
  - APP_MODE=single                    # 单用户模式
  - JWT_SECRET=your-secret-key         # JWT密钥
  - DEFAULT_ADMIN_USERNAME=admin       # 默认管理员
  - DEFAULT_ADMIN_PASSWORD=admin123456 # 默认密码
  # 可配置端口（见上文）：
  # BACKEND_PORT / FRONTEND_PORT / CORS_ORIGIN / NEXT_PUBLIC_API_URL
```

## 🔧 开发指南

### 本地开发环境

```bash
# 安装依赖
pnpm install

# 数据库初始化
cd packages/backend
pnpm run db:generate
pnpm run db:push

# 启动开发服务器
pnpm run dev
```

### 数据库管理

```bash
# 查看数据库
pnpm run db:studio

# 重置数据库
rm packages/backend/prisma/dev.db
pnpm run db:push
```

### 添加新功能

1. 修改 `packages/backend/prisma/schema.prisma` (如需要)
2. 在 `packages/backend/src/api/` 添加路由
3. 在 `packages/backend/src/types/` 添加类型
4. 运行 `pnpm run db:generate` 更新客户端

## 🐳 Docker 部署

### 生产环境部署

```bash
# 构建并启动
docker-compose -f docker-compose.yml up -d

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f backend
```

### 多用户模式配置

修改 `docker-compose.yml` 中的环境变量:

```yaml
environment:
  - APP_MODE=multi  # 多用户模式
  - JWT_SECRET=your-secure-secret-key
```

## 🔒 安全特性

- **认证授权**: JWT Token认证，角色权限控制
- **密码安全**: bcrypt哈希存储
- **API密钥加密**: AES加密存储第三方API密钥
- **输入验证**: Zod schema验证
- **CORS保护**: 跨域请求控制

## 📊 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 内存占用 | < 500MB | 后端服务峰值内存使用 |
| API响应时间 | < 100ms | 应用自身API处理耗时 |
| 数据库查询 | < 50ms | SQLite查询性能 |
| 并发支持 | 100+ | 同时在线用户数 |

## 🛣️ 发展路线

### v1.1 (计划中)
- [ ] 前端界面开发
- [ ] 文件上传支持
- [ ] 聊天导出功能
- [ ] 多主题支持

### v2.0 (未来规划)
- [ ] 长期记忆功能 (向量数据库)
- [ ] 多模态支持 (图片输入)
- [ ] 插件系统
- [ ] 分布式部署支持

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 支持

- 📧 邮箱: support@aichat.com
- 🐛 问题反馈: [GitHub Issues](https://github.com/your-username/aichat/issues)
- 📖 文档: [项目Wiki](https://github.com/your-username/aichat/wiki)

---

⭐ 如果这个项目对你有帮助，请给它一个星标！
