# 合并 OpenAI Thinking Dialect 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development to implement this plan task-by-task.

**Goal:** 删除交错思考模板卡，用连接组 `thinkingDialect` 表达 DeepSeek 兼容 thinking 参数注入。

**Architecture:** Prisma 新增 `thinkingDialect`；数据迁移清空 vendor；请求构造读 dialect；前端 3 卡 + OpenAI 编辑器开关；baseUrl 启发默认值。

**Tech Stack:** TypeScript、Prisma/SQLite、Vitest、React。

---

### Task 1: Shared thinking dialect helpers + failing tests

**Files:**
- Create: `packages/shared/src/thinking-dialect.ts`（若 shared 不合适则放 backend utils 并在 frontend 镜像纯函数）
- Test: 对应 `*.test.ts`

行为：
- `normalizeThinkingDialect(value) → 'off' | 'deepseek_compat'`
- `inferThinkingDialectFromBaseUrl(url) → dialect`（host 含 deepseek / siliconflow → deepseek_compat）
- `migrateVendorToThinkingDialect(vendor) → dialect`

### Task 2: Prisma migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/<ts>_thinking_dialect/migration.sql`

SQL：
1. ADD COLUMN `thinking_dialect` TEXT NOT NULL DEFAULT 'off'
2. UPDATE … SET thinking_dialect='deepseek_compat' WHERE vendor IN ('deepseek','openai_interleave')
3. UPDATE … SET vendor=NULL WHERE vendor IN ('deepseek','openai_interleave')

### Task 3: Backend connection API/service

去掉 VendorType 写入；Payload/View 使用 `thinkingDialect`；签名用 dialect 替代 vendor；create 时若未显式传 dialect 则 URL 启发。

### Task 4: Request builder + vision

`applyReasoningOptions` / vision 镜像：按 `thinkingDialect === 'deepseek_compat'` 注入 thinking，不再读 vendor。

### Task 5: Frontend templates + form + editor

3 卡；表单字段 `thinkingDialect`；OpenAI provider 显示开关；创建/编辑/保存/标签；删 interleave 常量与测试断言。

### Task 6: Docs

更新 `CONTEXT.md`、ADR（0036）、必要时改 0035 措辞中「交错思考供应商配置」。

### Task 7: Verify

定向单测 + 相关包 typecheck；修复失败项。
