# 🚀 AI聊天平台 - 快速开始

## 5分钟快速部署

### 1️⃣ 克隆项目
```bash
git clone <repository-url>
cd aichat
```

### 2️⃣ 验证配置 (可选)
```bash
chmod +x scripts/verify-deployment.sh
./scripts/verify-deployment.sh
```

### 3️⃣ 启动应用
```bash
# 开发环境 (推荐首次使用)
./start.sh dev

# 生产环境
./start.sh prod
```

Windows用户请使用：
```cmd
start.bat dev
```

### 4️⃣ 访问应用
- 🌐 **前端应用**: http://localhost:3000
- 🔧 **后端API**: http://localhost:8001
- 🗄️ **数据库管理**: http://localhost:5555 (仅开发环境)

### 5️⃣ 登录系统
- 👤 **用户名**: `admin`
- 🔑 **密码**: `admin123456`

## 📝 首次配置

1. **登录系统**后，点击右上角设置
2. **配置AI模型**：
   - 进入"系统设置"
   - 添加模型API配置
   - 填写API Key
3. **开始聊天**！ ✨

## 🛠️ 常用命令

```bash
# 查看帮助
./start.sh --help

# 查看日志
./start.sh --logs

# 重启服务
./start.sh --restart

# 停止服务
./start.sh --down

# 数据库管理
./scripts/db-manager.sh backup
./scripts/db-manager.sh studio
```

## ⚠️ 重要提醒

**生产环境使用前请务必：**
- 修改默认管理员密码
- 配置自己的AI模型API
- 设置强JWT密钥

详细配置请参考：[DEPLOYMENT.md](./DEPLOYMENT.md)

---

🎉 **恭喜！您的AI聊天平台已经运行起来了！**