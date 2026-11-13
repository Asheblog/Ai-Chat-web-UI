# 会话上下文与个人提示词：根治方案（2026-11-13）

## 目标

把「个人设置 → 对话与上下文」这张卡片，从**半成品 + 谎报**改成一条自洽的数据链：
一个开关说真话、跟随账号、三端一致；个人提示词成为可叠加的偏好层而不是顶掉管理员约束的覆盖项；长度上限只有一个事实源。

## 现状证据（一句话版）

- `contextEnabled` 存在浏览器 localStorage，管的是**当前会话历史**是否随请求发送，文案却写"所有对话"。
- `newConversationContextEnabled` 全仓 8 处引用**全部是写入侧**，无任何读取方（no-op）。
- `personalPrompt` 存在服务端，但在 `sessionPrompt || personalPrompt || globalPrompt || default` 里做**短路替换**，用户可单方面顶掉 `chat_system_prompt`。
- UI 计数写死 `/500`，服务端真实上限 `MAX_SYSTEM_PROMPT_LENGTH` 默认 12000（[`packages/backend/src/constants/prompt.ts`](../../../packages/backend/src/constants/prompt.ts)）。
- 移动端硬编码 `contextEnabled: true`。

## 不做什么（明确排除）

- **不做跨会话长期记忆**。`app-info` 里 `features.long_term_memory` 一直是 `false`，那是独立产品能力（摘要迁移 / 检索注入），不是这张卡片的修复范围。
- **不做"临时对话"（关闭后不落库）**。会连带破坏会话标题、重新生成、分享、配额计量；且用户本来期待聊天记录还在。
- **不保留旧字段兼容**。按项目变更规则：正确性优先、删除冗余、不做向后兼容。

## 决策

| # | 决策 | 理由 | 错判代价 |
|---|---|---|---|
| D1 | **删除**`新对话继承上下文`，不实现它 | "继承几条、多久衰减、隐私边界"都无定义；用户真正要的是跨会话记忆，不是这个中间态 | 若产品确实需要"新会话延续上一段"，重做 T2 约 +1 天 |
| D2 | `contextEnabled` 迁到 `users.contextEnabled` | 一张卡片不能有两种存储模型；换设备失效、串账号、无痕丢失、移动端不一致全是它的派生症状 | 需要 DB 迁移；默认 `true` 保持既有行为 |
| D3 | 个人提示词由**替换**改为**追加层** | 管理员在 `chat_system_prompt` 里的约束不该被用户一句话顶掉 | 同时设了会话提示词与个人偏好的用户，行为会变化（偏好开始生效） |
| D4 | 关闭上下文仍落库，只修文案 | 见"不做什么" | 若真要临时对话，需另开一张卡片 |
| D5 | 提示词上限单一事实源：shared 常量 + `app-info` 暴露 | 计数器与校验必须同源 | 无 |
| D6 | 移动端不再传 `contextEnabled`，由服务端按账号偏好解析 | 端间自动一致，不需要移动端 UI | 无 |

## 契约

### 1. 解析规则（唯一真源）

```ts
// packages/backend/src/agent-runtime/request-options.ts
export const resolveContextEnabled = (input: {
  payloadContextEnabled?: boolean
  actorContextEnabled?: boolean | null
}): boolean => input.payloadContextEnabled ?? input.actorContextEnabled ?? true
```

- 显式传 `false`/`true` → 以请求为准（兼容旧客户端、对战强制 false）。
- 不传 → 取账号偏好；再兜底 `true`。
- 压缩开关与请求构建**必须**都调用它，不允许各自写 `!== false`。

### 2. 提示词分层（装配顺序，从上到下）

```
1. role: system  ← 角色层：会话自定义 → 全局 chat_system_prompt → 内置默认
2. role: system  ← 偏好层：[用户个人偏好] + personalPrompt（仅当非空）
3. role: system  ← 技能/工具注入（web_search、deep_research、python_runner、task_planning…）
4. role: system  ← Markdown 输出规范
5. 历史压缩摘要（固定位置，保持前缀缓存稳定）
6. 历史消息 + 当前用户消息
```

偏好层永远存在（只要用户设了），角色层与会话提示词不再能"顶掉"它。

### 3. 接口

| 方法 | 路径 | 变化 |
|---|---|---|
| GET | `/api/settings/personal` | 新增 `context_enabled: boolean` |
| PUT | `/api/settings/personal` | 新增可选 `context_enabled?: boolean` |
| GET | `/api/settings/app-info` | 新增 `limits.system_prompt_max_length: number` |

