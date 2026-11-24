# 部署指南

覆盖两种场景：**用官方镜像跑生产（推荐）** 与 **从源码构建/本地开发**。按“准备密钥 → 启动 → 首次登录配置模型 → 升级与备份”的顺序读即可。

---

## 1. 前置要求

| 项 | 建议 | 说明 |
| --- | --- | --- |
| Docker | 20.0+ | 需要能挂载 `/var/run/docker.sock`（沙箱用） |
| Docker Compose | v2（`docker compose` 子命令） | 仓库脚本同时兼容 `docker-compose` |
| 宿主机内存 | **4 GB 起** | app 自身限 2 GB，另有沙箱短命容器与浏览器渲染 |
| 磁盘 | 拉镜像预留 5 GB、本地构建预留 10 GB 以上 | 生产镜像含 Playwright Chromium、CJK 字体与 Python venv |
| 网络 | 首次启动需能出网 | 拉镜像、拉沙箱镜像 `python:3.11-slim`、Python 运行时 reconcile |
| 源码开发 | Node **22 LTS**（最低 20.19+）、pnpm 8.15 | vite 7.3.8 的 `engines` 为 `^20.19.0 || >=22.12.0`；根 `engines` 只写 `>=20` |

生产镜像内置 Node 20（`node:20-slim` / `node:20-alpine`），宿主 Node 版本只影响源码构建与本地开发。

---

## 2. 生产部署（all-in-one，推荐）

默认拓扑两个容器：`app`（同容器内跑 frontend + backend + rag-worker）与 `docker-socket-proxy`。对外只暴露前端端口，浏览器经容器内 Next 的 `/api`、`/v1`、`/chat-images` rewrite 访问后端。

### 2.1 拉代码并准备环境变量

```bash
git clone https://github.com/Asheblog/Ai-Chat-web-UI.git aichat
cd aichat
cp .env.example .env
```

Windows PowerShell 用 `Copy-Item .env.example .env`。`docker compose` 会自动读取 compose 文件同目录的 `.env`，用于其中的变量替换。

### 2.2 必须设置的三条密钥

```bash
# Linux / macOS / WSL / Git Bash
openssl rand -hex 32
```

PowerShell 7（.NET 加密随机数，输出 64 位十六进制）：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower()
```

或者用 Node（宿主机已装 Node 即可）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| 变量 | 行为 | 是否可省略 |
| --- | --- | --- |
| `JWT_SECRET` | 登录态签名；compose 兜底值 `replace-with-strong-secret` | 必须改 |
| `SECRET_VAULT_MASTER_KEY` | Secret Vault 主密钥，**无默认值**；缺失时后端启动即失败（fail closed） | 必须设置 |
| `WORKSPACE_ARTIFACT_SIGNING_SECRET` | artifact 下载签名；未设置时回退 `JWT_SECRET` | 建议显式设置 |

**主密钥不会自动生成。** 只有 `./start.sh prod` 在 `.env` 不存在时用 `openssl rand -hex 32` 生成一次并写回 `.env`；`start.bat` 只复制模板，`docker compose up -d` 与后端运行时都不生成。请自己生成并离线备份：换掉它，库里已加密的供应商 API Key 无法解密，只能重新录入。

### 2.3 HTTP 访问与同源反代的两个开关

```bash
COOKIE_SECURE=false                 # 纯 HTTP 访问必须显式关闭
ENABLE_CORS=false                   # 同源反代（推荐）无需 CORS
CORS_ORIGIN=https://chat.example.com
```

- `COOKIE_SECURE` 不取值时按 `NODE_ENV=production` 判定为 `true`，浏览器会丢弃登录 Cookie，表现为“登录成功但立刻掉登录”。compose 里是 `COOKIE_SECURE=${COOKIE_SECURE:-}`，留空等于取生产默认值。
- `.env.example` 里 `ENABLE_CORS=true` 是给跨域调试的；all-in-one 同源部署应设 `false`（compose 默认也是 `false`）。

### 2.4 启动与验证

```bash
docker compose up -d
docker compose ps
docker compose logs -f app
```

```bash
curl -fsS http://localhost:3000/api/health                          # 前端 Next 路由
docker compose exec app curl -fsS http://localhost:8001/api/settings/health   # 后端，容器内
```

`app` 的健康检查同时探测这两个地址，`start_period` 为 60 秒。首次启动要跑数据库迁移、内置 Skill 同步与 Python 运行时 reconcile，耗时属正常。

### 2.5 首次登录与模型配置

1. 打开 `http://<地址>:3000`，用管理员账号登录（账户规则见第 4 节）。
2. 首次初始化时 `setup_state=required`，页面进入初始化向导（需管理员登录，可全站跳过）。完成条件是**至少一个启用的系统连接 + 至少一个可用聊天模型**。
3. 进「系统设置 → 连接与模型 → 供应商与连接」，「快速接入」选协议模板，填 Base URL 与 API Key（写入 Secret Vault），保存后测试连接。
4. 进「模型管理」启用模型并设置访问策略，然后回向导完成，或直接在对话页选模型开聊。

