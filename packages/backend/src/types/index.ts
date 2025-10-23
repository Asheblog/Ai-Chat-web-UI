export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: Date;
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

export interface ModelConfig {
  id: number;
  userId?: number | null;
  name: string;
  apiUrl: string;
  apiKey: string; // 加密存储
  supportsImages?: boolean; // 是否支持图片输入（Vision）
  createdAt: Date;
}

export interface ChatSession {
  id: number;
  userId: number;
  modelConfigId?: number | null;
  connectionId?: number | null;
  modelRawId?: string | null;
  title: string;
  createdAt: Date;
  modelConfig?: ModelConfig | null;
  messages?: Message[];
  _count?: {
    messages: number;
  };
}

export interface Message {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

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

export interface CreateModelConfigRequest {
  name: string;
  apiUrl: string;
  apiKey: string;
}

export interface UpdateModelConfigRequest {
  name?: string;
  apiUrl?: string;
  apiKey?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: Omit<User, 'createdAt'>;
  token: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

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
