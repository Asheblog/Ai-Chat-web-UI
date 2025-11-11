# AI聊天平台 - 前端应用

基于 Next.js 14 构建的现代化 AI 聊天平台前端应用。

## 功能特性

### 🎨 现代化UI设计
- **三段式布局**: 侧边栏 + 主内容区的经典聊天应用布局
- **响应式设计**: 完美适配桌面、平板和手机屏幕
- **深色/浅色主题**: 支持主题切换，跟随系统设置
- **优雅动画**: 流畅的过渡效果和微交互

### 💬 聊天功能
- **实时对话**: 支持流式响应的AI对话
- **会话管理**: 创建、删除、切换聊天会话
- **Markdown渲染**: 完整支持Markdown格式，包括代码高亮
- **打字机效果**: AI回复时的逐字显示效果

### 🔧 模型配置
- **个人模型**: 用户可配置自己的AI模型API
- **系统模型**: 管理员可配置系统级模型供所有用户使用
- **安全存储**: API密钥加密存储

### ⚙️ 设置管理
- **个人设置**: 主题、token限制等个人偏好
- **系统设置**: 管理员可管理系统配置
- **用户管理**: 用户角色和权限管理（管理员）

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS + Shadcn/ui
- **状态管理**: Zustand
- **HTTP客户端**: Axios
- **Markdown**: 终端风代码块（统一暗色 oneDark） + react-markdown + remark-gfm + react-syntax-highlighter（不再使用 rehype-highlight）
- **主题**: next-themes
- **图标**: Lucide React

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 安装依赖

```bash
cd packages/frontend
npm install
# 或
pnpm install
```

### 环境配置（集中化）

- 推荐使用仓库根目录的 `.env.example` → `.env` 统一管理所有环境变量。
- 前端 `.env.local` 仅在确有需要时用于“本机覆盖”，通常无需创建。

默认配置下，前端已使用相对路径 `/api` 作为浏览器端 API 基址，并由 Next.js 在服务端反代到后端。

### 启动开发服务器

```bash
npm run dev
# 或
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

### 构建生产版本

```bash
npm run build
npm start
# 或
pnpm build
pnpm start
```

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── auth/              # 认证页面（登录/注册）
│   ├── main/              # 主应用页面
│   │   ├── page.tsx       # 聊天主页
│   │   ├── settings/      # 设置页面
│   │   └── layout.tsx     # 主布局
│   ├── layout.tsx         # 根布局
│   ├── page.tsx           # 首页（重定向）
│   └── globals.css        # 全局样式
├── components/            # React组件
│   ├── ui/                # Shadcn/ui基础组件
│   ├── chat-interface.tsx # 聊天界面
│   ├── message-list.tsx   # 消息列表
│   ├── message-bubble.tsx # 消息气泡
│   ├── sidebar.tsx        # 侧边栏
│   ├── welcome-screen.tsx # 欢迎页面
│   └── ...                # 其他组件
├── lib/                   # 工具库
│   ├── api.ts             # API客户端
│   └── utils.ts           # 工具函数
├── store/                 # 状态管理
│   ├── auth-store.ts      # 认证状态
│   ├── chat-store.ts      # 聊天状态
│   └── settings-store.ts  # 设置状态
└── types/                 # TypeScript类型定义
    └── index.ts
```

## 核心组件说明

### 认证系统
- **AuthGuard**: 路由守卫，保护需要登录的页面
- **AuthStore**: 用户认证状态管理
- **登录/注册页面**: 简洁的单栏居中布局

### 聊天界面
- **ChatInterface**: 主聊天界面，包含消息列表和输入框
- **MessageBubble**: 单条消息组件，支持复制等功能
- **MarkdownRenderer**: Markdown渲染器，支持代码高亮
- **TypingIndicator**: AI思考中的动画指示器

### 侧边栏
- **Sidebar**: 会话管理和导航
- **会话列表**: 显示历史会话，支持删除和重命名
- **用户菜单**: 用户信息和系统设置入口

### 设置页面
- **PersonalSettings**: 个人设置，包括模型配置和界面偏好
- **System Settings 分区**: 系统设置子页（/system/general、/system/network 等），管理员专用
- **ModelSelector**: 模型选择器，支持系统和个人模型

## API集成

前端通过 `src/lib/api.ts` 与后端Hono API通信：

- **认证**: `/api/auth/*`
- **会话**: `/api/sessions/*`
- **消息**: `/api/sessions/:id/messages/*`
- **模型**: `/api/models/*`
- **系统设置**: `/api/admin/*`

所有API请求都包含JWT token认证，支持自动token刷新和错误处理。

## 状态管理

使用Zustand进行状态管理：

- **AuthStore**: 用户信息和认证状态
- **ChatStore**: 会话列表、当前会话、消息记录
- **SettingsStore**: 用户设置、主题、模型配置

状态持久化使用localStorage，确保刷新页面后状态不丢失。

## 主题系统

基于next-themes实现的主题系统：

- **浅色模式**: 适合白天使用
- **深色模式**: 适合夜间使用
- **系统模式**: 跟随操作系统的主题设置

主题切换实时生效，并保存用户偏好。

## 响应式设计

- **桌面端**: 完整的三段式布局
- **平板端**: 可收缩的侧边栏
- **手机端**: 抽屉式侧边栏，全屏聊天界面

## 开发指南

### 添加新页面

1. 在 `src/app/` 下创建新的路由文件夹
2. 添加 `page.tsx` 文件
3. 如需布局，添加 `layout.tsx` 文件

### 添加新组件

1. 在 `src/components/` 下创建组件文件
2. 使用TypeScript定义props类型
3. 遵循现有的命名和结构约定

### 修改主题

在 `src/app/globals.css` 中修改CSS变量：

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  /* ... */
}
```

## 部署

### Docker部署

项目根目录包含完整的Docker配置，前端应用通过Nginx提供静态文件服务。

### 手动部署

1. 构建应用：`npm run build`
2. 启动服务：`npm start`
3. 配置反向代理（如Nginx）指向3000端口

## 故障排除

### 常见问题

1. **API连接失败**: 检查 `.env.local` 中的 `NEXT_PUBLIC_API_URL` 是否为 `/api`；若使用 Docker，确保前端容器具备 `BACKEND_HOST=backend` 与 `BACKEND_PORT=8001`
2. **主题不生效**: 确保组件使用ThemeProvider包装
3. **状态丢失**: 检查localStorage是否可用
4. **样式问题**: 确保Tailwind CSS正确配置

### 调试技巧

- 使用React Developer Tools查看组件状态
- 检查Network标签页的API请求
- 查看Console的错误信息
- 使用Redux DevTools（Zustand支持）

## 贡献指南

1. Fork项目
2. 创建功能分支
3. 提交更改
4. 发起Pull Request

## 许可证

MIT License
