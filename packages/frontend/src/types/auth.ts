import type { ModelPreferenceDTO } from '@aichat/shared/api-contract'
import type { ActorQuota } from '@aichat/shared/api-contract'

export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  avatarUrl?: string | null;
  personalPrompt?: string | null;
}

export type AnonymousActorProfile = {
  type: 'anonymous';
  key: string;
  identifier: string;
  expiresAt: string | null;
};

export type UserActorProfile = {
  type: 'user';
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  identifier: string;
  preferredModel?: ModelPreferenceDTO | null;
  avatarUrl?: string | null;
  personalPrompt?: string | null;
};

export type ActorProfile = AnonymousActorProfile | UserActorProfile;

export interface ActorContextDTO {
  actor: ActorProfile;
  quota: ActorQuota | null;
  user?: User | null;
  preferredModel?: ModelPreferenceDTO | null;
  assistantAvatarUrl?: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  confirmPassword?: string;
}

export interface AuthState {
  actor: ActorProfile | null;
  user: User | null;
  quota: ActorQuota | null;
  actorState: 'loading' | 'anonymous' | 'authenticated';
  isLoading: boolean;
  error: string | null;
}