DTO：`@aichat/shared/api-contract` 的 `AuthUser` 增加 `contextEnabled?: boolean`；
新增 `DEFAULT_MAX_SYSTEM_PROMPT_LENGTH = 12000`（同一个文件导出，不新增 subpath）。

## 任务

### T1 数据库：`users.contextEnabled`

- `packages/backend/prisma/schema.prisma`：`User` 增 `contextEnabled Boolean @default(true)`（表已 `@@map("users")`）。
- 新迁移 `packages/backend/prisma/migrations/20261113000000_user_context_enabled/migration.sql`：
  `ALTER TABLE "users" ADD COLUMN "contextEnabled" BOOLEAN NOT NULL DEFAULT true;`
- 验收：`pnpm --filter @aichat/backend db:generate` 通过；`prisma validate` 无错。

### T2 删除死开关

- 删 `newConversationContextEnabled`：`frontend/src/types/settings.ts`、`store/settings-store.ts`（默认值 135 / setter 253 / persist 267）、`components/settings/pages/PersonalPreferences.tsx`（19、242-245）。
- 同步删两处测试 mock 的字段：`components/settings/__tests__/personal-settings-section.test.tsx:18`、`personal-settings.test.tsx:29`。
- 验收：除 persist 迁移与其迁移测试（必须按旧键名剥离）外，全仓再无该标识符的读取/写入。

### T3 服务端 contextEnabled 读写

- `services/settings/personal-settings-service.ts`：`PersonalSettingsPayload.context_enabled?: boolean`；`PersonalSettingsResult.context_enabled: boolean`；GET select 与 PUT 更新都带上。
- `api/settings.ts`：zod 加 `context_enabled: z.boolean().optional()`；响应透出。
- `types/index.ts`：`User`、`UserActor` 增 `contextEnabled?: boolean`。
- `services/auth/auth-service.ts`、`services/auth/auth-context-service.ts`：select 与映射补字段（4 处 select、4 处 map）。
- 验收：`personal-settings-service.test.ts` 覆盖"默认 true / 显式 false 落库 / 读取回显"。

### T4 解析单一真源

- 新增 `agent-runtime/request-options.ts` 的 `resolveContextEnabled`。
- `chat-request-builder.ts`：`PrepareChatRequestParams` 增 `contextEnabled?: boolean`，删除内部 `payload?.contextEnabled !== false`（136 行），改用入参。
- `chat-stream-use-case.ts`：在 actor 加载后算一次 `resolvedContextEnabled`，同时用于压缩门（423 行）与 `builder.prepare`。
- `routes/completion.ts`：压缩门（166 行）同样改用解析结果。
- 验收：新增单测"payload 省略时取 actor 偏好；payload 显式为 false 时压过 actor 偏好"。

### T5 提示词分层（D3）

- `chat-request-builder.ts` 150-157：`primaryPrompt = session || global || default`；随后 `if (personalPrompt) systemPrompts.push({ role:'system', content: `[用户个人偏好]\n${applyPromptTemplate(personalPrompt, vars)}` })`。
- 保留 `{day time}` 模板替换与日期剥离逻辑（219-222 行对全部 systemPrompts 生效）。
- 验收测试（`chat-request-builder.test.ts`）：
  - 会话提示词 + 个人偏好 → 两条 system 依次出现，角色层在前。
  - 只设个人偏好 + 全局 → 全局为角色层，个人为第 2 条（**不再顶掉全局**）。
  - 无个人偏好 → 不产生 `[用户个人偏好]` 消息。
  - `contextEnabled: false` → 仍保留全部 system 消息，历史只剩当前用户消息。
- 删除/改写原 `prefers session prompt over personal and system prompts`、`uses personal prompt when session prompt missing but global exists` 两条断言（语义已变）。

### T6 前端单一数据源

- `store/settings-store.ts`：删 `contextEnabled` 及其 setter、persist 项；`persist` 增 `version: 1` 与 `migrate` 剥离旧键（否则 localStorage 旧值会被 merge 回 state）。
- `types/auth.ts` `User`/`UserActorProfile` 与 `store/auth-store.ts` 映射 `contextEnabled`。
- `features/chat/store/slices/stream-message.ts:93-94` 改读 `useAuthStore.getState().user?.contextEnabled ?? true`。
- 验收：`stream-slice.test.ts` 改 mock 后通过；全仓 `settings-store.*contextEnabled` 零命中。

### T7 设置页重写

