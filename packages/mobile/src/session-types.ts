import type { Pagination } from "@aichat/shared/api-contract";
import type { ReasoningEffort } from "./types/mobile";

export type ChatSession = {
  id: number;
  userId?: number | null;
  connectionId?: number | null;
  modelRawId?: string | null;
  modelLabel?: string | null;
  title: string;
  createdAt: string;
  pinnedAt?: string | null;
  reasoningEnabled?: boolean | null;
  reasoningEffort?: ReasoningEffort | null;
  systemPrompt?: string | null;
  knowledgeBaseIds?: number[] | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  _count?: {
    messages: number;
  };
};

export type SessionPagination = Pagination;

export type SessionListPayload = {
  sessions: ChatSession[];
  pagination: SessionPagination;
};

export type ModelItem = {
  id: string;
  rawId: string;
  name: string;
  provider: string;
  channelName?: string;
  connectionId?: number | null;
  modelType?: "chat" | "embedding" | "both";
  accessDecision?: "allow" | "deny";
  capabilities?: {
    vision?: boolean;
    reasoning?: boolean;
    toolCall?: boolean;
    imageGeneration?: boolean;
  };
  contextWindow?: number | null;
};

export type CreateSessionPayload = {
  modelId: string;
  title?: string;
  connectionId?: number;
  rawId?: string;
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  knowledgeBaseIds?: number[];
};

export type UpdateSessionPayload = {
  title?: string;
  pinned?: boolean;
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort | null;
  systemPrompt?: string | null;
  knowledgeBaseIds?: number[];
};

export type SwitchSessionModelPayload = {
  modelId: string;
  connectionId?: number;
  rawId?: string;
};