---

## 3. 启动时实际发生了什么

`app` 入口是 `/usr/local/bin/start-app.sh`：先执行一次后端初始化（同一份 `start-backend.sh`），再交给 supervisord 拉起三个进程。

1. Docker 访问检查：`DOCKER_HOST` 指向远程（compose 注入 `tcp://docker-socket-proxy:2375`）时跳过本地 socket 检查。
2. `DATABASE_URL` 归一化：`file:` 相对路径统一落到 `/app/data/`；非 `file:` 方案回退到 `/app/data/app.db`。
3. 把数据/日志/图片目录权限修正到 UID/GID 1001（首次创建的命名卷可能是 root）。
4. `prisma generate` → `prisma migrate deploy`；失败时对两个已知历史迁移做 `migrate resolve` 重试，仍失败才回退 `prisma db push`。
5. 数据库文件不存在，或 `DB_INIT_ON_START=true` 时执行 `npm run db:init`（失败回退 `db:seed`）。
6. `npm run db:sync-builtins` 同步内置 Skill 清单。
7. `PYTHON_RUNTIME_RECONCILE_ON_START`（默认 `true`）时执行一次 `python-runtime:reconcile`；失败只告警，服务继续。
8. supervisord 启动 `backend`（`node dist/index.js`）、`rag-worker`（`node dist/workers/document-worker.js`）、`frontend`（`node packages/frontend/server.js`），均以非 root 用户运行。

**升级不需要手工迁移数据库**：每次容器启动都会执行 `migrate deploy`。

---

## 4. 账户、注册与审批

| 场景 | 实际行为 |
| --- | --- |
| 首次初始化且 `users` 表为空 | 创建管理员：用户名取 `DEFAULT_ADMIN_USERNAME`（默认 `admin`），密码取 `DEFAULT_ADMIN_PASSWORD`（默认 `admin123456`），状态 `ACTIVE` |
| 已有任何用户 | 跳过默认管理员创建，不覆盖、不重置任何账号密码 |
| 用户名或密码格式不合法 | 跳过创建并打印警告，此时库里没有管理员 |
| 页面注册 | 仅当 `users` 表为空时，首个注册者成为 `ADMIN`/`ACTIVE`；**其余注册者一律 `USER` + `PENDING`**，登录返回 423 “Account pending approval”，需管理员批准 |
| 注册开关 | 初始化写入 `registration_enabled`，默认 `true` |

**“第一个注册用户自动成为管理员”只在空库成立。** Docker 首次启动已经创建了 `admin`，所以第一个从页面注册的人是 `PENDING` 普通用户。想换管理员账号名/口令，在**第一次 `up -d` 之前**改 compose 的 `environment`（见 5.2），因为默认 compose 不透传这两个变量；账号已存在后再改无效，只能在界面里改密。

---

## 5. 配置环境变量

### 5.1 compose 显式透传（改 `.env` 即生效）

