import type { ToolEvent } from "@aichat/shared/tool-events";

export type ChatMessageRole = "user" | "assistant" | "system" | "compressedGroup";

export type ChatMessage = {
  id: number | string;
  sessionId: number;
  role: ChatMessageRole | string;
  content: string;
  clientMessageId: string | null;
  reasoning?: string | null;
  toolEvents?: ToolEvent[];
  streamStatus?: string | null;
  streamError?: string | null;
  createdAt: string;
};

export type MessagePagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type MessageListPayload = {
  messages: ChatMessage[];
  pagination: MessagePagination;
};

// 流式 chunk 类型已收敛至 @aichat/shared/chat-stream-contract（web / mobile 共用）。
// 相比旧本地 union 子集，现支持 tool_call / image / artifact / usage / quota 等全量事件。
export type { ChatStreamChunk } from "@aichat/shared/chat-stream-contract";

export type StreamMessagePayload = {
  sessionId: number;
  content: string;
  clientMessageId: string;
  reasoningEnabled?: boolean;
  contextEnabled?: boolean;
};
