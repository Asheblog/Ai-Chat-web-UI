# AIChat Android 客户端开发计划

本文档是 AIChat Android 客户端的阶段路线图。后续每个新聊天窗口都应先阅读本文，再只处理当前阶段，避免上下文丢失和范围漂移。

## 目标

构建一个可直接安装的 Android APK，作为 AIChat 的移动客户端。客户端首次启动时由用户配置 AIChat 服务端地址，之后通过现有后端 API 完成登录、会话列表和聊天主流程。

该客户端不是简单网页壳，也不以上架应用商店为目标。首版分发方式是 GitHub Releases 或直接安装 APK。

## 技术决策

- 客户端使用 React Native + Expo。
- 新增移动端包：`packages/mobile`。
- 继续保留现有 `packages/frontend` Next.js Web 客户端和 `packages/backend` Hono 服务端。
- 移动端请求使用服务端返回的 Bearer token，不依赖浏览器 cookie。
- 服务端地址由用户在客户端内配置，而不是编译进 APK。
- 首版只覆盖聊天主流程，不迁移 Web 端完整管理后台。

## MVP 范围

首版必须包含：

- 首次启动配置服务器地址。
- 检测服务器是否可达。
- 登录、注册、退出登录。
- 保存服务器地址和认证 token。
- 会话列表。
- 新建会话。
- 进入会话并加载历史消息。
- 发送文本消息。
- 通过 SSE 接收流式助手回复。
- 停止生成。
- 基础 Markdown 渲染。
- 处理服务器不可达、登录过期、流中断、普通接口错误。

首版明确不做：

- 系统设置中心。
- MCP 配置。
- Skill 管理。
- Secret Vault 管理。
- 知识库管理。
- Battle 模式。
- 任务追踪。
- 管理员后台。
- 复杂 Workspace 文件能力。
- 应用商店上架流程。

## 已确认的现有接口事实

- 登录接口位于 `packages/backend/src/api/auth.ts`。
- 登录和注册响应会返回 token，同时 Web 端也会写 httpOnly cookie。
- 后端认证中间件位于 `packages/backend/src/middleware/auth.ts`，支持 `Authorization: Bearer <token>`。
- 会话 API 位于 `packages/backend/src/api/sessions.ts`。
- 聊天 API 入口位于 `packages/backend/src/api/chat.ts`。
- Web 端聊天流式请求位于 `packages/frontend/src/features/chat/api/streaming.ts`。
- Web 端当前通过 `POST /api/chat/stream` 和 `Accept: text/event-stream` 接收 SSE。

## 阶段 0：立项文档

目标：把移动端目标、边界和阶段路线固化到仓库文档。

产出：

- `docs/mobile/android-client-plan.md`
- `docs/adr/0026-android-client-uses-react-native-expo.md`
- `CONTEXT.md` 中的移动端领域词汇

验收标准：

- 文档明确真实 APK、React Native + Expo、用户配置服务器地址、Bearer token、MVP 范围和排除范围。
- 未创建 `packages/mobile`。
- 未修改业务代码。

## 阶段 1：环境和空 Expo App

目标：在 monorepo 中新增移动端包，并让 Android 真机运行空 App。

建议任务：

- 新增 `packages/mobile`。
- 创建 TypeScript Expo App。
- 接入 pnpm workspace。
- 添加移动端 README。
- 添加基础启动脚本。
- 在 Android 设备上运行空首页。

验收标准：

- Android 设备能打开 AIChat Mobile 空首页。
- 首页只需要基础占位界面。
- 不连接后端。
- 不实现登录。
- 不实现聊天。

## 阶段 2：服务器地址配置

目标：让用户在 App 内配置 AIChat 服务端地址。

建议任务：

- 实现首次启动服务器地址输入页。
- 校验 URL 格式。
- 请求健康检查接口验证服务器可达。
- 保存服务器地址。
- App 重启后恢复服务器地址。
- 提供修改服务器地址入口。

优先探查接口：

- `GET /api/settings/health`
- 如该接口不适合移动端，再阅读后端选择更稳定的检测接口。

验收标准：

- 输入正确地址能通过连接检测并保存。
- 输入错误地址有清晰错误提示。
- App 重启后仍记得已保存地址。
- 不实现登录和聊天。

