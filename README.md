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

生产默认拓扑为 **2 个容器**：

- `app`：`ghcr.io/asheblog/aichat`（同容器运行 frontend + backend + rag-worker）
- `docker-socket-proxy`：限制访问 Docker socket（工作区沙箱）

旧四容器拓扑见仓库内 `docker-compose.split.yml`。

### 1) 使用仓库根目录的 `docker-compose.yml`

直接使用仓库里的编排文件即可（密钥放 `.env`，不要写进 compose）。核心服务：

| 服务 | 镜像 | 宿主机端口（默认） |
| --- | --- | --- |
| `app` | `ghcr.io/asheblog/aichat:latest` | `FRONTEND_PORT` → 3000（页面与 `/api` 反代） |
| `docker-socket-proxy` | `tecnativa/docker-socket-proxy` | 不对外暴露 |

数据卷名保持不变：`ai_chat_web_ui_db_data` / `ai_chat_web_ui_logs` / `ai_chat_web_ui_images`。
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
| `SECRET_VAULT_MASTER_KEY` | 必填！Secret Vault 主密钥，使用 `openssl rand -hex 32` 生成 |
| `ENCRYPTION_KEY` | 已废弃，请使用 SECRET_VAULT_MASTER_KEY |
| `WORKSPACE_ARTIFACT_SIGNING_SECRET` | 建议设置，artifact 下载签名 |
| `CORS_ORIGIN` | 改成你的实际访问地址 |

### 3) 启动部署

```bash
docker compose up -d
```

首次部署建议查看日志（会自动初始化 DB / 同步 builtin skills / reconcile Python runtime）：

```bash
docker compose logs -f app
```

### 4) 验证服务

- 应用健康检查：`http://<你的地址>:3000/api/health`
- 页面入口：`http://<你的地址>:3000`
- 后端仅在容器内监听 `8001`；浏览器经前端同源 `/api` 访问即可（Nginx/1Panel 只需反代前端端口）
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
docker compose logs -f app

# 停止
docker compose down
```

### 更新到最新镜像

```bash
docker compose pull
docker compose up -d
```

### 从旧四容器迁移到 all-in-one

1. **不要**执行 `docker compose down -v`（保留数据卷）
2. 停旧栈：`docker compose down`
3. 换成新版 `docker-compose.yml`（服务名为 `app` + `docker-socket-proxy`）
4. 密钥放到同目录 `.env`（或 1Panel 环境变量）
5. `docker compose pull && docker compose up -d`
6. Nginx/1Panel 反代目标保持指向前端宿主机端口（例如 `127.0.0.1:3555`）；可不再单独反代后端端口

### 1Panel 部署要点

- 编排示例：[`docs/deploy/1panel-compose.example.yml`](docs/deploy/1panel-compose.example.yml)（示例端口 `3555:3000`）
- 密钥只放 `.env` / 面板环境变量，不要写进 compose
- 站点反代整站到前端端口即可；容器内 Next 会把 `/api` 转到本机 backend
- 升级：`docker compose pull && docker compose up -d`（主要只更新 `ghcr.io/asheblog/aichat`）

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
- 通过 Docker socket proxy 安全访问 Docker API（编排模板已包含 `docker-socket-proxy` 服务，无需额外配置）

Python 代码执行默认为网络隔离（`network: none`）。pip 安装依赖阶段自动开启网络，安装完成后恢复隔离。

---

## BREAKING 变更（无向后兼容，直接替换）

- 聊天/Battle 请求字段统一为 `skills`，旧 `features` 已移除
- 旧主机执行配置 `python_tool_command`、`python_tool_args` 已下线
- 聊天侧动态第三方 Skill runtime 默认禁用；可在系统设置开启（建议同时启用审批/审计）
- `read_url` 升级为 v3：本地多引擎读取（静态 HTML、文本/JSON/XML/RSS、CSV、PDF、DOCX、图片、本地 Chromium 渲染 fallback），返回结构新增 `engine`、`attempts[]`、`finalUrl`、`contentFormat`，并保留 v2 的 `leadImageUrl` 与 `images[]`
- 迁移策略：无迁移、直接替换（旧调用方可继续读取原有文本字段；新字段按需消费）

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
├── docker/
│   └── Dockerfile          # all-in-one 合成镜像
├── docs/
├── scripts/
├── docker-compose.yml      # 生产默认：app + docker-proxy
├── docker-compose.split.yml
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
