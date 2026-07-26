# AI聊天平台 - Docker部署指南

## 🚀 快速开始

### 前置要求

- Docker 20.0+
- Docker Compose 2.0+
- 至少2GB可用内存
- 至少1GB可用磁盘空间

### 一键启动

```bash
# 克隆项目
git clone <repository-url>
cd aichat

# 启动开发环境
./start.sh dev

# 或启动生产环境
./start.sh prod
```

Windows用户请使用：
```cmd
# 启动开发环境
start.bat dev

# 启动生产环境
start.bat prod
```

## 📋 详细说明

### 服务端口

生产默认（`docker-compose.yml`）为 all-in-one：`app` + `docker-socket-proxy`。

| 服务 | 端口 | 说明 |
|-----|------|------|
| app（前端入口） | 3000（可用 `FRONTEND_PORT` 映射） | Web 界面；`/api` 由容器内 Next 反代到 backend |
| app（后端，容器内） | 8001 | 默认不映射到宿主机 |
| docker-socket-proxy | 2375（仅容器网络） | Workspace 沙箱用，不对外暴露 |
| Prisma Studio (开发环境) | 5555 | 数据库管理界面 |

旧四容器拓扑见 `docker-compose.split.yml`。

### 1Panel / Nginx 部署

1. 使用 [`docs/deploy/1panel-compose.example.yml`](deploy/1panel-compose.example.yml) 或仓库根目录 `docker-compose.yml`
2. 同目录配置 `.env`（至少 `JWT_SECRET`、`SECRET_VAULT_MASTER_KEY`、`WORKSPACE_ARTIFACT_SIGNING_SECRET`）
3. 面板/Nginx 反代到宿主机前端端口（示例 `127.0.0.1:3555`），无需再单独反代后端 `8001`
4. 从旧四容器迁移时保留同名数据卷，执行 `docker compose down`（不加 `-v`）后 `pull && up -d`
5. 日常升级：`docker compose pull && docker compose up -d`

镜像：

| 用途 | 镜像 |
| --- | --- |
| 生产默认（推荐） | `ghcr.io/asheblog/aichat:latest` |
| 拆分拓扑 backend | `ghcr.io/asheblog/aichat-backend:latest` |
| 拆分拓扑 frontend | `ghcr.io/asheblog/aichat-frontend:latest` |

### 默认账户

- **用户名**: `admin`
- **密码**: `admin123456`

> ⚠️ **安全提示**: 生产环境请立即修改默认密码！

## 🔧 环境配置

### 环境变量配置

1. 复制环境变量模板：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件配置关键参数：

```bash
# 生产环境必须修改
JWT_SECRET=your-super-secret-jwt-key-here
DEFAULT_ADMIN_USERNAME=your-admin-username
DEFAULT_ADMIN_PASSWORD=your-secure-password

# 其他配置
DEFAULT_CONTEXT_TOKEN_LIMIT=4000
CORS_ORIGIN=http://localhost:3000

# 可选项：初始化时关闭注册
# DEFAULT_REGISTRATION_ENABLED=false

# Skill 存储目录（可选，默认 backend/data/skills）
# SKILL_STORAGE_ROOT=/app/data/skills

# 数据目录（可选，默认 process.cwd()/data）
# Docker 生产环境建议固定为 /app/data
# APP_DATA_DIR=/app/data

# 私有 GitHub Skill 拉取令牌（可选）
# 最小权限建议：contents:read
# GITHUB_SKILL_TOKEN=ghp_xxx
```

### Python 受管运行环境（必须持久化）

系统会在数据目录中创建受管 Python 运行环境：

- `<APP_DATA_DIR|DATA_DIR|process.cwd()/data>/python-runtime/venv`

用途：

- 内置 `python_runner`
- 所有 `runtime.type=python` Skill
- 系统设置中的“Python 运行环境”在线安装/卸载依赖
- 容器启动时自动同步内置 Skill 清单并执行一次 reconcile（可通过 `PYTHON_RUNTIME_RECONCILE_ON_START=false` 关闭）

部署要求：

- 生产环境必须将 `/app/data` 挂载为持久卷。
- 仅删除镜像并重拉不会丢失已安装 Python 包（前提是卷保留）。
- 删除卷（如 `docker compose down -v` 或 `docker volume prune`）会导致 Python 受管环境和已安装包一起丢失。
- 后端镜像不再预装科学计算 Python 包，统一走受管 venv 依赖治理。
- 首次冷启动会执行依赖安装，耗时与网络/索引源有关，属于预期行为。
- 本地 `npm run start:dev` / `npm run start:prod` 同样会自动执行一次 reconcile，可用 `PYTHON_RUNTIME_RECONCILE_ON_START=false` 关闭。

