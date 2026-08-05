# 拆分 CoT 文字与工具调用（主聊天流分离展示）Implementation Plan

> **Status:** SUPERSEDED / DONE（`bd01927` 及后续提交已落地双独立折叠区块）。后续净化见「工具进度不再写入 reasoning」变更（`stripToolProgressFromReasoning` + 删除 tool `emitReasoning`）。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主聊天流当前用 `CoTTimeline` 把推理文字按 reasoning offset 与工具调用**交错**在一条垂直时间轴里（推理段·工具卡·推理段·工具卡…），观感是"一坨"。本次将其拆为两个**独立折叠区块**——推理区块（上）、工具区块（下）、最终回答（最后），对齐主流产品（Claude thinking 块、ChatGPT 耗时标题、OpenCode `/thinking` `/details` 双开关、Claude Code 工具卡折叠行）。

**Architecture:** 纯前端渲染层改造。后端 SSE 协议、`MessageBody.reasoning`/`toolEvents`/`reasoningPlayedLength` 数据结构全部不变。主聊天流改为：`ReasoningSection`（推理全文，含流式打字机与耗时标题）+ `ToolCallsSection`（每工具独立卡片）+ `MessageBodyContent`。彻底删除交错时间轴组件 `cot-timeline.tsx` 与 `useCoTTimeline.ts`。同时移除系统设置项 `reasoning_default_expand`（运行时时序设置，非 Prisma 列，无 DB 迁移）。分享视图/对战详情已分离，仅核对语义一致。

**Tech Stack:** Next.js / Zustand / Vitest（frontend）；Hono / Prisma(SQLite) / Jest（backend）；pnpm workspace（`@aichat/shared` 共享契约）。

## Global Constraints

- Windows 宿主 + Linux 容器双环境兼容：文件 UTF-8 无 BOM、LF 换行；命令在 Git Bash 下执行。
- 遵循 TDD（先写失败测试 → 实现 → 重构）；前端 Vitest（`pnpm --filter frontend exec vitest run`），CI 用 `vitest run`。
- 保持既有代码风格：中文注释、引号风格与所在文件一致、不新增大型单体文件（低耦合）。
- 数据协议不变：仅前端渲染层改动；不引入新依赖。
- 交互行为规范（经调研 + ui-ux-pro-max 校验）：流式中自动展开、完成后自动折叠；状态徽章必须"颜色+文字"双通道（不单靠颜色传达）；手动展开/收起的 localStorage 记忆优先级最高；微交互 150-300ms；focus-visible 可见焦点环；触控目标 ≥44px；长文本 line-clamp 截断。
- 新组件/改动遵循既有 `expandReducer`（init/set-default/load-persisted/auto-expand/hide-if-empty/toggle）模式与 localStorage 记忆键前缀（`aichat.*_visibility`）。

---

### Task 1: 移除「推理默认展开」系统设置项 reasoning_default_expand

**Files:**
- Modify: `packages/shared/src/settings-contract.ts`（字段映射）
- Modify: `packages/backend/src/services/settings/settings-service.ts`（解析 + `SYSTEM_SETTINGS_FIELD_MAP`）
- Modify: `packages/backend/src/api/settings.ts`（zod schema 可选字段）
- Modify: `packages/frontend/src/types/index.ts`（`SystemSettings` 字段）
- Modify: `packages/frontend/src/features/settings/api.ts`（normalize 读取 + patch 写入两处）
- Modify: `packages/frontend/src/components/settings/pages/reasoning-network/reasoning-config-card.tsx`（移除 Switch）
- Modify: `packages/frontend/src/components/settings/pages/reasoning-network/ReasoningNetworkPage.tsx`（state/保存/传参）
- Modify: `packages/frontend/src/components/settings/__tests__/system-settings-pages.fixtures.ts`（fixture 字段）
- Modify: `packages/frontend/src/components/settings/__tests__/system-settings-pages.test.tsx`（移除相关断言，若有）
- Modify: `.env.example`、`.env`（删除 `REASONING_DEFAULT_EXPAND` 行）