`JWT_SECRET`、`JWT_TTL_SECONDS`、`COOKIE_SECURE`、`SECRET_VAULT_MASTER_KEY`、`DEFAULT_CONTEXT_TOKEN_LIMIT`、`ENABLE_CORS`、`CORS_ORIGIN`、`LOG_LEVEL`、`TASK_TRACE_LOG_DIR`、`DB_INIT_ON_START`、`PYTHON_RUNTIME_RECONCILE_ON_START`、`BACKEND_NODE_OPTIONS`、`FRONTEND_PORT`，以及编排中逐项声明的 `WORKSPACE_`、`URL_READER_`、`WEB_SEARCH_` 参数。完整名称以 `app.environment` 列表为准。

### 5.2 写进 `.env` 不会生效的变量

`docker-compose.yml` 只透传上面这份白名单，且**没有 `env_file`**。下列变量必须写进 compose 的 `environment:`：`DEFAULT_ADMIN_USERNAME`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_REGISTRATION_ENABLED`、`FORCE_SETUP_WIZARD`、`REASONING_*`、`AGENT_MAX_TOOL_ITERATIONS`、`APP_DATA_DIR`、`CHAT_IMAGE_*`、`BATTLE_*`、`ANONYMOUS_*`、`WORKSPACE_RUN_NETWORK_MODE`。

要在首次初始化时换管理员账号，在 `docker-compose.yml` 的 `app` → `environment` 列表里追加两行：

```yaml
      # 仅首次初始化（users 表为空）生效；账号已存在后改这里无效
      - DEFAULT_ADMIN_USERNAME=ops
      - DEFAULT_ADMIN_PASSWORD=<强口令>
```

账号已存在时改密码请用界面：个人设置 →「安全」。

### 5.3 常见误判

- `.env.example` 里 `BACKEND_PORT=3001` 只对取消注释的调试端口映射有意义；compose 中 `"- ${BACKEND_PORT:-8001}:8001"` 是注释状态，all-in-one 默认不暴露 8001。
- `.env.example` 的 `DATABASE_URL=file:./data/app.db` 会被 compose 的 `DATABASE_URL=file:/app/data/app.db` 覆盖，容器内始终是绝对路径。

---

## 6. Docker 沙箱依赖（Workspace / Python / 本地 MCP 网关）

- 沙箱经 `docker-socket-proxy` 使用宿主 Docker：`CONTAINERS=1`、`IMAGES=1`、`POST=1`、`DELETE=1`，socket 只读挂载进 proxy；`app` 只拿到 `DOCKER_HOST=tcp://docker-socket-proxy:2375`。
- 运行镜像默认 `WORKSPACE_DOCKER_IMAGE=python:3.11-slim`，**首次执行代码时由 Docker 守护进程自动拉取**；离线环境请先 `docker pull python:3.11-slim`，否则沙箱首次运行失败。
- 单容器限额 `0.5 CPU / 512m / 128 pids`，全局并发 `WORKSPACE_MAX_CONCURRENT_RUNS=2`，槽位排队超时 15 秒；宿主需为这些短命容器留出内存。
- `WORKSPACE_TOOL_ENABLE=false` 可整体关闭会话沙箱工具。
- proxy 或 socket 不可用时：应用照常运行，入口日志给出 WARN，依赖沙箱的 Python 执行与本地包 MCP 网关不可用。

---

## 7. 浏览器与 Python 运行时

生产镜像内已就位：

