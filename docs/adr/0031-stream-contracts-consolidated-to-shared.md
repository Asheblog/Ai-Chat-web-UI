---
status: accepted
---

# 流式协议/ToolEvent 归一化收敛至 @aichat/shared

web 前端（`features/chat/api/stream-reader.ts`）、battle（`features/battle/api.ts` ×2）、移动端（`mobile/chat-stream-parser.ts`）各自维护一套 SSE 解析与 ToolEvent phase/status 推断，导致三端对同一服务端事件可能产出不同状态，且移动端解析器是子集，会静默丢弃 `tool_call` / `image` / `usage` 事件。

因此约定：流式归一化（`chat-stream-parser` / `chat-stream-contract`）与 ToolEvent 合并/排序/摘要（`tool-events`）统一收敛至 `@aichat/shared`，web 与 mobile 复用同一实现；前端旧 `stream-reader.ts` / `tool-event-utils.ts` 降级为薄转发层（兼容导入面）。服务端仍发射既有 execution SSE（`execution-contract.ts`），协议不因本次收敛而变更。

收敛点：
- `@aichat/shared/chat-stream-parser`：SSE 帧解析 + execution/legacy 事件归一化（mobile 子集缺口一并补齐）
- `@aichat/shared/tool-events`：resolveEventStatus / mergeToolEvents / compareToolEvents / buildToolSummary
- `@aichat/shared/stream-message-reducer`：ChatStreamChunk → 消息 content / reasoning / ToolEvent 的增量归约（upsertToolEventFromChunk 等）
- battle 的 `BattleStreamEvent` 协议与 ChatStreamChunk 不同，`battle/api.ts` 私有 SSE 循环保留，不强制合并；battle 的 phase/status/stage/source 归一化复用 chat-stream-parser

行为说明：
- legacy `payload.error`（无 `type` 字段）由旧实现的抛异常改为返回 `{ type: 'error' }` chunk；`parseStreamLines` 据此将错误事件视为终止
- `resolveMaxToolIterations` 对 `agent_max_tool_iterations=0` 统一为「无限制」（旧 chat 端误处理为 0 禁用，与 `.env` 注释及 battle 端语义对齐）