## 阶段 3：登录注册

目标：移动端能基于已保存的服务器地址完成认证。

建议任务：

- 封装移动端 API client。
- 实现登录页。
- 实现注册页。
- 登录成功后保存 token。
- 后续请求统一添加 `Authorization: Bearer <token>`。
- App 重启后恢复登录状态。
- 401 时清理登录状态并回到登录页。
- 实现退出登录。

验收标准：

- Android 设备能登录。
- 关闭并重开 App 后仍保持登录。
- 退出登录后回到登录页。
- token 失效时能回到登录页。
- 不实现会话列表和聊天。

## 阶段 4：会话列表

目标：移动端能展示和创建会话。

建议任务：

- 阅读 `packages/backend/src/api/sessions.ts`。
- 阅读 Web 端会话 API 调用方式。
- 实现会话列表页。
- 实现新建会话。
- 点击会话进入聊天页占位。
- 处理加载中、空状态、错误状态。

验收标准：

- 能看到当前用户可访问的会话列表。
- 能新建会话。
- 能进入某个会话的占位聊天页。
- 所有请求走阶段 3 的 Bearer token API client。
- 不发送消息。
- 不接入 SSE。

## 阶段 5：聊天 MVP

目标：完成首个真正可用的移动端聊天闭环。

建议任务：

- 阅读 `packages/frontend/src/features/chat/api/streaming.ts`。
- 阅读 `packages/backend/src/api/chat.ts`。
- 阅读 `packages/backend/src/modules/chat/routes/stream.ts`。
- 阅读 `packages/frontend/src/features/chat/store/slices/stream-slice.ts`。
- 实现历史消息加载。
- 实现文本输入和发送。
- 调用 `POST /api/chat/stream`。
- 验证 React Native 环境下的 SSE 方案。
- 实时展示助手流式回复。
- 实现停止生成。
- 实现基础 Markdown 渲染。
- 处理流中断、401、服务器错误、网络不可达。

验收标准：

- Android 设备上能完成一轮流式聊天。
- 长回答持续显示且 UI 不明显卡顿。
- 停止生成可用。
- 网络或服务端错误不会卡死聊天页。
- 不做图片上传。
- 不做文件上传。
- 不做 MCP、Skill、知识库。

## 阶段 6：APK 打包

目标：生成可安装 APK，并写清楚安装流程。

建议任务：

- 配置 Android APK 构建。
- 生成 debug APK。
- 生成 release APK，或记录当前最合理的 release 构建方式。
- 更新 `packages/mobile/README.md`。
- 记录如何安装 APK。
- 记录如何配置服务器地址。
- 记录如何排查无法连接服务端的问题。

验收标准：

- 用户能拿到 APK。
- APK 可安装到 Android 设备。
- 安装后能配置服务器地址、登录、聊天。
- 不新增业务功能。

## 阶段 7：第一轮打磨

目标：把 MVP 从跑通变成日常可用。

优先级：

1. 聊天错误重试。
2. 流式回复中断恢复提示。
3. 输入框、键盘遮挡、滚动到底部。
4. Markdown 代码块体验。
5. 服务器切换时清理 token 和会话状态。
6. 会话删除或重命名。
7. 模型选择。
8. 小屏适配和触控细节。

验收标准：

- Android 真机上完成日常聊天主流程。
- 常见错误有明确反馈。
- 仍不扩大到 Web 管理后台。

## 每个新窗口的推荐开场

```text
我们在 /home/wanglinyu/project/aichat 做 AIChat Android 客户端。
请先阅读 docs/mobile/android-client-plan.md、CONTEXT.md 和 docs/adr/0026-android-client-uses-react-native-expo.md。

当前阶段是：阶段 X：……
只做当前阶段，不扩范围，不顺手做下一阶段。
开始前按 grilling 确认边界；如果涉及 UI，必须使用 ui-ux-pro-max。
```

## 每个阶段结束时的交接要求

每个阶段结束时都应输出交接总结：

- 本阶段完成了什么。
- 修改了哪些关键文件。
- 如何运行和验证。
- 测试结果。
- 已知问题。
- 下一阶段从哪里开始。
