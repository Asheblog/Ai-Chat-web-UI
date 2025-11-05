# AI 在线聊天平台 V1.0 - 产品需求文档 (PRD)

| **文档版本** | **V1.6 (Final)** | **创建日期** | 2025年10月20日 |
| :--- | :--- | :--- | :--- |
| **创建者** | Gemini & (您的名字) | **状态** | 已确认 |

## 1. 项目概述 (Overview)

### 1.1 项目背景
随着大型语言模型（LLM）的普及，开发者和小型团队需要一个私有化、轻量级且易于部署的AI聊天解决方案。现有方案（如OpenWebUI）功能强大但资源占用过高。本项目旨在开发一款以 **低资源占用、高效性能、易于部署** 为核心目标的现代化AI聊天网页应用，并支持接入用户自定义的第三方模型API。

### 1.2 项目愿景
打造一款界面美观、体验流畅、资源占用极低的AI在线聊天平台，让每个开发者和团队都能轻松拥有和部署自己的专属AI聊天服务。

### 1.3 项目目标
- **核心目标：** 在Docker容器中运行时，后端服务内存占用显著低于同类产品（峰值 < 500MB）。
- **功能目标：** 实现一个功能完整的、支持自定义模型接入的在线聊天Web应用。
- **部署目标：** 使用SQLite3数据库和Docker Compose，实现零配置、一键部署。
- **用户模式：** 支持“单用户”和“多用户”两种模式，灵活适应不同场景。

## 2. 部署与配置 (Deployment & Configuration)

| 功能点 | 详细描述 | 优先级 |
| :--- | :--- | :--- |
| **Docker 一键部署** | 提供 `Dockerfile` 和 `docker-compose.yml` 文件，用户只需执行 `docker-compose up -d` 即可完成部署。 | **极高** |
| **零配置数据库** | 使用 SQLite3 文件数据库，数据文件通过 Docker Volume 持久化，简化备份和迁移。 | **极高** |
| **注册策略配置** | 通过系统设置或环境变量 `DEFAULT_REGISTRATION_ENABLED` 控制“允许注册”开关，首个用户自动成为管理员。 | **高** |

## 3. 核心功能 (Core Features)

### 3.1 系统与用户管理

| 功能点 | 详细描述 | 优先级 |
| :--- | :--- | :--- |
| **用户角色** | 内置 'ADMIN' 和 'USER' 两种角色。在任一模式下，第一个注册的用户自动成为 'ADMIN'。 | **极高** |
| **注册审批** | 首个注册者自动升级为管理员，其余用户默认进入待审批列表，可由管理员通过/拒绝/禁用。 | **高** |
| **用户注册与登录** | 提供基础的账号密码注册和登录功能。 | **极高** |
| **系统设置 (Admin)** | 仅管理员可见。可配置：1. 是否开放注册；2. 配置系统级AI模型；3. 管理所有用户。 | **高** |
| **个人设置 (User)** | 所有用户可见。可配置：1. 自己的私有AI模型；2. 界面主题（浅色/深色）；3. 上下文Token限制。 | **高** |

### 3.2 模型集成

| 功能点 | 详细描述 | 优先级 |
| :--- | :--- | :--- |
| **自定义模型API接入** | 用户可在设置中配置一个或多个第三方模型API。需填写：API名称、API Endpoint (URL)、API Key。 | **极高** |
| **个人/系统模型分离** | 用户在模型选择列表中，能清晰地看到自己的私有模型和系统提供的公共模型。 | **高** |
| **API Key 安全存储** | 所有用户填写的API Key在存入数据库前必须经过加密处理。 | **高** |

### 3.3 聊天核心体验

| 功能点 | 详细描述 | 优先级 |
| :--- | :--- | :--- |
| **会话管理** | 用户可以创建、删除和切换不同的聊天会话。会话列表在侧边栏清晰展示。 | **极高** |
| **上下文记忆管理** | **为避免Token浪费，采用基于Token数量的滑动窗口策略。** 系统从最新消息开始累积历史消息，直到达到用户设定的Token阈值（可在个人设置中调整）。 | **极高** |
| **Markdown 渲染** | 聊天界面能完美渲染Markdown格式，包括代码块（带高亮）、列表、表格、引用等。 | **极高** |
| **流式响应** | AI的回答以打字机效果流式输出，提升用户体验。 | **极高** |
| **交互控制** | 提供常用交互功能：1. **中断**AI的响应生成；2. **复制**单条消息；3. **编辑**自己的提问并重新提交。 | **高** |

## 4. 非功能性需求 (Non-Functional Requirements)

| 类别 | 需求描述 |
| :--- | :--- |
| **性能** | **内存占用:** 后端服务在空闲状态下内存占用 < 200MB，常规并发使用下峰值 < 500MB。<br>**响应速度:** 首次页面加载 < 3s。应用自身API处理耗时 < 100ms。 |
| **可用性** | **响应式设计:** 界面能自适应桌面、平板和手机屏幕。<br>**界面美观:** 遵循现代UI/UX原则，设计简洁、大气、操作直观。 |
| **安全性** | 用户密码和API Key必须加密存储。防止常见的Web攻击（如XSS）。 |

## 5. 技术栈 (Tech Stack)

| 层面 | 技术选型 | 备注 |
| :--- | :--- | :--- |
| **前端** | Next.js (React), TypeScript, Tailwind CSS, Shadcn/ui | 现代化的、对开发者友好的技术栈，易于构建美观界面。 |
| **后端** | Hono (Node.js), TypeScript | 以超轻量、高性能、低内存占用为核心选型标准。 |
| **数据库** | SQLite3 + Prisma ORM | 零配置，类型安全，易于开发和部署。 |
| **部署** | Docker / Docker Compose | 实现环境隔离和一键部署。 |

## 6. 数据库设计 (Database Schema)

使用 Prisma ORM 进行定义，结构如下：

```prisma
// 1. 用户表
model User {
  id             Int      @id @default(autoincrement())
  username       String   @unique
  hashedPassword String
  role           String   @default("USER") // 'ADMIN' or 'USER'
  createdAt      DateTime @default(now())

  modelConfigs  ModelConfig[]
  chatSessions  ChatSession[]
}

// 2. 模型配置表
model ModelConfig {
  id        Int      @id @default(autoincrement())
  userId    Int?     // 如果为 null，则为系统模型
  name      String
  apiUrl    String
  apiKey    String   // 加密存储
  createdAt DateTime @default(now())

  user         User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  chatSessions ChatSession[]
}

// 3. 聊天会话表
model ChatSession {
  id            Int       @id @default(autoincrement())
  userId        Int
  modelConfigId Int
  title         String    // 可由首条消息自动生成
  createdAt     DateTime  @default(now())

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  modelConfig ModelConfig @relation(fields: [modelConfigId], references: [id])
  messages    Message[]
}

// 4. 消息记录表
model Message {
  id        Int      @id @default(autoincrement())
  sessionId Int
  role      String   // 'user' or 'assistant'
  content   String
  createdAt DateTime @default(now())

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}

// 5. 系统设置表
model SystemSetting {
  key   String @id
  value String
}
```

## 7. 未来规划 (V2.0 Roadmap)
- **长期记忆 (Long-term Memory):** 引入向量数据库，实现基于对话摘要的跨会话记忆功能，让AI能记住跨越不同会话的核心信息。
- **多模态支持 (Multi-modal Support):** 允许用户上传图片，实现图片分析、描述和基于图片的问答功能 (Vision a.k.a. "图片输入")。
