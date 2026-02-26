# AI Chat 聊天平台

轻量级、多模型、可扩展的 AI Chat 平台。  
前端基于 Next.js 14，后端基于 Hono + Prisma + SQLite，采用 Monorepo 架构。

🌐 在线示例：https://aichat.asheblog.org

---

## 项目定位

AI Chat 面向「可私有化部署 + 可持续扩展」场景，核心设计目标：

- **轻量可运维**：SQLite + Docker Compose，单机即可稳定运行
- **多模型统一接入**：OpenAI / Azure OpenAI / Ollama / Google 等
- **工具化增强**：Skill 插件系统 + Workspace Agent
- **安全可审计**：审批流、调用审计、可回溯产物下载

---

## 最近推送重点（2026-02-25 ~ 2026-02-26）

- **Workspace Python 执行网络模式可配置**：新增 `WORKSPACE_RUN_NETWORK_MODE=none|default`，默认 `none`
- **backend 镜像增强**：官方 backend 镜像内置 `docker` + `git` CLI，支持 `workspace_git_clone`
- **容器权限与挂载路径增强**：自动处理 backend 用户访问 Docker socket；支持根据当前容器挂载动态解析 workspace 根路径
- **Python 缺库自动补装增强**：在 workspace 沙箱中检测 `No module named ...` 并受控自动安装后重试
- **推理面板时间线优化**：工具事件展示顺序与可读性提升

---

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 聊天 | SSE 流式输出、Markdown/代码高亮、LaTeX、图片上传 |
| 模型 | 多连接管理、模型目录聚合与刷新、模型标签与覆盖策略 |
| Skill | 内置 Skill + GitHub 第三方 Skill 安装、审批、激活、绑定、审计 |
| Workspace Agent | 会话级隔离沙箱、`python_runner`、代码仓库克隆与读取、artifact 下载 |
| Python Runtime | 受管 venv、启动 reconcile、依赖来源治理、缺库自动安装 |
| Battle | 多模型对战、评分与分享、历史清理 |
| 治理 | 注册审批、角色权限、配额、调用链追踪 |

---

## 架构与目录

```text
aichat/
├── packages/
│   ├── backend/      # Hono API + Prisma + SQLite
│   ├── frontend/     # Next.js 14 UI
│   └── shared/       # 前后端共享类型/工具
├── scripts/          # 本地开发、CI、工具脚本
├── docs/             # 架构与部署文档
├── docker-compose.yml
├── docker-compose.dev.yml
├── start.sh          # Linux / WSL 一键脚本
└── start.bat         # Windows 一键脚本
```

---

## 快速开始

### 1) Docker Compose（推荐）

前置要求：

- Docker / Docker Compose
- 生产环境请准备强随机密钥：`JWT_SECRET`、`ENCRYPTION_KEY`、`WORKSPACE_ARTIFACT_SIGNING_SECRET`

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd aichat

# 2. 复制环境变量模板
cp .env.example .env

# 3. 启动（生产 compose）
docker compose up -d --build
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

> 若要启用 Workspace Python 沙箱（`python_runner`），backend 服务必须满足：
>
> - 可访问 Docker（挂载 `/var/run/docker.sock:/var/run/docker.sock`）
> - 容器内存在 `docker` 与 `git` CLI（官方 backend 镜像已内置）

健康检查：

- 前端：`/api/health`
- 后端：`/api/settings/health`

---

### 2) 一键脚本（跨平台）

Linux / WSL：

```bash
./start.sh dev
./start.sh prod
```

Windows：

```bat
start.bat dev
start.bat prod
```

---

### 3) 本地开发（不走 Docker）

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

## Workspace Agent（重点）

聊天链路已切换到会话级 workspace 模式（直接替换）：

- 每个会话独立目录：`<APP_DATA_DIR>/workspaces/chat/<sessionId>/`
- 固定子目录：`input/`、`repos/`、`artifacts/`、`.venv/`、`.meta/`
- 内置工具：`python_runner`、`workspace_git_clone`、`workspace_list_files`、`workspace_read_text`
- 产物下载：`GET /api/artifacts/:id/download?exp=&sig=`（签名 + 过期校验）
- 执行安全：只读根文件系统、路径越界拦截、CPU/内存/pids/超时限制

网络策略：

- 默认执行网络关闭：`WORKSPACE_RUN_NETWORK_MODE=none`
- 若确需 Python 代码直连网络：`WORKSPACE_RUN_NETWORK_MODE=default`

---

## Skill 协议与破坏性变更（无向后兼容）

### 统一请求字段：`skills`

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

### BREAKING（迁移策略：无迁移，直接替换）

- 聊天/Battle 的旧 `features` 字段已移除，必须改为 `skills`
- 旧主机执行配置 `python_tool_command`、`python_tool_args` 已下线
- 聊天侧动态第三方 Skill runtime 已禁用，请改用 workspace 工具链

---

## 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | JWT 签名密钥（生产必须修改） |
| `ENCRYPTION_KEY` | 连接密钥加密密钥（建议必配） |
| `DB_INIT_ON_START` | 首次初始化建议 `true`，完成后改 `false` |
| `PYTHON_RUNTIME_RECONCILE_ON_START` | 启动时自动对齐 Python 受管依赖（默认 `true`） |
| `SKILL_STORAGE_ROOT` | Skill 安装包目录（建议落在持久卷） |
| `WORKSPACE_TOOL_ENABLE` | 是否启用 workspace 工具链（默认 `true`） |
| `WORKSPACE_RUN_NETWORK_MODE` | Python 执行网络策略：`none` / `default` |
| `WORKSPACE_ARTIFACT_SIGNING_SECRET` | artifact 下载签名密钥（生产建议独立配置） |

---

## 常用命令

```bash
# 启动开发环境
npm run start:dev

# 启动生产模式（本地）
npm run start:prod

# 数据库迁移部署
pnpm --filter backend db:deploy

# 测试
pnpm --filter backend test

# 构建
pnpm --filter backend build
```

---

## 升级说明

- 以 **正确性优先于兼容性** 为原则，README 所述新链路均为当前主线行为
- 若你仍在使用旧 `features` / 旧 Python 主机执行配置，请按本文直接替换
- 版本升级涉及 Prisma 迁移时，执行：
  - `pnpm --filter backend prisma migrate deploy`
  - `pnpm --filter backend prisma generate`

---

## 更多文档

- 架构说明：[`docs/Architecture.md`](docs/Architecture.md)
- 部署指南：[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- 变更日志：[`CHANGELOG.md`](CHANGELOG.md)

---

## License

[MIT](LICENSE)
