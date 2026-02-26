# AI Chat 聊天平台

轻量级、多模型、可扩展的 AI Chat 平台。  
前端基于 Next.js 14，后端基于 Hono + Prisma + SQLite，采用 Monorepo 架构。

🌐 在线示例：https://aichat.asheblog.org

---

## 第一次部署（先看这个）

如果你是第一次部署，直接按下面 5 步走：

1. 准备 Docker / Docker Compose
2. 使用仓库默认 `docker-compose.yml`
3. 创建 `.env` 并修改关键密钥
4. 执行构建/启动命令
5. 打开健康检查和页面完成首登

---

## 方式 A：按默认 `docker-compose.yml` 首次部署（推荐）

### 1) 创建 `docker-compose.yml`（已去个人配置，改为默认值）

```yaml
version: '3.8'

services:
  backend:
    image: ghcr.io/asheblog/aichat-backend:latest
    container_name: ai-chat-web-ui-backend
    environment:
      - NODE_ENV=production
      - PORT=8001
      - DATABASE_URL=file:/app/data/app.db
      - JWT_SECRET=${JWT_SECRET:-replace-with-strong-secret}
      - DEFAULT_CONTEXT_TOKEN_LIMIT=${DEFAULT_CONTEXT_TOKEN_LIMIT:-120000}
      - ENABLE_CORS=${ENABLE_CORS:-false}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:3000}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - DB_INIT_ON_START=${DB_INIT_ON_START:-false}
      - PYTHON_RUNTIME_RECONCILE_ON_START=${PYTHON_RUNTIME_RECONCILE_ON_START:-true}
      - SKILL_STORAGE_ROOT=/app/data/skills
      - WORKSPACE_TOOL_ENABLE=${WORKSPACE_TOOL_ENABLE:-true}
      - WORKSPACE_ROOT_DIR=${WORKSPACE_ROOT_DIR:-/app/data/workspaces/chat}
      - WORKSPACE_ARTIFACT_TTL_MINUTES=${WORKSPACE_ARTIFACT_TTL_MINUTES:-60}
      - WORKSPACE_IDLE_TTL_MINUTES=${WORKSPACE_IDLE_TTL_MINUTES:-1440}
      - WORKSPACE_CLEANUP_INTERVAL_MINUTES=${WORKSPACE_CLEANUP_INTERVAL_MINUTES:-5}
      - WORKSPACE_MAX_BYTES=${WORKSPACE_MAX_BYTES:-1073741824}
      - WORKSPACE_ARTIFACT_MAX_BYTES=${WORKSPACE_ARTIFACT_MAX_BYTES:-104857600}
      - WORKSPACE_MAX_ARTIFACTS_PER_MESSAGE=${WORKSPACE_MAX_ARTIFACTS_PER_MESSAGE:-20}
      - WORKSPACE_RUN_TIMEOUT_MS=${WORKSPACE_RUN_TIMEOUT_MS:-120000}
      - WORKSPACE_RUN_NETWORK_MODE=${WORKSPACE_RUN_NETWORK_MODE:-none}
      - WORKSPACE_DOCKER_IMAGE=${WORKSPACE_DOCKER_IMAGE:-python:3.11-slim}
      - WORKSPACE_DOCKER_CPUS=${WORKSPACE_DOCKER_CPUS:-1.0}
      - WORKSPACE_DOCKER_MEMORY=${WORKSPACE_DOCKER_MEMORY:-1g}
      - WORKSPACE_DOCKER_PIDS_LIMIT=${WORKSPACE_DOCKER_PIDS_LIMIT:-256}
      - WORKSPACE_ARTIFACT_SIGNING_SECRET=${WORKSPACE_ARTIFACT_SIGNING_SECRET:-replace-with-strong-secret}
      - WORKSPACE_LIST_MAX_ENTRIES=${WORKSPACE_LIST_MAX_ENTRIES:-500}
      - WORKSPACE_READ_MAX_CHARS=${WORKSPACE_READ_MAX_CHARS:-120000}
      - WORKSPACE_GIT_CLONE_TIMEOUT_MS=${WORKSPACE_GIT_CLONE_TIMEOUT_MS:-120000}
      - WORKSPACE_PYTHON_INSTALL_TIMEOUT_MS=${WORKSPACE_PYTHON_INSTALL_TIMEOUT_MS:-300000}
    volumes:
      - backend_data:/app/data
      - backend_logs:/app/logs
      - backend_images:/app/storage/chat-images
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "${BACKEND_PORT:-8001}:8001"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8001/api/settings/health > /dev/null || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      ai-chat-web-ui-network:
        aliases:
          - backend

  rag-worker:
    image: ghcr.io/asheblog/aichat-backend:latest
    container_name: ai-chat-web-ui-rag-worker
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/app.db
      - JWT_SECRET=${JWT_SECRET:-replace-with-strong-secret}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - NODE_OPTIONS=--max-old-space-size=1024
    volumes:
      - backend_data:/app/data
      - backend_logs:/app/logs
      - backend_images:/app/storage/chat-images
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - ai-chat-web-ui-network
    working_dir: /app/packages/backend
    command: ["node", "dist/workers/document-worker.js"]

  frontend:
    image: ghcr.io/asheblog/aichat-frontend:latest
    container_name: ai-chat-web-ui-frontend
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=/api
      - BACKEND_HOST=backend
      - BACKEND_INTERNAL_PORT=8001
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "${FRONTEND_PORT:-3000}:3000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - ai-chat-web-ui-network

volumes:
  backend_data:
    driver: local
    name: ai_chat_web_ui_db_data
  backend_logs:
    driver: local
    name: ai_chat_web_ui_logs
  backend_images:
    driver: local
    name: ai_chat_web_ui_images

networks:
  ai-chat-web-ui-network:
    driver: bridge
    name: ai_chat_web_ui_network
```

