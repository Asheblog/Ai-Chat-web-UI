# AI Chat 聊天平台

轻量级 AI 聊天平台，后端基于 Hono + SQLite，前端基于 Next.js 14。

🌐 示例网站：https://aichat.asheblog.org

---

## 📖 项目简介

AI Chat 是一个支持多模型接入的现代化 AI 聊天平台，具备完整的用户管理、会话管理、实时流式对话等功能。项目采用 monorepo 架构，前后端分离部署，支持 Docker 容器化部署。

---

## ✨ 主要功能

| 功能模块 | 说明 |
| --- | --- |
| **流式聊天** | SSE 实时对话、Markdown 渲染、代码高亮、LaTeX 公式、图片上传 |
| **多模型接入** | 支持 OpenAI、Azure OpenAI、Ollama、Google Generative AI 等多种 AI 服务 |
| **会话管理** | 多会话、会话置顶、会话分享、历史消息、消息重试 |
| **用户系统** | 注册审批、角色管理（管理员/用户）、匿名访客支持、每日配额 |
| **知识库** | 文档上传解析、RAG 检索增强生成（开发中） |
| **Skill 插件系统** | 统一 `skills` 协议、GitHub Skill 安装、审批/激活/绑定、调用审计 |
| **模型大乱斗** | 多模型同时对比评测、自动评分 |
| **任务追踪** | 全链路请求追踪、工具调用日志、导出功能 |
| **系统设置** | 品牌定制、连接管理、模型配置、配额管理 |

---

## 🔧 Skill 系统与协议说明（无向后兼容）

- 聊天与 Battle 已从 `features` 切换为 `skills` 请求结构。
- 旧 `features` 请求体会被后端直接拒绝，并返回升级提示。
- 新请求字段：
  - `skills.enabled: string[]`
  - `skills.overrides?: Record<string, Record<string, unknown>>`
- Skill 后端管理 API：
  - `GET /api/skills/catalog`
  - `POST /api/skills/install`
  - `POST /api/skills/:skillId/versions/:versionId/approve`
  - `POST /api/skills/:skillId/versions/:versionId/activate`
  - `POST /api/skills/bindings`
  - `GET /api/skills/bindings`
  - `DELETE /api/skills/bindings/:bindingId`
  - `GET /api/skills/approvals`
  - `POST /api/skills/approvals/:requestId/respond`

---

## 📁 项目结构

```
aichat/
├── packages/
│   ├── backend/                 # 后端 (Hono + Prisma + SQLite)
│   │   ├── src/
│   │   │   ├── api/             # API 路由
│   │   │   ├── modules/         # 业务模块
│   │   │   ├── services/        # 服务层
│   │   │   ├── middleware/      # 中间件
│   │   │   └── utils/           # 工具函数
│   │   ├── prisma/              # 数据库 Schema
│   │   └── Dockerfile
│   ├── frontend/                # 前端 (Next.js 14)
│   │   ├── src/
│   │   │   ├── app/             # 页面路由
│   │   │   ├── components/      # UI 组件
│   │   │   ├── features/        # 功能模块
│   │   │   ├── lib/             # 工具库
│   │   │   └── store/           # 状态管理
│   │   └── Dockerfile
│   └── shared/                  # 共享代码
├── docker-compose.yml           # 生产部署 Compose
├── docker-compose.dev.yml       # 开发环境 Compose
├── scripts/                     # 辅助脚本
├── docs/                        # 项目文档
└── start.sh / start.bat         # 快速启动脚本
```

---

## 🚀 部署方式

### 方式一：Docker Compose 部署（推荐）

**前提条件**
- 已安装 Docker 和 Docker Compose
- 镜像已推送到 GHCR：
  - 后端：`ghcr.io/asheblog/aichat-backend:latest`
  - 前端：`ghcr.io/asheblog/aichat-frontend:latest`

**部署步骤**

1. 创建 `docker-compose.yml` 文件（或使用 1Panel 编排）：

```yaml
version: '3.8'

services:
  backend:
    image: ghcr.io/asheblog/aichat-backend:latest
    container_name: ai-chat-backend
    environment:
      - NODE_ENV=production
      - PORT=8001
      - DATABASE_URL=file:/app/data/app.db
      - JWT_SECRET=请改成强随机密码
      - ENCRYPTION_KEY=请改成强随机密码
      - CORS_ORIGIN=http://你的IP或域名:3555
      - DB_INIT_ON_START=true  # 首次部署后改为 false
    volumes:
      - backend_data:/app/data
      - backend_logs:/app/logs
      - backend_images:/app/storage/chat-images
    ports:
      - "3556:8001"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8001/api/settings/health > /dev/null || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - ai-chat-network

  frontend:
    image: ghcr.io/asheblog/aichat-frontend:latest
    container_name: ai-chat-frontend
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=/api
      - BACKEND_HOST=backend
      - BACKEND_INTERNAL_PORT=8001
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "3555:3000"
    restart: unless-stopped
    networks:
      - ai-chat-network

volumes:
  backend_data:
  backend_logs:
  backend_images:

networks:
  ai-chat-network:
    driver: bridge
```

2. 启动服务：
```bash
docker-compose up -d
```

3. 访问 `http://你的IP或域名:3555`，注册第一个账号（自动成为管理员）

**关键配置说明**

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | JWT 签名密钥，务必设置为 32 位以上强密码 |
| `ENCRYPTION_KEY` | API Key 加密密钥，修改后需重新填写连接密钥 |
| `CORS_ORIGIN` | 前端访问地址（含协议+端口） |
| `DB_INIT_ON_START` | 首次部署设为 `true`，完成后改为 `false` |

**健康检查**
- 前端：`http://你的IP或域名:3555/api/health`
- 后端：`http://你的IP或域名:3556/api/settings/health`

**版本更新**
- 拉取最新镜像后重启容器即可
- 如涉及数据库更新，请参阅 [CHANGELOG.md](./CHANGELOG.md)

---

### 方式二：本地运行（开发环境）

**前提条件**
- Node.js ≥ 18
- pnpm ≥ 8

**运行步骤**

1. 安装依赖：
```bash
pnpm install
```

2. 复制环境变量配置：
```bash
cp .env.example .env
```

3. 初始化数据库：
```bash
pnpm --filter backend db:push
```

4. 启动开发服务：
```bash
# 开发模式（热更新）
npm run start:dev

# 生产模式
npm run start:prod
```

5. 访问 `http://localhost:3000`

---

## 🖼️ 示例截图

<img width="1920" alt="聊天界面" src="https://github.com/user-attachments/assets/26757bae-78de-4cf4-9e6a-584c4b2101db" />
<img width="1920" alt="设置界面" src="https://github.com/user-attachments/assets/48179c04-afda-46e4-b74f-ffd29431934d" />
<img width="1920" alt="模型管理" src="https://github.com/user-attachments/assets/13d407f8-40df-4fb4-9140-af068a2cd850" />

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

```
MIT License

Copyright (c) 2025 PanXmad

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
