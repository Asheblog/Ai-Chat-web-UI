import type { GeneratedImage, ChatStreamChunk } from "@aichat/shared/chat-stream-contract";
import type { ToolEvent } from "@aichat/shared/tool-events";
import type { Pagination } from "@aichat/shared/api-contract";
import type { ReasoningEffort } from "./types/mobile";

export type ChatMessageRole = "user" | "assistant" | "system" | "compressedGroup";

export type ChatMessage = {
  id: number | string;
  sessionId: number;
  role: ChatMessageRole | string;
  content: string;
  clientMessageId: string | null;
  reasoning?: string | null;
  toolEvents?: ToolEvent[];
  images?: string[];
  generatedImages?: GeneratedImage[];
  replyToMessageId?: number | null;
  streamStatus?: string | null;
  streamError?: string | null;
  createdAt: string;
};

export type MessagePagination = Pagination;

export type MessageListPayload = {
  messages: ChatMessage[];
  pagination: MessagePagination;
};

export type { ChatStreamChunk };

export type StreamMessagePayload = {
  sessionId: number;
  content?: string;
  clientMessageId: string;
  replyToMessageId?: number;
  images?: Array<{ data: string; mime: string }>;
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  contextEnabled?: boolean;
  skills?: {
    builtin?: string[];
    enabled?: Array<{
      skillId: number;
      versionId: number;
      overrides?: Record<string, unknown>;
    }>;
  };
  knowledgeBaseIds?: number[];
};