### 2) 创建 `.env`（首次部署至少配置密钥）

Linux / WSL：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

至少确认以下变量（强烈建议显式设置）：

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | 必改，登录态签名密钥 |
| `ENCRYPTION_KEY` | 建议设置，连接密钥加密 |
| `WORKSPACE_ARTIFACT_SIGNING_SECRET` | 建议设置，artifact 下载签名 |
| `CORS_ORIGIN` | 改成你的实际访问地址 |

### 3) 启动部署

```bash
docker compose up -d
```

首次部署建议查看日志（会自动初始化 DB / 同步 builtin skills / reconcile Python runtime）：

```bash
docker compose logs -f backend
```

### 4) 验证服务

- 前端健康检查：`http://<你的地址>:3000/api/health`
- 后端健康检查：`http://<你的地址>:8001/api/settings/health`
- 页面入口：`http://<你的地址>:3000`

### 5) 首次登录

- 默认允许注册时：第一个注册用户会成为管理员
- 若你关闭了注册，请使用你配置的管理员账号登录

---

## 构建命令速查（你要的）

### 启动 / 停止 / 日志

```bash
# 启动
docker compose up -d

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 停止
docker compose down
```

### 更新到最新镜像

```bash
docker compose pull
docker compose up -d
```

### 使用源码构建（仅当 compose 配置了 `build` 字段）

```bash
docker compose up -d --build
```

---

## 方式 B：从源码本地开发运行（非 Docker）

Linux / WSL：

```bash
pnpm install
cp .env.example .env
pnpm --filter backend db:push
npm run start:dev
```

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm --filter backend db:push
npm run start:dev
```

---

## 项目特色（部署后你会用到）

- **Skill 插件系统**：内置 Skill + GitHub 第三方 Skill 安装、审批、激活、绑定、审计
- **Workspace Agent**：会话级隔离沙箱，内置 `python_runner`、`workspace_git_clone`、`workspace_list_files`、`workspace_read_text`
- **Python Runtime 受管环境**：启动自动 reconcile，支持缺库自动安装
- **Artifact 下载链路**：`GET /api/artifacts/:id/download?exp=&sig=`（签名 + 过期校验）

---

## Workspace 部署前置条件（必须满足）

要启用 `python_runner` 与 workspace 工具链，backend 容器必须满足：

- 容器内有 `docker` CLI（官方镜像已内置）
- 容器内有 `git` CLI（`workspace_git_clone` 依赖，官方镜像已内置）
- 挂载 Docker socket：`/var/run/docker.sock:/var/run/docker.sock`

默认 `docker-compose.yml` 若未挂载 socket，请在 backend 的 `volumes` 中补充：

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

网络策略：

- 默认 `WORKSPACE_RUN_NETWORK_MODE=none`（执行代码不直连外网）
- 需要 Python 代码联网时，改为 `WORKSPACE_RUN_NETWORK_MODE=default`

---

## BREAKING 变更（无向后兼容，直接替换）

- 聊天/Battle 请求字段统一为 `skills`，旧 `features` 已移除
- 旧主机执行配置 `python_tool_command`、`python_tool_args` 已下线
- 聊天侧动态第三方 Skill runtime 已禁用，请改用 workspace 工具链

请求示例：

```json
{
  "sessionId": 1,
  "content": "请搜索今天的 NVIDIA 新闻并汇总",
  "skills": {
    "enabled": ["web-search", "url-reader", "python-runner"],
    "overrides": {
      "web-search": { "scope": "webpage" }
    }
  }
}
```

---

## 目录结构

```text
aichat/
├── packages/
│   ├── backend/
│   ├── frontend/
│   └── shared/
├── docs/
├── scripts/
├── docker-compose.yml
├── docker-compose.dev.yml
├── start.sh
└── start.bat
```

---

## 更多文档

- 架构说明：[`docs/Architecture.md`](docs/Architecture.md)
- 部署指南：[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- 变更日志：[`CHANGELOG.md`](CHANGELOG.md)

---

## License

[MIT](LICENSE)
