# Read URL v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 直接替换现有 `read_url` 与 `web_search` 结果结构，使网页读取具备稳定的图片证据输出，并让证据链路可被前端渲染。

**Architecture:** 在 `url-reader` 内部新增图片提取与归一化能力，扩展 `UrlReadResult`；同步扩展 `WebSearchHit` 的图片字段并透传到工具日志。保持现有文本提取和错误码机制不变，仅增加结构化证据字段和模型摘要内容，避免协议破坏。

**Tech Stack:** TypeScript, Jest, JSDOM, Readability, 现有 Tool Log / Rich Payload 管线

---

### Task 1: 为 URL Reader 图片输出建立失败测试（TDD-RED）

**Files:**
- Modify: `packages/backend/src/utils/__tests__/url-reader.test.ts`

**Step 1: Write the failing test**
- 新增测试：当 HTML 含 `og:image` 与正文 `<img>` 时，`readUrlContent` 返回 `leadImageUrl` 与 `images[]`。
- 新增测试：`formatUrlContentForModel` 包含“图片证据”段落。

**Step 2: Run test to verify it fails**
- Run: `pnpm --filter backend test -- src/utils/__tests__/url-reader.test.ts`
- Expected: FAIL（缺少新增字段或格式化文本断言失败）。

**Step 3: Commit**
```bash
git add packages/backend/src/utils/__tests__/url-reader.test.ts
git commit -m "test: add failing tests for url-reader image evidence"
```

### Task 2: 最小实现 URL Reader 图片提取（TDD-GREEN）

**Files:**
- Modify: `packages/backend/src/utils/url-reader.ts`

**Step 1: Write minimal implementation**
- 扩展 `UrlReadResult`：`leadImageUrl`、`images`。
- 新增图片提取函数（meta + content img + URL 归一化 + 去重）。
- 在 Readability 成功路径与 crawler 回退路径填充图片字段。
- 在 `formatUrlContentForModel` 增加“图片证据”输出。

**Step 2: Run test to verify it passes**
- Run: `pnpm --filter backend test -- src/utils/__tests__/url-reader.test.ts`
- Expected: PASS。

**Step 3: Commit**
```bash
git add packages/backend/src/utils/url-reader.ts packages/backend/src/utils/__tests__/url-reader.test.ts
git commit -m "feat: add image evidence extraction to url reader"
```

### Task 3: 为 WebSearchHit 图片透传建立失败测试（TDD-RED）

**Files:**
- Create: `packages/backend/src/utils/__tests__/web-search.test.ts`

**Step 1: Write the failing test**
- 新增测试：`runWebSearch`（metaso scope=image）映射 `imageUrl`/`thumbnailUrl`。
- 新增测试：缺图字段时行为兼容（仅文本字段仍可返回）。

**Step 2: Run test to verify it fails**
- Run: `pnpm --filter backend test -- src/utils/__tests__/web-search.test.ts`
- Expected: FAIL（返回结构不含图片字段）。

**Step 3: Commit**
```bash
git add packages/backend/src/utils/__tests__/web-search.test.ts
git commit -m "test: add failing tests for web-search image mapping"
```

### Task 4: 实现 WebSearchHit 图片字段与链路透传（TDD-GREEN）

**Files:**
- Modify: `packages/backend/src/utils/web-search.ts`
- Modify: `packages/backend/src/modules/chat/tool-logs.ts`
- Modify: `packages/frontend/src/types/index.ts`

**Step 1: Write minimal implementation**
- 扩展 `WebSearchHit`：`imageUrl`、`thumbnailUrl`。
- 在 Tavily/Brave/Metaso mapping 中提取常见图片字段。
- `parseToolLogsJson` 保留新增字段。
- 前端 `WebSearchHit` 类型同步新增字段。

**Step 2: Run tests to verify pass**
- Run: `pnpm --filter backend test -- src/utils/__tests__/web-search.test.ts`
- Run: `pnpm --filter backend test -- src/utils/__tests__/url-reader.test.ts`
- Expected: PASS。

**Step 3: Commit**
```bash
git add packages/backend/src/utils/web-search.ts packages/backend/src/modules/chat/tool-logs.ts packages/frontend/src/types/index.ts packages/backend/src/utils/__tests__/web-search.test.ts
git commit -m "feat: propagate search image metadata through tool logs"
```

### Task 5: read_url 事件透传图片详情并完成验证

**Files:**
- Modify: `packages/backend/src/modules/chat/tool-handlers/url-reader-handler.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts`

**Step 1: Write minimal implementation**
- 在 `read_url` 成功事件 details 增加 `images`（截断数量，避免上下文膨胀）。
- 在搜索后自动读取 evidence 中可选增加 `images` 摘要字段。

**Step 2: Run verification suite**
- Run: `pnpm --filter backend test -- src/utils/__tests__/url-reader.test.ts src/utils/__tests__/web-search.test.ts`
- Run: `pnpm --filter backend test -- src/modules/chat/services/message-query-service.test.ts`
- Expected: PASS。

**Step 3: Commit**
```bash
git add packages/backend/src/modules/chat/tool-handlers/url-reader-handler.ts packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts
git commit -m "feat: include image evidence in read_url tool events"
```

### Task 6: 文档与迁移声明

**Files:**
- Modify: `README.md`

**Step 1: Update docs**
- 说明 `read_url` 新增图片证据能力。
- 明确迁移策略：无迁移、直接替换。

**Step 2: Verify docs references**
- Run: `rg -n "read_url|image evidence|无迁移" README.md`

**Step 3: Commit**
```bash
git add README.md
git commit -m "docs: document read_url v2 image evidence and migration strategy"
```

