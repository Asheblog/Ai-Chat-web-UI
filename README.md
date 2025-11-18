# AI Chat Platform（未完成开发）
---

轻量级 AI 聊天平台（后端 Hono + SQLite，前端 Next.js）。本文档仅保留两种最简部署方式：

- CI 镜像 + 1Panel（推荐）
- 本地运行（开发 / 非 Docker 生产）

---

## 一、CI 镜像 + 1Panel 部署（推荐）

前提
- 镜像已由 GitHub Actions 推送到 GHCR：
  - 后端：`ghcr.io/asheblog/aichat-backend:latest`
  - 前端：`ghcr.io/asheblog/aichat-frontend:latest`
- 若包是私有，需先在服务器执行 `docker login ghcr.io -u asheblog -p <PAT>`（PAT 至少具备 `read:packages`）。

在 1Panel 的“编排 → 新建 → 编辑”中粘贴以下 Compose（示例端口：前端 3555，后端 3556，可按需修改左侧宿主端口）：

```
version: '3.8'

services:
  backend:
    image: ghcr.io/asheblog/aichat-backend:latest
    container_name: ai-chat-web-ui-backend
    environment:
      - NODE_ENV=production
      - PORT=8001
      - DATABASE_URL=file:./data/app.db
      - JWT_SECRET=请改成强随机密码 #这里要改
      - DEFAULT_REGISTRATION_ENABLED=true
      - DEFAULT_CONTEXT_TOKEN_LIMIT=120000 #这里后面大概率就要废弃的
      - ENABLE_CORS=true #不要cors就关了
      - CORS_ORIGIN=http://你的IP或域名:3555
      - LOG_LEVEL=info
      - DB_INIT_ON_START=true #首次部署结束后记得进入编排修改为false或删除，避免重复播种
    volumes:
      - backend_data:/app/data
      - backend_logs:/app/logs
      - backend_images:/app/storage/chat-images
    ports:
      - "3556:8001" #后端端口可以改 
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
      - "3555:3000" #前端端口可以改
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

首次初始化
- 新镜像已内置自动初始化：若容器启动时未发现 `/app/data/app.db`，会自动执行 `prisma db push` 初始化数据库，并修复卷权限；通常无需手动建表。
- 如需手动：在 1Panel 进入 `ai-chat-web-ui-backend` 容器终端，执行：`npm run db:push`。
- 若希望自动播种默认数据，可在 1Panel 编排中临时加入环境变量 `DB_INIT_ON_START=true`，首次启动观察后台日志确认 `npm run db:init` 执行成功后再移除/改回默认值，避免重复播种。
- 初始化完成后，访问前端 `http://你的IP或域名:3555`，注册第一个账号（single 模式下为管理员）。

关键配置要点
- `JWT_SECRET`：务必改为 32 位以上强密码。
- `CORS_ORIGIN`：填写前端实际访问地址（含协议+端口）。
- 图片存储：`CHAT_IMAGE_DIR` 默认指向 `/app/storage/chat-images`。Compose 中的 `backend_images:/app/storage/chat-images` 会将聊天图片与头像持久化到宿主卷；若需使用其他目录，请同时调整 `CHAT_IMAGE_DIR` 与卷挂载路径。
- 端口：`"宿主机端口:容器端口"`，容器内固定后端 8001、前端 3000。
- 升级/回滚：把镜像标签从 `latest` 改为某次构建的 commit SHA 标签，更新/重建即可；回滚就是切回旧标签。

健康检查
- 前端：`http://你的IP或域名:3555/api/health`
- 后端：`http://你的IP或域名:3556/api/settings/health`

版本更新
- 1panel部署的话，直接在面板拉取最新镜像重启容器即可。
- **如果涉及数据库更新，请阅读 CHANGLOG.MD文件，注意升级命令。**

---

## 二、本地运行（不使用 Docker）

前提
- Node.js ≥ 18；首次运行建议复制根目录 `.env.example` 为 `.env` 并按需修改（`JWT_SECRET`、`CORS_ORIGIN` 等）。

命令
- 开发环境（热更新）：`npm run start:dev`
- 非 Docker 的生产运行：`npm run start:prod`