- 开关绑定 `user.contextEnabled ?? true`，切换走 `updatePersonalSettings({ contextEnabled })` + `fetchActor()`；保存中禁用，失败回滚并 toast。
- 文案（D4 + P1 根治）：
  - 标题「记住对话上下文」，副标题开：`把本会话的历史消息一并发送给 AI（不含其他会话）`／关：`只发送当前这条消息；历史仍会保存，重新开启后可继续`。
  - `个人系统提示词` 下方加说明：`会追加在全局提示词之后；会话自定义提示词优先级最高`。
- 长度：读 `app-info.limits.system_prompt_max_length`，`Textarea` 加 `maxLength`，计数器 `{len}/{limit}`，兜底 shared 常量。
- `api/settings.ts` 增 `getAppInfo()`；`updatePersonalSettings` 支持 `contextEnabled`。
- 验收：`personal-settings.test.tsx` 断言开关反映 `user.contextEnabled`、点击后以 `{contextEnabled:false}` 调用；计数器显示 12000。

### T8 移动端

- `screens/ChatScreen.tsx` 删除 `contextEnabled: true`（服务端按账号偏好解析）。
- 验收：移动端 `streamMessage` 相关测试通过；请求体不含该字段。

### T9 文档

- `CONTEXT.md`：更新上下文开关的作用域定义与提示词分层规则（角色层 / 偏好层 / 技能层）。
- `docs/adr/` 新增一条：`ADR-00X 个人提示词采用追加层而非覆盖`（决策、备选、后果）。

### T10 双轴审查 + 推送

- Standards 轴：`pnpm architecture:check`、`pnpm lint:lines`（`--max 300 --avg 150`）。
- Spec 轴：逐条对照本文件的 T1-T9 验收断言。
- 全量门禁（等同 CI）：backend jest、frontend vitest、mobile test、三端 type-check。
- 全绿后 commit → push `main` → 触发 `Build and Push Images` 的 `quality` job。

## Review Focus

1. **提示词分层的顺序与稳定性**：偏好层插在角色层之后、技能层之前；跨轮次必须字节稳定，否则击穿前缀缓存。
2. **`resolveContextEnabled` 是否真的被两处共用**：压缩门与请求构建若各自判断，会重新分叉。
3. **zustand persist 迁移**：`version: 1` + `migrate` 必须真的剥掉旧键，否则"删掉"只是删了读取方，state 里还留着脏字段。
4. **Actor 字段贯通**：4 处 select、4 处 map，漏一处就会在某个登录路径下退回默认 `true`。
5. **移动端不再传字段**后，服务端兜底必须是"账号偏好"而不是硬编码 `true`。

## 风险与回滚

- **迁移**：默认 `true`，老用户行为不变；回滚只需 revert 迁移与代码（列留存无害）。
- **语义变化**：同时设了会话提示词 + 个人偏好的用户，偏好开始生效——这是 D3 的预期效果，需在 CHANGELOG 注明。
- **前端**：旧 localStorage 的 `contextEnabled` 不再被读取，迁移函数负责清理；即使残留也不影响行为。

## 执行裁定（ledger）

- **R1 · T2 与 T6 的口径冲突**：T6 要求 persist `migrate` 按旧键名剥离 `newConversationContextEnabled`，这与 T2「全仓零命中」字面冲突。裁定：以 T6 为准，旧标识符只允许出现在迁移函数与其测试里。代价是 grep 验收需要人读，不能机械归零。
- **R2 · lint:lines 超限**：`PersonalPreferences.tsx` 因本次新增内容从 270 涨到 310 行，越过 300 上限（该脚本在本次改动前已有 20+ 文件超限，且不在 CI 门禁内）。裁定：不替历史欠债买单，但本次新引入的越界必须清——把「对话与上下文」卡片抽成独立组件，页面回落到 300 以下。
- **R3 · 移动端不补组件级请求体断言**：`packages/mobile` 未装 RN 测试渲染器，为一行删除引入依赖不划算；契约由服务端解析逻辑与三端 type-check 兜底。
- **R4 · 不实现临时对话**：关闭上下文仍落库，只修文案（见 ADR-0040）。

## 验证矩阵

```bash
pnpm architecture:check
pnpm lint:lines
pnpm --filter @aichat/backend db:generate
pnpm --filter @aichat/backend exec jest --runInBand --silent
pnpm --filter @aichat/frontend exec vitest run --reporter=dot
pnpm --filter @aichat/mobile test
pnpm --filter @aichat/backend type-check
pnpm --filter @aichat/frontend type-check
pnpm mobile:type-check
```