### 注册策略

- 首次启动时默认允许注册，首个用户会自动成为管理员。
- 管理员可在系统设置 → 通用 中切换“允许注册”开关，关闭后新用户申请将被拒绝。
- 即使关闭注册，已存在的管理员仍可通过后台审批/创建用户。

## 🛠️ 管理命令

### 启动脚本选项

```bash
# 显示帮助
./start.sh --help

# 构建并启动
./start.sh prod --build

# 查看日志
./start.sh --logs

# 查看服务状态
./start.sh --status

# 重启服务
./start.sh --restart

# 停止服务
./start.sh --down

# 清理资源
./start.sh --clean
```

### 数据库管理

```bash
# 初始化数据库
./scripts/init-db.sh

# 备份数据库
./scripts/db-manager.sh backup

# 恢复数据库
./scripts/db-manager.sh restore backup_20231201.db.gz

# 重置数据库
./scripts/db-manager.sh reset

# 启动数据库管理界面
./scripts/db-manager.sh studio

# 查看数据库信息
./scripts/db-manager.sh info
```

## 📦 资源配置

### 内存优化

系统经过优化，资源占用如下：

| 环境 | 前端内存 | 后端内存 | 总内存 |
|------|----------|----------|--------|
| 开发环境 | ≤512MB | ≤1GB | ≤1.5GB |
| 生产环境 | ≤256MB | ≤512MB | ≤768MB |

### Docker资源限制

生产环境默认资源限制：
- **后端**: 最大512MB内存，0.5 CPU核心
- **前端**: 最大256MB内存，0.3 CPU核心

可通过修改 `docker-compose.yml` 调整资源限制。

## 🔒 安全配置

### 生产环境安全检查清单

- [ ] 修改默认JWT密钥
- [ ] 修改默认管理员密码
- [ ] 配置HTTPS（反向代理）
- [ ] 设置防火墙规则
- [ ] 定期备份数据库
- [ ] 监控系统资源使用

### 反向代理配置

