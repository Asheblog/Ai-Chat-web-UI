// 流式 SSE 解析已收敛至 @aichat/shared/chat-stream-parser（web / mobile 共用）。
// 相比旧本地子集，现支持 tool_call / image / artifact / usage / quota 等全量事件归一化。
export { parseStreamLines } from "@aichat/shared/chat-stream-parser";
export type { ParsedStreamBatch } from "@aichat/shared/chat-stream-parser";
