# AI Chat 聊天平台

轻量级、多模型、可扩展的 AI Chat 平台。前端基于 Next.js 14，后端基于 Hono + Prisma + SQLite，采用 Monorepo 架构；一条 `docker compose up -d` 即可完成生产部署。

🌐 在线示例：https://aichat.asheblog.org

---

## ✨ 功能亮点

- **多模型统一接入**：OpenAI 兼容、OpenAI Responses、Google Gemini 三种协议，DeepSeek / GLM / Qwen / GPT 等模型一次配置、随时切换，上下文窗口与能力自动识别
- **原生工具链**：联网搜索（Tavily / Brave / Exa / Metaso，并行多引擎）、网页读取（本地多引擎 + 浏览器渲染 fallback）、Python 沙箱执行、深度研究（计划确认 → 举证 → `export_pdf`）、RAG 知识库与文档解析
- **图片转写代理（Vision Transcription Proxy）**：DeepSeek、GLM 等纯文本模型也能「看图」——发送图片时自动转交管理员指定的识图模型转写为文字描述并注入主模型；工具流 / 自动转写两种模式自动判定，转写结果持久化复用
- **Skill 插件系统**：内置 Skill + GitHub 第三方 Skill 的安装、审批、激活、会话绑定与审计；可执行型第三方 Skill 强制沙箱隔离、能力按声明授权
- **Workspace Agent**：会话级 Docker 隔离沙箱，内置受管 Python 运行时（缺库自动安装）、文件读写、Git 克隆；并发槽位排队、超时自动杀容器回收
- **深度思考 ↔ 工具交错步骤流**：推理过程与工具调用按时间线交错展示，Web / 分享 / Battle / Android 四端统一
- **模型大乱斗（Battle）**：多模型同题对比 / 单模型多题批量评测，支持题目配图与按题稳定性统计
- **企业级治理**：Secret Vault 密钥库、MCP 服务接入、注册审批、匿名访客与每日额度、调用审计、品牌主题定制
- **多端支持**：Web 客户端 + 原生 Android 客户端（React Native / Expo）

---

## 🚀 快速部署（Docker）

### 前置要求

- Docker 20.0+ 与 Docker Compose 2.0+
- 内存 ≥ 2GB，磁盘 ≥ 2GB（镜像含 Playwright Chromium，供深度研究 PDF / 网页渲染使用）

### 1) 准备环境变量

```bash
cp .env.example .env
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。至少显式设置以下密钥（不要写进 compose 或提交到 Git）：

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | 登录态签名密钥（必改） |
| `SECRET_VAULT_MASTER_KEY` | Secret Vault 主密钥（必填），用 `openssl rand -hex 32` 生成 |
| `WORKSPACE_ARTIFACT_SIGNING_SECRET` | artifact 下载签名（建议设置） |
| `CORS_ORIGIN` | 改为你的实际访问地址 |

### 2) 启动

```bash
docker compose up -d
```

生产默认拓扑为 2 个容器：`app`（同容器运行 frontend + backend + rag-worker，镜像 `ghcr.io/asheblog/aichat`）与 `docker-socket-proxy`（限制 Docker socket 访问，供 Workspace 沙箱使用）。首次启动会自动初始化数据库、同步内置 Skill 并 reconcile Python 运行时，可用以下命令跟踪日志：

```bash
docker compose logs -f app
```

### 3) 验证与首次登录

- 健康检查：`http://<你的地址>:3000/api/health`
- 页面入口：`http://<你的地址>:3000`
- 第一个注册用户自动成为管理员（若关闭注册，用配置的管理员账号登录）
- 浏览器经前端同源 `/api` 访问后端，Nginx / 1Panel 只需反代前端端口

### 4) 日常运维

```bash
docker compose ps                            # 查看状态
docker compose logs -f app                   # 查看日志
docker compose down                          # 停止
docker compose pull && docker compose up -d  # 升级到最新镜像
```

> 💡 需要 frontend / backend / rag-worker 分开扩缩？使用仓库内 `docker-compose.split.yml`（四容器拓扑）。1Panel 编排示例见 `docs/deploy/1panel-compose.example.yml`。

---

## 🛠 本地源码开发

```bash
pnpm install
cp .env.example .env
pnpm --filter backend db:push
npm run start:dev
```

Windows PowerShell 用 `Copy-Item .env.example .env` 代替 `cp`。

---

## 📖 更多文档

- 完整部署指南（环境变量、资源配置、安全清单、升级与迁移）：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 架构说明：[docs/Architecture.md](docs/Architecture.md)
- 领域词汇表（Skill / MCP / 图片转写 / 搜索等术语定义）：[CONTEXT.md](CONTEXT.md)
- 变更日志（含 BREAKING 变更与迁移说明）：[CHANGELOG.md](CHANGELOG.md)
- 架构决策记录：[docs/adr](docs/adr)

---

## License

[MIT](LICENSE)
