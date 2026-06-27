export type ChatMessageRole = "user" | "assistant" | "system" | "compressedGroup";

export type ChatMessage = {
  id: number | string;
  sessionId: number;
  role: ChatMessageRole | string;
  content: string;
  clientMessageId: string | null;
  reasoning?: string | null;
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

export type ChatStreamChunk =
  | {
      type: "start";
      messageId?: number | null;
      assistantMessageId?: number | null;
      assistantClientMessageId?: string | null;
    }
  | {
      type: "content";
      content: string;
    }
  | {
      type: "reasoning";
      content?: string;
      done?: boolean;
      keepalive?: boolean;
    }
  | {
      type: "complete";
      content?: string;
    }
  | {
      type: "error";
      error: string;
      suggestion?: string;
    };

export type StreamMessagePayload = {
  sessionId: number;
  content: string;
  clientMessageId: string;
  reasoningEnabled?: boolean;
  contextEnabled?: boolean;
};