数据库初始化（首次）
- 进入 `packages/backend`，执行一次：`npm run db:push`

---

## 项目结构

```
aichat/
├── .github/
│   └── workflows/
│       └── docker-images.yml       # GH Actions：构建并推送前后端镜像
├── packages/
│   ├── backend/                    # 后端（Hono + Prisma + SQLite）
│   │   ├── src/                    # API、路由、中间件
│   │   ├── prisma/                 # Prisma schema 与 seed/迁移脚本
│   │   └── Dockerfile              # 后端镜像
│   └── frontend/                   # 前端（Next.js 14）
│       ├── src/
│       └── Dockerfile              # 前端镜像（standalone 运行）
├── scripts/                        # 辅助脚本（本地/调试）
├── README.md
 └── docs/                           # 文档（可选）
```

数据持久化
- SQLite 数据文件位于容器内 `/app/data/app.db`，通过 compose 中的 `backend_data` 卷（或你自定义的宿主机路径）持久化。

---

## 业务流程图

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户浏览器
  participant FE as 前端 Next.js (3000)
  participant BE as 后端 Hono (8001)
  participant DB as SQLite (/app/data/app.db)
  participant Prov as 第三方模型提供方

  U->>FE: 输入消息
  FE->>BE: POST /api/chat/stream (JWT)
  BE->>DB: 读取会话/系统设置
  BE->>Prov: 转发请求（带鉴权）
  Prov-->>BE: 流式SSE/分片
  BE-->>FE: 转发SSE；统计用量
  BE->>DB: 持久化消息/用量
  FE-->>U: 渲染模型回复
```
---

## 部分图片预览

<img width="1920" height="861" alt="微信图片_20251029144356_346_176" src="https://github.com/user-attachments/assets/26757bae-78de-4cf4-9e6a-584c4b2101db" />
<img width="1920" height="870" alt="微信图片_20251029144331_345_176" src="https://github.com/user-attachments/assets/48179c04-afda-46e4-b74f-ffd29431934d" />
<img width="1920" height="870" alt="image" src="https://github.com/user-attachments/assets/13d407f8-40df-4fb4-9140-af068a2cd850" />


---

## 常见问题（简）

- 无法拉取镜像：GHCR 包设为 Public，或在服务器 `docker login ghcr.io -u asheblog -p <PAT>`。
- 跨域报错：确认 `CORS_ORIGIN` 与前端访问地址一致（协议+端口）。
- 首次注册失败：请在系统设置「通用」页确认“允许注册”开关已开启；默认情况下首个注册者会成为管理员，其余用户需管理员审批。
- 图片 URL 指向 localhost：在系统设置「通用」页填写“图片访问域名”并保存，随后点击“刷新图片链接”即可生成新域名样例；如留空则会根据请求头或局域网 IP 自动推断（便于本地调试）。
- 文字 LOGO 仍显示默认 `AIChat`：确保系统设置中已保存“文字 LOGO”，若容器刚更新，前端会自动轮询 `/api/settings/branding`，无需手动重启即可恢复自定义名称。

## 任务追踪（Task Trace）

后台可选记录 `/api/chat/stream` 生命周期，全链路追踪请求/工具事件/错误，辅助排障：

1. **执行数据库迁移**：`pnpm --filter backend prisma migrate deploy`（或 `prisma migrate deploy`）以创建 `task_traces` / `task_trace_events` 表。
2. **开启开关**：管理员登录前端后进入 `设置 → 系统 → 日志与监控`，配置“启用任务追踪 / 默认开启 / 仅限管理员 / 可用环境 / 保留天数”。
3. **查看与导出**：`/main/logs/task-trace` 列出所有追踪，支持筛选、详情（首 2000 条事件）与 TXT 导出，对应 API：
   - `GET /api/task-trace`：分页列表
   - `GET /api/task-trace/:id`：详情 + 事件
   - `GET /api/task-trace/:id/export`：TXT 导出
   - `POST /api/task-trace/cleanup`：按保留天数批量清理
4. **输入框快速开关**：管理员在聊天输入框侧栏可通过“任务追踪”按钮临时开启/关闭单次追踪。

---

许可证：MIT（见 LICENSE）。