**Notes:**
- 该设置为系统设置（settings 表字段级 JSON），**不是** Prisma 列，无迁移。
- 保留其余推理相关设置：`reasoning_enabled`、`reasoning_save_to_db`、`reasoning_tags_mode`、`reasoning_custom_tags`、`reasoning_max_output_tokens_default` 等一律不动。
- `reasoningDefaultExpand` 在 `message-bubble/index.tsx` 的读取由 Task 4 移除（本任务不要改 index.tsx）。

- [ ] **Step 1: shared 契约**——删除 `settings-contract.ts` 中 `reasoningDefaultExpand: 'reasoning_default_expand'` 一行
- [ ] **Step 2: backend**——`settings-service.ts` 删除 `reasoning_default_expand` 解析行与 `SYSTEM_SETTINGS_FIELD_MAP` 条目；`api/settings.ts` 删除 zod 可选字段
- [ ] **Step 3: frontend api/types**——`types/index.ts` 删除字段；`api.ts` 删除 normalize 与 patch 两处
- [ ] **Step 4: 设置页**——`reasoning-config-card.tsx` 删除 Switch 与 props；`ReasoningNetworkPage.tsx` 删除 state/set/isDirty/保存/传参
- [ ] **Step 5: 测试与 env**——更新 fixtures 与 `system-settings-pages.test.tsx`；删除 `.env.example`/`.env` 行
- [ ] **Step 6: 验证**——`pnpm --filter frontend exec vitest run` 全量通过；`pnpm --filter backend test` 通过（如涉及设置测试）

---

### Task 2: ReasoningSection 行为与文案升级（完成态折叠 + 耗时标题）

**Files:**
- Modify: `packages/frontend/src/components/message-bubble/reasoning-section.tsx`
- Modify: `packages/frontend/src/components/message-bubble/__tests__/reasoning-section.test.tsx`

**Behavior spec:**
- 标题文案：流式中（`reasoningStatus` 为 `idle`/`streaming`）显示「正在思考」+ 旋转 Loader2；完成后显示「思考过程」+ 若 `reasoningDurationSeconds` 存在则追加 `· Ns`（`formatDurationSeconds` 复用 `message-metrics.ts` 既有函数）。
- 完成态默认折叠：`defaultExpanded` 默认语义保持"进入即折叠"，依赖既有 `auto-expand`（流式时展开）+ `load-persisted`（用户手动记忆优先）机制——**不新增机制**，仅确保主聊天流场景（完成后不再 auto-expand）自然折叠。
- 保留：TypewriterReasoning 流式打字机、`reasoningHtml` 完成态 Markdown 渲染分支、unavailable 错误横幅、localStorage 记忆（键 `aichat.reasoning_visibility`）。
- 外层容器样式保持 `border-primary/20 bg-primary/5` 不变（与 ToolCallsSection 统一的基础）。

- [ ] **Step 1: 写失败测试**——在 `reasoning-section.test.tsx` 增加：完成态 `reasoningStatus='done'` 且 `reasoningDurationSeconds` 存在时标题含「思考过程 · Ns」；完成态无手动记忆时默认折叠（aria-expanded=false）；流式仍自动展开
- [ ] **Step 2: 实现**——改标题文案与耗时拼接逻辑
- [ ] **Step 3: 验证**——`pnpm --filter frontend exec vitest run components/message-bubble/__tests__/reasoning-section.test.tsx`

---

### Task 3: ToolCallsSection 行为对齐与样式统一

**Files:**
- Modify: `packages/frontend/src/components/message-bubble/tool-calls-section.tsx`
- Create: `packages/frontend/src/components/message-bubble/__tests__/tool-calls-section.test.tsx`

