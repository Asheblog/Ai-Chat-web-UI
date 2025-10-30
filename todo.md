# 全站登录与匿名改造 TODO

## 1. 数据库与基础配置
- [x] 调整 `ChatSession` 支持匿名字段：`userId` 允许为空，新增 `anonymousKey`、`expiresAt` 并建立唯一/过期索引。
- [x] 新增 `UsageQuota` 表：包含 `identifier`、`scope('USER'|'ANON')`、`dailyLimit`、`usedCount`、`lastResetAt`，补全与 `User` 的关联索引。
- [x] 更新 `SystemSetting` 预置值，写入 `anonymous_retention_days`（默认 15，限制 0–15）与 `anonymous_daily_quota` 等键。
- [x] 生成 Prisma migration 并验证在 Linux/Windows 均可执行；为旧数据提供备份与回滚指引。

## 2. 后端身份识别与匿名会话
- [ ] 新建 `actorMiddleware`：优先解析 JWT，将用户信息附加到 `c.set('actor')`；若无 token 且允许匿名，则下发/复用 `anon_key` Cookie（HttpOnly、SameSite=Lax、Secure 生产启用）。
- [ ] 替换各 API 中对 `authMiddleware` 的直接依赖：对开放接口使用 `actorMiddleware`，管理员/敏感接口叠加 `requireUserActor` 或 `adminOnlyMiddleware`。
- [ ] 调整 `/sessions`、`/chat` 相关逻辑：根据 actor 选择 `userId` 或 `anonymousKey`，并在所有查询中增加匿名条件。
- [ ] 在匿名请求进入时记录/续期 `expiresAt`；实现集中工具函数 `ensureAnonymousSession(actor)` 供创建会话调用。

## 3. 配额校验与系统设置扩展
- [ ] 实现配额工具模块（事务内重置 `usedCount`、扣减额度、返回剩余额度），匿名默认读取系统设置中的 `anonymous_daily_quota`。
- [ ] 在 `/chat/stream` 与 `/chat/completion` 写入前调用配额校验：额度不足返回 429，并返回 `requiredLogin: true` 提示。
- [ ] 扩展 `/settings/system`：匿名 GET 仅返回公共字段，PUT 仍需管理员；字段含匿名保留天数、匿名/用户默认额度。
- [ ] 在管理员 API 中新增 `UsageQuota` 更新入口，可为单个用户设定额度；禁止对自身操作引发锁死。

## 4. 管理员与用户管理
- [ ] `/users` 增补：创建用户、修改用户名、重置密码、设置单用户额度；所有敏感操作校验目标是否为当前管理员本人。
- [ ] `/auth/me` 与密码修改接口同步支持用户名被管理员更新的情况（若更新自身用户名，返回最新信息）。
- [ ] 在系统设置页面新增匿名额度与默认用户额度配置区域，保存时调用新增 API。

## 5. 前端匿名模式支持
- [ ] 重构 `auth-store`：新增 actor 状态（`anonymous` | `authenticated` | `loading`），`getCurrentUser` 兼容匿名结果，不再强制跳转登录。
- [ ] 移除 `AuthGuard` 强制拦截：`/main` 改为直接渲染，根据 actor 决定会话加载策略。
- [ ] 顶部用户菜单：未登录时渲染 shadcn 风格 “登录” 按钮及今日剩余额度提示；登录态继续展示头像菜单。
- [ ] 侧边栏与聊天列表：允许匿名会话；若匿名额度为 0 则禁用新建会话按钮并给出登录引导。
- [ ] 聊天输入框占位符改为 “本日消息发送额度剩余 XX”，额度为 0 时锁定输入并显示 “额度已用尽，请登录或等待次日重置”。

## 6. 匿名数据保留与清理
- [ ] 为匿名消息写入时触发清理流程：删除超过 `anonymous_retention_days` 的会话、消息及附件；保留天数为 0 时仅保留当前会话。
- [ ] 记录清理日志，避免频繁全量扫描；可按批次或基于最老 `expiresAt` 处理。
- [ ] 更新文档说明匿名数据仅保留 ≤15 天，并提示管理员如何修改。

## 7. 前端设置与权限体验
- [ ] `settingsNav` 根据 actor 裁剪：匿名仅显示只读页面，尝试进入系统设置时展示 “你无权打开该功能”。
- [ ] 系统设置对话框在匿名模式下禁用编辑内容，并引导用户登录。
- [ ] 更新个人设置页：若为匿名访客，隐藏账号安全、直连连接等需要登录的部分。

## 8. 测试与验证
- [ ] 后端：为匿名配额、会话归属、管理员操作添加集成测试；重点覆盖额度耗尽与匿名清理。
- [ ] 前端：补充匿名/登录两种模式下的关键组件测试（stores、用户菜单、输入框行为）。
- [ ] 手动回归：在 Linux (WSL) 与 Windows 浏览器验证 Cookie 行为、匿名额度、登录流程。
- [ ] 更新 README/部署文档，新增迁移步骤、匿名模式介绍与常见问题。
