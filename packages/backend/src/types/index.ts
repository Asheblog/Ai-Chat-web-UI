import type { ModelPreference } from '@aichat/shared/api-contract'

export type { ModelPreference } from '@aichat/shared/api-contract'

export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: Date;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  preferredModel?: ModelPreference | null;
  avatarUrl?: string | null;
  personalPrompt?: string | null;
}

export type Actor = UserActor | AnonymousActor;

export interface UserActor {
  type: 'user';
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  identifier: string;
  preferredModel?: ModelPreference | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  personalPrompt?: string | null;
}

export interface AnonymousActor {
  type: 'anonymous';
  key: string;
  identifier: string;
  expiresAt: Date | null;
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface ChatSession {
  id: number;
  userId: number | null;
  anonymousKey?: string | null;
  expiresAt?: Date | null;
  connectionId?: number | null;
  modelRawId?: string | null;
  title: string;
  createdAt: Date;
  messages?: Message[];
  _count?: {
    messages: number;
  };
}

export interface Message {
  id: number;
  sessionId: number;
  parentMessageId?: number | null;
  variantIndex?: number | null;
  role: 'user' | 'assistant';
  content: string;
  clientMessageId?: string | null;
  reasoning?: string | null;
  reasoningDurationSeconds?: number | null;
  createdAt: Date;
  updatedAt?: Date;
  streamStatus?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';
  streamCursor?: number;
  streamReasoning?: string | null;
  streamError?: string | null;
}

export type {
  RichMessageEvidenceConfidence,
  RichMessageEvidenceKind,
  RichMessageImagePart,
  RichMessageImageSource,
  RichMessageLayout,
  RichMessagePart,
  RichMessagePayload,
  RichMessageTextPart,
} from '@aichat/shared/rich-payload'

export interface SystemSetting {
  key: string;
  value: string;
}

export interface ChatRequest {
  sessionId: number;
  content: string;
}

export interface CreateSessionRequest {
  modelId: string;
  title?: string;
}

// 移除 Create/UpdateModelConfig 系列类型

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export type { AuthResponse, RegisterResponse } from '@aichat/shared/api-contract'

export type UsageQuotaScope = 'USER' | 'ANON';

export interface UsageQuotaSnapshot {
  scope: UsageQuotaScope;
  identifier: string;
  dailyLimit: number;
  usedCount: number;
  remaining: number | null;
  lastResetAt: Date;
  unlimited: boolean;
  customDailyLimit: number | null;
  usingDefaultLimit: boolean;
}

export interface UsageQuotaDTO {
  scope: UsageQuotaScope;
  identifier: string;
  dailyLimit: number;
  usedCount: number;
  remaining: number | null;
  lastResetAt: string;
  unlimited: boolean;
  customDailyLimit: number | null;
  usingDefaultLimit: boolean;
}

export interface ActorContext {
  actor: Actor;
  quota: UsageQuotaDTO | null;
  user?: {
    id: number;
    username: string;
    role: 'ADMIN' | 'USER';
    status: 'PENDING' | 'ACTIVE' | 'DISABLED';
    createdAt: Date;
    avatarUrl?: string | null;
    personalPrompt?: string | null;
  } | null;
  preferredModel?: ModelPreference | null;
  assistantAvatarUrl?: string | null;
}

export type { ApiResponse } from '@aichat/shared/api-contract'

export interface StreamingChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason?: string;
  }>;
}
