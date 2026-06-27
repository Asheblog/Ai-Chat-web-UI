export type ChatSession = {
  id: number;
  userId?: number | null;
  connectionId?: number | null;
  modelRawId?: string | null;
  modelLabel?: string | null;
  title: string;
  createdAt: string;
  pinnedAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  _count?: {
    messages: number;
  };
};

export type SessionPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

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
};

export type CreateSessionPayload = {
  modelId: string;
  title?: string;
  connectionId?: number;
  rawId?: string;
};
