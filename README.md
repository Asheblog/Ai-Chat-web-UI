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

## 🔧 Skill 功能使用说明（无向后兼容）

### 1. 协议变更（必须）

- 聊天与 Battle 已从 `features` 完全切换为 `skills`。
- 旧字段 `features` 会被后端直接拒绝，并返回升级提示。
- 新字段结构：
  - `skills.enabled: string[]`
  - `skills.overrides?: Record<string, Record<string, unknown>>`

### 2. 内置预设与第三方 Skill

当前 UI 已分为两类：

- `内置预设`（系统内置能力）
  - 联网搜索（slug: `web-search`，tool: `web_search`）
  - Python 工具（slug: `python-runner`，tool: `python_runner`）
  - 网页读取（slug: `url-reader`，tool: `read_url`）
  - 会话文档检索（slug: `document-search`）
  - 知识库检索（slug: `knowledge-base-search`）
- `第三方安装`（从 GitHub 安装后显示）

UI 展示为中文描述，但底层仍使用稳定的 slug/tool 名，便于 API 与审计对齐。

### 3. 聊天中如何使用 Skill

1. 在输入框左侧 `+` 菜单点击“打开技能面板”。
2. 在“内置预设”中打开联网搜索/Python工具，或打开已安装的第三方技能。
3. 发送消息后，模型会按需调用 Skill；工具时间线可看到调用过程。
4. 高风险 Skill 会触发审批弹窗（管理员批准后继续）。

### 4. Battle 中如何使用 Skill

1. 在 Battle 模型配置中为每个模型单独配置 `skills.enabled`。
2. 同一场 Battle 的不同模型可启用不同 Skill 组合。
3. 审批策略与审计记录与聊天侧共享同一套 Skill 运行时。

### 5. 管理员如何安装第三方 Skill（GitHub）

进入“系统设置 -> Skill 管理”：

1. 在安装输入框填 GitHub 源：
   - `owner/repo@ref`
   - `owner/repo@ref:subdir`
2. 点击安装后，系统会执行：
   - 拉取并解压 -> manifest 校验 -> 风险分级 -> 入库
3. 对 `pending_approval` 版本先审批，再激活。
4. 在“绑定管理”中绑定作用域（`system/user/session/battle_model`）。
5. 支持卸载第三方 Skill：卸载后会自动尝试回收仅由该 Skill 使用、且未被其他激活 Skill/手动保留依赖占用的 Python 包。

### 6. 审批与审计

- 审批队列：`GET /api/skills/approvals`
- 审批响应：`POST /api/skills/approvals/:requestId/respond`
- 审计查询：`GET /api/skills/audits`

内置/第三方 Skill 调用都会写入审计日志（请求摘要、输出摘要、耗时、审批结果、错误等）。

### 7. API 示例

聊天请求：

```json
{
  "sessionId": 1,
  "content": "请联网搜索今天的 NVIDIA 新闻并做汇总",
  "skills": {
    "enabled": ["web-search", "url-reader", "python-runner"],
    "overrides": {
      "web-search": {
        "scope": "webpage"
      }
    }
  }
}
```

Battle 模型配置片段：

```json
{
  "models": [
    {
      "modelId": "gpt-4.1",
      "skills": {
        "enabled": ["web-search", "url-reader"]
      }
    }
  ]
}
```

### 8. Skill 存储与持久化（重要）

Skill 包目录优先级：

1. `SKILL_STORAGE_ROOT`（显式配置，优先级最高）
2. `APP_DATA_DIR/skills`
3. `process.cwd()/data/skills`（本地开发默认）

生产环境建议显式配置：

- `SKILL_STORAGE_ROOT=/app/data/skills`

并确保 `/app/data` 挂载持久卷。这样即使升级/删除镜像后重建容器，Skill 包仍保留。

注意：如果执行 `docker compose down -v` 或手动删除 `backend_data` 卷，`/app/data/skills` 也会被一并删除。

Skill 管理相关 API 一览：

- `GET /api/skills/catalog`
- `POST /api/skills/install`
- `DELETE /api/skills/:skillId`
- `POST /api/skills/:skillId/versions/:versionId/approve`
- `POST /api/skills/:skillId/versions/:versionId/activate`
- `POST /api/skills/bindings`
- `GET /api/skills/bindings`
- `DELETE /api/skills/bindings/:bindingId`
- `GET /api/skills/audits`
- `GET /api/skills/approvals`
- `POST /api/skills/approvals/:requestId/respond`

### 9. Python 运行环境与在线依赖管理（BREAKING）

系统已引入受管 Python 运行环境（持久化 venv），用于统一承载：

- 内置 `python_runner`
- 第三方 `runtime.type=python` Skill

破坏性变更（无迁移、直接替换）：

- 移除并停用系统设置旧字段：`python_tool_command`、`python_tool_args`
- Python 执行统一使用受管解释器，不再读取旧命令覆盖

受管运行环境路径：

- `<APP_DATA_DIR|DATA_DIR|process.cwd()/data>/python-runtime/venv`
- Docker 生产建议落在 `/app/data/python-runtime/venv`

管理员可在“系统设置 -> Python 运行环境”进行在线管理：

- 配置索引：`indexUrl` / `extraIndexUrls` / `trustedHosts`
- 手动安装：`POST /api/settings/python-runtime/install`
- 手动卸载：`POST /api/settings/python-runtime/uninstall`（若被激活 Skill 依赖占用会阻断）
- 运行一致性校验：`POST /api/settings/python-runtime/reconcile`
- 状态查询：`GET /api/settings/python-runtime`

Skill 依赖声明与激活策略：

- Skill manifest 支持 `python_packages?: string[]`
- 激活 Skill 版本时会按策略自动安装依赖并执行 `pip check`
- 失败即阻断激活（硬失败）
- 仅允许 PyPI 包名与版本约束，不支持 `git/url/path`

持久化要求（关键）：

- 必须保留 `/app/data` 持久卷，镜像重建后依赖仍可复用
- 如果删除卷（如 `docker compose down -v`），受管 Python 环境与已安装包会一起丢失

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
      - SKILL_STORAGE_ROOT=/app/data/skills
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
| `SKILL_STORAGE_ROOT` | Skill 安装包目录，建议固定为 `/app/data/skills`（需落在持久卷内） |
| `/app/data/python-runtime` | 受管 Python 运行环境目录，在线安装的包会持久化到该卷内 |

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