- Chromium 与 `playwright-core` 版本匹配，装在 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`，供 `read_url` 渲染与深度研究 `export_pdf` 使用，无需额外安装。
- `URL_READER_BROWSER_ENABLE` 默认 `true`；**保持 `URL_READER_BROWSER_EXECUTABLE_PATH` 为空**，镜像会自己定位内置 Chromium。填发行版 `/usr/bin/chromium` 常与 CDP 启动不兼容。
- 渲染有内存准入：容器内存上限低于 768 MiB 或可用余量低于 256 MiB 时跳过渲染并保留已取到的正文，所以不要把 `app` 的内存限到 512 MB。细节见 [小容器中的网页读取与日志迁移](deploy/web-retrieval.md)。
- 网页正文提取用镜像内独立 venv `/opt/python-extractor`（构建期跑过 smoke test），与受管环境互不影响。
- 受管 Python 运行时在持久卷里：`/app/data/python-runtime/venv`，供内置 `python_runner` 与 `runtime.type=python` 的 Skill 使用。首次冷启动创建 venv 并安装依赖，需要访问 pip 索引；失败不阻塞启动，可在「系统设置 → 工具与扩展 → 内置工具 → Python 运行时管理」重试，或用 `PYTHON_RUNTIME_RECONCILE_ON_START=false` 跳过启动时的 reconcile。

源码运行时这两个能力不会自动就位，要分别补齐：

1. **浏览器（`read_url` 渲染、`export_pdf`）**：装本机 Chrome/Edge，或装 Playwright 的 Chromium：

   ```bash
   pnpm --filter @aichat/backend exec playwright-core install chromium
   ```

   后端综合显式路径、`DEEP_RESEARCH_PDF_CHROMIUM_EXECUTABLE`、`URL_READER_BROWSER_EXECUTABLE_PATH`、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`、`CHROME_PATH` 和 Playwright 内置路径选择可用浏览器。匹配的 Playwright 浏览器优先于系统 Chrome/Edge。缺少可用浏览器时，`read_url` 保留已取得的正文，`export_pdf` 返回 Chromium 不可用的错误。

2. **Python 提取器**：镜像里的解释器是 `/opt/python-extractor/bin/python`；源码运行需自建 venv 并把路径告诉后端，否则正文提取只剩 Node 侧能力：

   ```bash
   python -m venv .scratch/web-extractor-venv
   .scratch/web-extractor-venv/bin/python -m pip install -r packages/backend/scripts/web-extractor/requirements.lock
   .scratch/web-extractor-venv/bin/python packages/backend/scripts/web-extractor/smoke_test.py
   export APP_WEB_EXTRACTOR_PYTHON=$PWD/.scratch/web-extractor-venv/bin/python
   ```

   Windows 下解释器是 `.scratch\web-extractor-venv\Scripts\python.exe`，用 `$env:APP_WEB_EXTRACTOR_PYTHON` 设置同名变量。

缺浏览器只影响渲染与 PDF 导出；缺 Python 提取器只影响正文提取质量。两者都不影响登录与普通聊天。

---

## 8. 端口与卷

| 端口 | 用途 | 是否对外 |
| --- | --- | --- |
| `${FRONTEND_PORT:-3000}` → 3000 | Web 入口；`/api`、`/v1`、`/chat-images` 经 Next rewrite 转给容器内 8001 | 是（反代到这里） |
| 8001 | 后端 API | 默认仅容器内 |
| 2375 | docker-socket-proxy | 仅 compose 网络 |

| 卷（固定名） | 挂载点 | 内容 |
| --- | --- | --- |
| `ai_chat_web_ui_db_data` | `/app/data` | `app.db`（含加密后的密钥密文）、`skills/`、`workspaces/chat/`、`python-runtime/` |
| `ai_chat_web_ui_logs` | `/app/logs` | 运行日志与 `task-trace/` |
| `ai_chat_web_ui_images` | `/app/storage/chat-images` | 聊天图片、用户与 AI 头像 |

卷名写死在 compose 里。改名后旧卷不会被挂载，表现就像“数据丢了”。

---

## 9. 升级

```bash
docker compose pull
docker compose up -d          # 重建容器，复用同名卷；入口自动跑迁移
docker compose logs -f app
```

- **不要** `docker compose down -v`，也不要 `docker volume prune`：会删掉数据库、Skill 存储、workspace、图片与受管 Python 环境。
- compose 用 `latest` 标签，无法直接回滚。升级前记录 `docker compose images` 的镜像 ID，或把 `image:` 固定到具体 tag/digest。
- 含破坏性 migration 的版本先做第 10 节备份。

---

## 10. 备份与恢复

### 在线备份数据库

