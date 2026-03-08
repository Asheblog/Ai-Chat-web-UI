# AI 回复图文并排（证据模式）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在聊天页与分享页完整落地“能力驱动的证据图文并排”渲染，并打通后端消息/分享快照数据链路。

**Architecture:** 以 `richPayload` 作为统一展示语义，在消息查询与分享快照中输出结构化 `text/image` parts。前端新增 `RichMessageRenderer`，聊天页与分享页共用，桌面分栏、移动堆叠；联网搜索与文档问答通过工具事件/附件/生图结果聚合图片证据。

**Tech Stack:** TypeScript, Next.js, Zustand, Hono, Prisma, Vitest/Jest, TailwindCSS

---

### Task 1: 类型与契约（前后端）

**Files:**
- Modify: `packages/frontend/src/types/index.ts`
- Modify: `packages/backend/src/services/shares/share-service.ts`
- Modify: `packages/backend/src/modules/chat/services/message-query-service.ts`

**Step 1: Write failing tests**
- 在 `message-query-service.test.ts` 增加断言：返回消息包含 `richPayload`，且 text+image 正确组装。
- 在 `share-service.test.ts` 增加断言：快照内包含 `richPayload`。

**Step 2: Run tests and verify RED**
- Run: `pnpm --filter @aichat/backend test -- message-query-service.test.ts share-service.test.ts`
- Expected: 新断言失败（字段不存在）

**Step 3: Minimal implementation**
- 增加 `RichMessagePart/RichMessagePayload` 类型与可选字段。
- 在查询/快照层输出 `richPayload`（先兼容回退组装）。

**Step 4: Run tests and verify GREEN**
- Run same command; Expected: tests pass.

### Task 2: 后端图片证据组装

**Files:**
- Modify: `packages/backend/src/modules/chat/services/message-query-service.ts`
- Modify: `packages/backend/src/services/shares/share-service.ts`

**Step 1: Write failing tests**
- 验证消息含附件图、工具搜索图片、生图结果时，`richPayload.parts` 统一含 image parts。

**Step 2: RED**
- Run backend tests; Expected fail.

**Step 3: Minimal implementation**
- 从 `attachments + generatedImages(从 content 或事件) + toolEvents.hits` 聚合图片。
- 布局策略：text+image => `side-by-side`，image-only => `stack`。

**Step 4: GREEN**
- Run backend tests; Expected pass.

### Task 3: 前端统一渲染器

**Files:**
- Create: `packages/frontend/src/components/message-content/rich-message-renderer.tsx`
- Create: `packages/frontend/src/components/message-content/rich-message-renderer.test.tsx`

**Step 1: Write failing tests**
- 覆盖 text-only / image-only / mixed(side-by-side class) / accessibility attributes。

**Step 2: RED**
- Run: `pnpm --filter @aichat/frontend test -- rich-message-renderer.test.tsx`

**Step 3: Minimal implementation**
- 实现 Evidence Split：`lg:grid lg:grid-cols-12`，左 `col-span-7`，右 `col-span-5`。
- 图片卡片含来源标记、标题、操作按钮（原图/来源）。

**Step 4: GREEN**
- Run same command and pass.

### Task 4: 聊天页接入

**Files:**
- Modify: `packages/frontend/src/components/message-bubble/message-body-content.tsx`
- Modify: `packages/frontend/src/components/message-bubble/index.tsx`

**Step 1: Write failing tests**
- 新增/扩展消息渲染测试：assistant 消息有 `richPayload` 时走统一渲染器。

**Step 2: RED**
- Run frontend tests; Expected fail.

**Step 3: Minimal implementation**
- 删除旧 `GENERATED_IMAGE_PATTERN` 特判路径。
- assistant 内容优先 `richPayload` 渲染，缺失时回退 markdown。

**Step 4: GREEN**
- Run相关测试并通过。

### Task 5: 分享页接入

**Files:**
- Modify: `packages/frontend/src/components/share/share-viewer.tsx`
- Modify: `packages/frontend/src/components/share/share-viewer.test.tsx`

**Step 1: Write failing tests**
- 分享页 mixed message 应展示 `Evidence Split` 结构，且保留大图/来源操作。

**Step 2: RED**
- Run share-viewer tests; Expected fail.

**Step 3: Minimal implementation**
- 分享页改为复用 `RichMessageRenderer`。
- 移除“先 markdown 后 images”分叉逻辑。

**Step 4: GREEN**
- Run tests and pass.

### Task 6: 全量验证

**Files:**
- No code changes expected

**Step 1: Run targeted verification**
- `pnpm --filter @aichat/backend test -- message-query-service.test.ts share-service.test.ts`
- `pnpm --filter @aichat/frontend test -- share-viewer.test.tsx rich-message-renderer.test.tsx markdown-renderer.test.tsx`

**Step 2: Run type/lint sanity (if available in package scripts)**
- backend/frontend 各跑一轮最小可行检查。