**Behavior spec:**
- 默认行为：有 active（`running`/`pending`）调用时 `auto-expand` 自动展开；全部完成时自动折叠为摘要行（现有 reducer 已支持，确认生效）。
- 样式统一：外层容器由 `v2-panel` 灰卡改为与推理区块一致的 `rounded-[8px] border border-primary/20 bg-primary/5`；头部标题「工具调用 N 个」+ 状态徽章（运行中/已完成）保留；`data-message-panel="interactive"` 保留。
- 保留：`ToolCallCard` 每工具独立卡片、groupId「任务组」分组标签、summary 副标题、localStorage 记忆（键 `aichat.tool_calls_visibility`）。
- 标题图标：`Wrench` 图标保留；标题字号 `text-sm font-semibold text-primary`（对齐推理区块）。

- [ ] **Step 1: 写失败测试**——新增 `tool-calls-section.test.tsx`：无工具不渲染；有 `running` 调用自动展开（aria-expanded=true）；全部完成且无记忆时默认折叠；用户手动记忆优先于默认；标题显示「工具调用 N 个」
- [ ] **Step 2: 实现**——样式统一 + 确认行为
- [ ] **Step 3: 验证**——`pnpm --filter frontend exec vitest run components/message-bubble/__tests__/tool-calls-section.test.tsx`

---

### Task 4: 主聊天流切换到分离区块并删除交错时间轴

**Files:**
- Modify: `packages/frontend/src/components/message-bubble/index.tsx`
- Delete: `packages/frontend/src/components/message-bubble/cot-timeline.tsx`
- Delete: `packages/frontend/src/features/chat/tool-events/useCoTTimeline.ts`
- Modify（可能）：`packages/frontend/src/components/share/share-viewer.tsx`（核对仅）

**Steps:**
- [ ] **Step 1: index.tsx 数据层**——删除 `useCoTTimeline`/`CoTTimeline` 导入与 `timelineNodes`/`shouldShowTimeline` 逻辑；改用 `useToolTimeline({ sessionId: meta.sessionId, messageId: meta.id, bodyEvents: body.toolEvents })` 获取 `timeline`/`summary`
- [ ] **Step 2: index.tsx 渲染层**——删除 `<CoTTimeline .../>`；改为：`<ReasoningSection>`（有推理时）→ `<ToolCallsSection>`（有工具时）→ `<MessageBodyContent>`；删除 `reasoningDefaultExpand` 读取与 `defaultShouldShowReasoning`，推理区块默认折叠（依赖流式 auto-expand）
- [ ] **Step 3: 删除旧文件**——删除 `cot-timeline.tsx` 与 `useCoTTimeline.ts`，确认无其他引用（`grep -rn "useCoTTimeline\|CoTTimeline\|cot-timeline" packages/frontend/src`）
- [ ] **Step 4: 验证**——`pnpm --filter frontend exec vitest run` 全量通过；`pnpm --filter frontend exec tsc --noEmit` 无错误（或 `next build` 等效检查）

---

### Task 5: 文档更新

**Files:**
- Modify: `CONTEXT.md`（术语表：CoT 词条更新——移除"时间轴交错展示"描述，改为"推理/工具两个独立折叠区块"；Tool Timeline/Tool Node/Tool Group 词条同步调整；`reasoningDefaultExpand` 相关如提及则删除）
- Modify: `CHANGELOG.md`（新增条目：主聊天流推理与工具调用分离展示；移除推理默认展开设置项）

- [ ] **Step 1: CONTEXT.md**——按 `domain-modeling` 规则更新术语（仅措辞与描述调整，无新领域术语/边界变化时在文档中注明"无新增边界"）
- [ ] **Step 2: CHANGELOG.md**——按既有格式追加条目
- [ ] **Step 3: 核对**——`grep -rn "reasoning_default_expand\|reasoningDefaultExpand\|CoTTimeline\|cot-timeline" packages README.md docs CONTEXT.md` 确认清理干净（README 如引用设置项则同步删改）