镜像包含 `sqlite3`。下面用 SQLite 的在线备份接口生成一致的数据库副本，适用于 WAL 模式：

```bash
mkdir -p backups
docker compose exec app sqlite3 /app/data/app.db ".backup '/app/data/app-backup.db'"
docker compose cp app:/app/data/app-backup.db ./backups/app-backup.db
docker compose exec app rm -f /app/data/app-backup.db
```

### 备份完整实例

完整快照包括数据库、Skill、工作区、受管 Python 环境、日志和图片。先停应用，避免快照期间继续写入：

```bash
mkdir -p backups
docker compose stop app
docker run --rm \
  -v ai_chat_web_ui_db_data:/data \
  -v ai_chat_web_ui_logs:/logs \
  -v ai_chat_web_ui_images:/images \
  -v "${PWD}/backups:/backups" alpine \
  sh -c 'tar czf /backups/aichat-volumes.tgz -C / data logs images'
docker compose start app
```

### 仅恢复数据库

在已有实例上操作时，先保留当前备份，再停止应用。数据库副本只恢复聊天与配置；图片、Skill 和工作区文件仍依赖原卷或完整快照。

```bash
docker compose stop app
docker run --rm -v ai_chat_web_ui_db_data:/data -v "${PWD}/backups:/backups" alpine \
  sh -c 'test -s /backups/app-backup.db && rm -f /data/app.db-wal /data/app.db-shm && cp /backups/app-backup.db /data/app.db && chown 1001:1001 /data/app.db'
docker compose start app
```

应用停止后清理旧的 WAL / SHM，再替换数据库文件，避免残留日志与恢复的数据库不一致。

### 恢复完整实例

在新主机或已准备好的**空目标卷**上恢复，保留原卷用于回退。先还原原实例的密钥配置，再执行下面命令；解包时使用与备份一致的三个卷名。

```bash
docker run --rm \
  -v ai_chat_web_ui_db_data:/data \
  -v ai_chat_web_ui_logs:/logs \
  -v ai_chat_web_ui_images:/images \
  -v "${PWD}/backups:/backups" alpine \
  sh -c 'cd / && tar xzf /backups/aichat-volumes.tgz data logs images && chown -R 1001:1001 /data /logs /images'
docker compose up -d
```

解包会覆盖同名文件，并保留目标卷里额外的文件，因此空卷是完整恢复的前提。单独还原数据库时，不会从备份中恢复图片、Skill 或工作区文件。

**必须单独保存、且不在任何卷里**：`.env` 中的 `SECRET_VAULT_MASTER_KEY`、`JWT_SECRET`、`WORKSPACE_ARTIFACT_SIGNING_SECRET`。主密钥丢失后，库里已加密的供应商 Key 无法恢复。

---

## 11. 从源码构建镜像

先构建 backend 与 frontend，再合成 all-in-one：

```bash
docker build -f packages/backend/Dockerfile  --target production -t aichat-backend:local .
docker build -f packages/frontend/Dockerfile --target runner     -t aichat-frontend:local .
docker build -f docker/Dockerfile \
  --build-arg BACKEND_IMAGE=aichat-backend:local \
  --build-arg FRONTEND_IMAGE=aichat-frontend:local \
  -t aichat:local .
```

再用覆盖文件指向本地镜像（compose 会自动加载 `docker-compose.override.yml`）：

```yaml
services:
  app:
    image: aichat:local
```

构建提示：前端构建阶段用 `NODE_OPTIONS=--max-old-space-size=4096`，建议给 Docker 至少 4 GB；backend 构建会安装 Playwright Chromium 并跑网页提取器 smoke test，需要出网。

根目录 `npm run docker:build` / `npm run docker:up` 只是 `docker-compose` 薄包装，而 `docker-compose.yml` 没有 `build:` 段，所以它们不会构建镜像——用上面的 `docker build`。

---

## 12. 源码运行与本地开发

```bash
corepack enable && corepack prepare pnpm@8.15.0 --activate
pnpm install
cp .env.example .env          # 至少设置 JWT_SECRET 与 SECRET_VAULT_MASTER_KEY
pnpm start:dev                # 同时拉起 backend(8001) + frontend(3000)
```

