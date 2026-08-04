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

可选：Workspace 沙箱并发与资源（未设置时使用 compose / 代码默认值，详见 [`.env.example`](.env.example)）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKSPACE_MAX_CONCURRENT_RUNS` | `2` | 全局同时运行的 Python 沙箱数（聊天/Battle/Skill 共用） |
| `WORKSPACE_RUN_QUEUE_TIMEOUT_MS` | `15000` | 排队等槽位最长 15 秒 |
| `WORKSPACE_DOCKER_CPUS` | `0.5` | 单个沙箱 CPU 上限 |
| `WORKSPACE_DOCKER_MEMORY` | `512m` | 单个沙箱内存上限 |
| `WORKSPACE_DOCKER_PIDS_LIMIT` | `128` | 单个沙箱进程数上限 |
| `WORKSPACE_RUN_TIMEOUT_MS` | `120000` | 单次 Python 执行超时（毫秒） |
| `WORKSPACE_PYTHON_INSTALL_TIMEOUT_MS` | `600000` | pip 自动安装超时（毫秒） |

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

## 方式 A2：四容器 split 拓扑（可选）

若需要 frontend / backend / rag-worker 分开扩缩，使用仓库内 [`docker-compose.split.yml`](docker-compose.split.yml)（已含 workspace 沙箱防护默认值，**密钥仍只放 `.env`**）：

| 服务 | 镜像 | 说明 |
| --- | --- | --- |
| `backend` | `ghcr.io/asheblog/aichat-backend:latest` | 工作区沙箱、API |
| `frontend` | `ghcr.io/asheblog/aichat-frontend:latest` | 页面与 `/api` 反代 |
| `rag-worker` | `ghcr.io/asheblog/aichat-backend:latest` | 文档解析 worker |
| `docker-socket-proxy` | `tecnativa/docker-socket-proxy` | 需 `DELETE=1` 以支持超时杀容器 |

端口可通过环境变量覆盖：`FRONTEND_PORT`（默认 `3000`）、`BACKEND_PORT`（默认 `8001`）。

```bash
docker compose -f docker-compose.split.yml up -d
docker compose -f docker-compose.split.yml logs -f backend
```

---

## 构建命令速查（你要的）

### 启动 / 停止 / 日志

**all-in-one（默认 `docker-compose.yml`）：**

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

**四容器 split（`docker-compose.split.yml`）：**

```bash
docker compose -f docker-compose.split.yml up -d
docker compose -f docker-compose.split.yml ps
docker compose -f docker-compose.split.yml logs -f backend
docker compose -f docker-compose.split.yml down
```

### 更新到最新镜像

**all-in-one：**

```bash
docker compose pull
docker compose up -d
```

**split：**

```bash
docker compose -f docker-compose.split.yml pull
docker compose -f docker-compose.split.yml up -d
```

### 从旧四容器迁移到 all-in-one

1. **不要**执行 `docker compose down -v`（保留数据卷）
2. 停旧栈：`docker compose down`
3. 换成新版 `docker-compose.yml`（服务名为 `app` + `docker-socket-proxy`）
4. 密钥放到同目录 `.env`（或 1Panel 环境变量）
5. `docker compose pull && docker compose up -d`
6. Nginx/1Panel 反代目标保持指向前端宿主机端口（例如 `127.0.0.1:3555`）；可不再单独反代后端端口

### 1Panel 部署要点

- 编排示例：[`docs/deploy/1panel-compose.example.yml`](docs/deploy/1panel-compose.example.yml)（all-in-one；示例端口 `3555:3000`）
- 四容器参考：[`docker-compose.split.yml`](docker-compose.split.yml)
- 密钥只放 `.env` / 面板环境变量，**不要写进 compose 或提交到 Git**
- 站点反代整站到前端端口即可；容器内 Next 会把 `/api` 转到本机 backend
- 升级 all-in-one：`docker compose pull && docker compose up -d`（主要更新 `ghcr.io/asheblog/aichat`）
- 升级 split：`docker compose -f docker-compose.split.yml pull && docker compose -f docker-compose.split.yml up -d`

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
- **图片转写代理（Vision Transcription Proxy）**：主模型不支持识图时，自动将图片转交给管理员指定的识图模型转写为文字描述，再回传给主模型——详见下方「图片转写代理」章节

---

## 图片转写代理（Vision Transcription Proxy）

### 它能做什么

很多文本模型（如 DeepSeek 系列、GLM 纯文本版本）**不支持识图**。启用图片转写代理后，给这类模型发送图片时，系统会自动：

1. 把图片转交给**管理员指定的识图模型**（如 `gpt-5.6-luna`、`qwen-vl`、`gemini` 等）转写为文字描述
2. 描述以文本形式注入主模型上下文，主模型据此直接回答

### 两种工作模式（自动判定）

| 模式 | 触发条件 | 表现 |
| --- | --- | --- |
| **工具流** | 会话启用了 web-search / python 等工具，且主模型支持工具调用 | 自动注入内置工具 `analyze_visual_media`，主模型**自主决定**何时、以什么问题看图，可多次按需重问；工具卡片会显示在消息时间轴 |
| **自动转写** | 主模型不使用工具（纯文本请求） | 后端自动调用转写模型一次，描述注入消息并**持久化**；后续轮次直接复用，不重复转写 |

### 配置步骤（管理员）

1. 进入 **系统设置 → 模型与连接 → 图片转写**（「图片转写代理」卡片）
2. 打开主开关（默认关闭）
3. 选择**转写连接**：承载识图模型的连接
4. 选择**转写模型**：下拉仅列出该连接下具备识图（vision）能力的模型

配置一次即全局生效。关闭开关后，无识图能力的模型恢复「禁止加图」。

### 使用效果

- 非识图模型加图时，输入框上方提示「图片将由 xx 转写」
- 自动转写模式下，用户消息下方显示「图片描述由 xx 转写」小字
- 转写失败（网络/配额/配置错误）时：工具流由主模型自行说明；自动转写模式返回明确错误，不会静默丢图

### 注意事项

- **识图模型走正确的供应商协议**：部分网关的识图模型走 OpenAI Responses API（如 opencode go 的 `gpt-5.6-luna` 只支持 `/responses`），请在「供应商与连接」中用 **`OpenCode Go (Responses 识图)` 类连接**（provider 选 `openai_responses`）承载转写模型；若用错协议会返回 400/空响应
- 转写为**额外一次 API 调用**：建议选择便宜、快速的识图模型，并注意网关配额限制
- 图片仅在发送时转写一次，转写结果随消息持久化；切换主模型后历史消息中的旧图片不会自动补转写（显示为占位）

---

## Workspace 部署前置条件（必须满足）

要启用 `python_runner` 与 workspace 工具链，运行 backend 的容器（all-in-one 的 `app` 或 split 的 `backend`）必须满足：

- 容器内有 `docker` CLI（官方镜像已内置）
- 容器内有 `git` CLI（`workspace_git_clone` 依赖，官方镜像已内置）
- 通过 Docker socket proxy 访问 Docker API（编排模板已包含 `docker-socket-proxy`）
- **`docker-socket-proxy` 必须开启 `DELETE=1`**，否则超时/取消时无法 `docker kill` / `docker rm`，会留下孤儿沙箱容器

仓库默认编排已配置：

- 全局并发槽位（默认 2 个同时运行，超额 FIFO 排队，排队超时 15 秒）
- 单沙箱 cgroup：`0.5` CPU / `512m` 内存 / `128` pids；禁 swap（`memory-swap` 与 memory 同值）
- 业务容器资源上限（示例：`cpus: 2.0`、`mem_limit: 2g`、`pids_limit: 1024`）
- 启动时按 `aichat-ws-` 前缀清理残留沙箱容器

Python 代码执行默认为网络隔离（`network: none`）。pip 安装依赖阶段自动开启网络，安装完成后恢复隔离。

调参：在 `.env` 中覆盖上表 workspace 变量即可；决策说明见 [`docs/adr/0030-workspace-docker-concurrency-and-orphan-cleanup.md`](docs/adr/0030-workspace-docker-concurrency-and-orphan-cleanup.md)。

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