#### Nginx示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端
    location / {
        # all-in-one：整站反代到前端端口即可（/api 由容器内 Next 转发）
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📊 监控和日志

### 查看日志

```bash
# 查看所有服务日志
./start.sh --logs

# 查看 all-in-one 应用日志
docker logs ai-chat-web-ui-app

# 实时跟踪日志
docker logs -f ai-chat-web-ui-app
```

### 健康检查

服务提供健康检查端点：
- 应用入口: `http://localhost:3000/api/health`
- 后端（容器内）: `http://localhost:8001/api/settings/health`（默认不映射到宿主机）

## 🚨 故障排除

### 常见问题

#### 1. 端口冲突
```bash
# 检查端口占用
netstat -tulpn | grep :3000
netstat -tulpn | grep :8001

# 修改docker-compose.yml中的端口映射
```

#### 2. 权限问题
```bash
# 确保脚本可执行
chmod +x start.sh
chmod +x scripts/*.sh

# Windows用户请使用.bat脚本
```

#### 3. 内存不足
```bash
# 检查系统内存
free -h

# 调整Docker资源限制
# 编辑docker-compose.yml中的deploy.resources配置
```

#### 4. 数据库连接失败
```bash
# 检查数据库文件权限
ls -la data/

# 重新初始化数据库
./scripts/db-manager.sh reset
```

### 完全重置

如需完全重置系统：

```bash
# 停止并删除所有容器
./start.sh --down

# 删除所有镜像
docker rmi $(docker images "aichat*" -q)

# 删除所有卷
docker volume prune -f

# 重新启动
./start.sh prod --build
```

注意：上面的“删除所有卷”会同时清空数据库、Skill 存储以及 Python 受管运行环境（`/app/data/python-runtime`）。

## 📈 性能优化

### 生产环境优化

1. **启用HTTPS**
2. **配置CDN加速**
3. **启用Gzip压缩**
4. **优化数据库索引**
5. **配置缓存策略**

### 数据库优化

```bash
# 定期清理过期数据
# 可通过Prisma Studio或直接SQL操作

# 优化SQLite性能
# 考虑以下PRAGMA设置：
# PRAGMA journal_mode = WAL;
# PRAGMA synchronous = NORMAL;
# PRAGMA cache_size = 10000;
```

## 🔄 更新升级

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
./start.sh prod --build

# 运行数据库迁移（如果有）
./scripts/db-manager.sh migrate
```

如需保留在线安装的 Python 依赖，请不要删除数据卷（尤其不要执行 `docker compose down -v`）。

## 匿名访问改造迁移指引

在应用匿名会话与配额功能的数据库迁移 (`20251101000000_support_anonymous`) 前，请务必完成备份，并了解回滚步骤：

1. **备份 SQLite 数据文件**
   - Linux/WSL: `./scripts/db-manager.sh backup`
   - Windows PowerShell（无 WSL）：
     ```powershell
     $timestamp = Get-Date -Format "yyyyMMddHHmmss"
     Copy-Item -Path ".\\packages\\backend\\prisma\\data\\app.db" -Destination ".\\backup\\app_$timestamp.db"
     ```
2. **执行迁移**（Linux/WSL 与 Windows PowerShell 均支持）：
   ```bash
   ./scripts/db-manager.sh migrate
   ```
3. **需要回滚时**：
   - 首选方式是恢复上一步备份的 `app.db` 文件。
   - 若已执行迁移且希望保留其他数据，可使用 SQLite 恢复脚本：
     ```bash
     sqlite3 packages/backend/prisma/data/app.db <<'SQL'
     DROP TABLE IF EXISTS usage_quota;
     CREATE TABLE IF NOT EXISTS chat_sessions_backup AS SELECT * FROM chat_sessions;
     -- 手动移除匿名字段后再恢复数据
     CREATE TABLE chat_sessions (
       id INTEGER PRIMARY KEY,
       userId INTEGER NOT NULL,
       connectionId INTEGER,
       modelRawId TEXT,
       title TEXT NOT NULL,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       reasoningEnabled BOOLEAN,
       reasoningEffort TEXT,
       ollamaThink BOOLEAN,
       CONSTRAINT chat_sessions_userId_fkey FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT chat_sessions_connectionId_fkey FOREIGN KEY (connectionId) REFERENCES connections(id) ON DELETE SET NULL ON UPDATE CASCADE
     );
     INSERT INTO chat_sessions (id, userId, connectionId, modelRawId, title, createdAt, reasoningEnabled, reasoningEffort, ollamaThink)
       SELECT id, userId, connectionId, modelRawId, title, createdAt, reasoningEnabled, reasoningEffort, ollamaThink
       FROM chat_sessions_backup;
     DROP TABLE chat_sessions_backup;
     SQL
     ```

### 备份策略

建议设置定期备份：

```bash
# 添加到crontab
0 2 * * * /path/to/aichat/scripts/db-manager.sh backup
```

### 匿名数据保留与额度配置

- 系统默认仅保留**匿名访客的会话、消息与附件 15 天**。保留天数可在“系统设置 → 通用 → 匿名访客数据保留天数”中调整，最大值 15，设置为 0 表示仅保留当前会话内容。
- 匿名访客与新注册用户的每日额度同样可在该页面调整：分别为“匿名访客每日额度”和“注册用户默认每日额度”。
- 模型大乱斗提供独立开关与额度：可分别控制注册用户/匿名用户是否可用，以及各自的每日次数上限。
- 当匿名额度耗尽时，前端会提示用户登录；管理员可通过“系统设置 → 系统设置”或“系统设置 → 用户管理”对单个用户额度进行调整。
- 修改完成后无需重启服务，配额策略会即时生效。若希望通过环境变量预设默认值，可设置：
  ```bash
  export ANONYMOUS_RETENTION_DAYS=7
  export ANONYMOUS_DAILY_QUOTA=10
  export DEFAULT_USER_DAILY_QUOTA=200
  export BATTLE_ALLOW_ANONYMOUS=true
  export BATTLE_ALLOW_USERS=true
  export BATTLE_ANONYMOUS_DAILY_QUOTA=20
  export BATTLE_USER_DAILY_QUOTA=200
  ```
  环境变量仅作为初始值，实际以系统设置面板中的最新配置为准。

## 📞 支持

如遇到问题：

1. 查看日志文件
2. 检查GitHub Issues
3. 提交新的Issue并提供详细信息

---

**注意**: 本部署指南基于Docker Compose，确保您的系统满足运行要求。