`pnpm start:dev` 会自己完成数据库准备：已有库走 `prisma migrate deploy`，新库先 `db:push` 建表，然后执行 `db:seed`（创建默认管理员与系统设置，已有数据则跳过）并 reconcile Python 运行时，最后并发启动前后端。**不需要**先手工 `db:push`。

- Node 22 LTS（最低 20.19+，由 vite 7 的 `engines` 决定）。
- `pnpm start` 默认也是开发模式；`pnpm start:prod` 走生产模式分支。
- 只启后端：`pnpm --filter @aichat/backend dev`（`tsx watch`）；只启前端：`pnpm --filter @aichat/frontend dev`。
- `DATABASE_URL` 相对路径以 `packages/backend/prisma` 为基准：`file:./data/app.db` → `packages/backend/prisma/data/app.db`。
- 本地执行 Python 沙箱工具仍需本机 Docker；没有 Docker 时相关工具不可用，其余功能正常。
- Windows 和 macOS 客户端填写前端站点的根地址，推荐使用可信证书的 HTTPS。代理应保留前端的 `/api/health`；已有分流代理如果把它转给后端并返回 404，可用 `/main` 和 `/api/settings/health` 兼容，无需新增 API。见 [桌面客户端指南](../packages/desktop/README.md)。
- Android 自动发布已暂停，本地构建见 [Android 指南](../packages/mobile/README.md)。

开发环境编排（镜像内热重载，可选）：

```bash
docker compose -f docker-compose.dev.yml up -d   # 3000 / 8001 / 9229 / 5555(Prisma Studio)
```

---

## 13. 拆分拓扑与反向代理

- 四容器拓扑（frontend / backend / rag-worker / proxy）见 `docker-compose.split.yml`，镜像为 `ghcr.io/asheblog/aichat-frontend` 与 `ghcr.io/asheblog/aichat-backend`；此时前端 `BACKEND_HOST=backend`，后端 8001 需要映射到宿主。
- 1Panel / Nginx 只反代前端端口即可。编排示例见 [docs/deploy/1panel-compose.example.yml](deploy/1panel-compose.example.yml)（`3555` → 容器 3000，并用 `env_file: .env` 透传全部变量）。

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;             # 流式响应必须关缓冲，否则首字延迟
    proxy_read_timeout 3600s;        # 长回答/工具链会长时间不写数据
    proxy_send_timeout 3600s;
}
```

SSE 靠 `proxy_buffering off` 与足够的读超时，不需要为此加 Upgrade/Connection 头。

---

## 14. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出，日志提到 `SECRET_VAULT_MASTER_KEY` | 主密钥为空。补进 `.env` 后 `docker compose up -d`；这是 fail closed 设计 |
| 登录成功但立刻掉登录 | 纯 HTTP 下 `COOKIE_SECURE` 仍为 true。设 `COOKIE_SECURE=false` |
| 注册后无法登录，返回 423 | 账号是 `PENDING`，需管理员在「用户与访问」批准 |
| 改了 `.env` 的管理员账号口令但没生效 | 默认 compose 不透传这两个变量；且只在 `users` 表为空时生效 |
| 健康检查长期 unhealthy | 首次启动仍在迁移/reconcile，`start_period` 60 秒；仍失败看 `docker compose logs app` 里 backend 是否绑定 8001 |
| 页面能开但接口 502 | Next rewrite 指向 `127.0.0.1:8001`，backend 进程没起或端口被改 |
| Python 工具或本地 MCP 报沙箱不可用 | `docker-socket-proxy` 未运行，或宿主禁用了 socket；离线时先 `docker pull python:3.11-slim` |
| 网页渲染总是被跳过 | 容器内存上限低于 768 MiB 或可用余量不足 |
| 端口占用 | 改 `FRONTEND_PORT`，或先 `docker compose down` |
| 升级后像是数据丢了 | 卷名被改，或执行过 `down -v`；按第 10 节恢复 |