# 登录态滑动续期（方案 A）

- 日期：2026-11-11
- 状态：实施中
- 来源：登录态 24h 绝对过期导致「隔几小时/1–2 天掉登录」的问题分析

## 问题

登录态是 24h 绝对过期的一次性 JWT + HttpOnly Cookie，全链路无续期：

- `packages/backend/src/utils/auth.ts` 写死 `exp = now + 24h`；
- `packages/backend/src/api/auth.ts` 只在 login/register 写 cookie，`maxAge` 同为 24h；
- `packages/backend/src/middleware/auth.ts` 只对匿名 cookie 续写，用户令牌从不续期；
- 前端 `auth-state` 持久化了 `actorState: 'authenticated'`，`TitleSync` 仅在 `actorState === 'loading'` 时拉 `/auth/actor`，刷新页面不会校验 cookie 是否还在。

结果：cookie 到点被浏览器删除 → 后端静默降级匿名（200）→ UI 仍按旧快照显示已登录 → 直到某个用户级接口返回 401，拦截器清空 `auth-storage` 并硬跳登录页。

## 决策

1. **TTL 配置化**：新增 `JWT_TTL_SECONDS`（默认 86400，钳制 60s–365d），`utils/auth.ts` 与登录接口共用同一常量，消灭两处魔数漂移。
2. **滑动续期放在解析 actor 的同一处**：`AuthContextService.resolveActor` 命中 ACTIVE 用户后，用 `shouldRenewAuthToken` 判断剩余寿命 ≤ TTL/2 时重签，结果以 `authCookie` 返回；`middleware/auth.ts` 负责 Set-Cookie（与匿名分支对称）。选择「剩余寿命」而非「已存活」判据，使调大 TTL 后旧令牌立即升级。
3. **前端以服务端为权威**：
   - `partialize` 不再持久化 `actorState`，并用自定义 `merge` 丢弃旧版本 localStorage 里残留的 `actorState`；
   - `TitleSync` 挂载即无条件 `fetchActor()`（store 内已有 in-flight 去重，StrictMode 双挂载只发一次请求）；
   - 于是 `/main` 的 `AppShell ready` 语义重新变成「服务端已确认」，过期即刻落回登录页，不再出现「UI 已登录、后端匿名」的错位；
   - 配套护栏：`handleUnauthorizedRedirect` 在已经位于 `/auth/login`、`/auth/register` 时不再跳转，避免启动探针 401（例如关闭匿名访问时）触发整页刷新死循环。
4. **登出/清 cookie 走同一常量**：`AUTH_TOKEN_COOKIE`，避免三处字符串漂移。

## 不做

- 不引入 refresh token、服务端会话表（方案 B，后续按需）；
- 不改登录页表单、不加「记住我」开关；
- 不动匿名额度与 `anon_key` 现有行为。

## 影响面

- 后端：`utils/auth.ts`、`services/auth/auth-context-service.ts`、`middleware/auth.ts`、`api/auth.ts`
- 前端：`store/auth-persistence.ts`（新增）、`store/auth-store.ts`、`components/title-sync.tsx`
- 配置：`.env.example` 增加 `JWT_TTL_SECONDS`、`COOKIE_SECURE` 说明

## 验证

- 单测：`shouldRenewAuthToken` 三种分支；`resolveActor` 续签/不续签/缺 iat；中间件 Set-Cookie 带 `maxAge`；merge 丢弃持久化 `actorState`；TitleSync 挂载即校验。
- 命令：`pnpm --filter @aichat/backend exec jest --runInBand`、`pnpm --filter @aichat/backend type-check`、`pnpm --filter @aichat/frontend exec vitest run`、`pnpm --filter @aichat/frontend type-check`、`pnpm architecture:check`。
- CI：push `main` 触发 `docker-images.yml`（quality + 镜像构建）必须全绿。

## Review Focus

- 续期判据用「剩余寿命」而非「已存活」，注意 `exp` 缺失只有 `iat` 的旧令牌分支；
- 网关/反代下 `Secure` 由 `COOKIE_SECURE` 决定，续签必须复用同一份配置，不能用硬编码；
- `merge` 丢弃 `actorState` 后首屏会多一次 `/auth/actor` 往返，`AppShell ready` 的骨架期是否可接受；
- 续签在每次「剩余寿命不足一半」时发生，最坏每 12h 重签一次，不会变成每请求重签。
