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

| 服务 | 端口 | 说明 |
|-----|------|------|
| 前端 (Next.js) | 3000 | Web应用界面 |
| 后端 (Hono API) | 8001 | API服务 |
| Prisma Studio (开发环境) | 5555 | 数据库管理界面 |

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

# 应用模式
APP_MODE=single  # single | multi

# 其他配置
DEFAULT_CONTEXT_TOKEN_LIMIT=4000
CORS_ORIGIN=http://localhost:3000
```

### 应用模式说明

#### 单用户模式 (single)
- 禁用新用户注册
- 仅管理员可使用
- 适合个人使用

#### 多用户模式 (multi)
- 管理员可控制是否开放注册
- 支持多个独立用户
- 适合团队使用

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
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API代理
    location /api/ {
        proxy_pass http://localhost:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 📊 监控和日志

### 查看日志

```bash
# 查看所有服务日志
./start.sh --logs

# 查看特定服务日志
docker logs aichat-backend
docker logs aichat-frontend

# 实时跟踪日志
docker logs -f aichat-backend
```

### 健康检查

服务提供健康检查端点：
- 前端: `http://localhost:3000/api/health`
- 后端: `http://localhost:8001/api/health`

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

### 备份策略

建议设置定期备份：

```bash
# 添加到crontab
0 2 * * * /path/to/aichat/scripts/db-manager.sh backup
```

## 📞 支持

如遇到问题：

1. 查看日志文件
2. 检查GitHub Issues
3. 提交新的Issue并提供详细信息

---

**注意**: 本部署指南基于Docker Compose，确保您的系统满足运行要求。