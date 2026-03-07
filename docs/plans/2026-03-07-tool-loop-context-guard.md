# Tool Loop Context Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复工具调用过程中上下文膨胀导致未触发压缩并最终超限的问题。

**Architecture:** 在 agent 工具循环中新增“上下文守卫”层，对每轮发送前消息做 token 预算检查和收缩；若仍触发上游 context length 错误，执行一次激进收缩并自动重试。并同步收敛 web_search 返回给模型的工具消息体积。

**Tech Stack:** TypeScript, Jest, existing Tokenizer + chat tool orchestrator

---

### Task 1: 测试先行（失败用例）

**Files:**
- Modify: `packages/backend/src/modules/chat/__tests__/tool-orchestrator.test.ts`
- Create: `packages/backend/src/modules/chat/services/__tests__/tool-loop-context-guard.test.ts`

**Steps:**
1. 新增工具回合消息膨胀的失败测试（模拟第二轮超限）。
2. 运行定向测试确认失败。

### Task 2: 实现工具回合上下文守卫

**Files:**
- Create: `packages/backend/src/modules/chat/services/tool-loop-context-guard.ts`
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`

**Steps:**
1. 实现消息 token 估算和优先级收缩策略（保留最近轮次、收缩旧 tool 内容）。
2. 在每轮 requestTurn 前调用守卫。
3. 捕获 context length 错误后执行一次激进收缩并自动重试。

### Task 3: 收敛 web_search 工具结果内容

**Files:**
- Modify: `packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts`

**Steps:**
1. 限制 tool message 内 hits/evidence/task 字段大小和数量。
2. 保留完整细节在 tool logs，不把冗余大字段灌入模型上下文。

### Task 4: 回归验证

**Files:**
- Modify: `packages/backend/src/modules/chat/__tests__/tool-orchestrator.test.ts`
- Modify: `packages/backend/src/modules/chat/services/__tests__/tool-loop-context-guard.test.ts`

**Steps:**
1. 运行新增测试与相关模块测试。
2. 记录验证结果，确保修复前失败、修复后通过。
