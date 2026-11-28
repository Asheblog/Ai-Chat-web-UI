import { readSseStream } from "@aichat/shared/sse-reader";
import type { ApiResponse } from "@aichat/shared/api-contract";

import type { AuthSession, MobileUser, RegisterResult } from "./auth-types";
import { parseStreamLines } from "./chat-stream-parser";
import type { ChatStreamChunk, MessageListPayload, StreamMessagePayload } from "./chat-types";
import type {
  ChatSession,
  CreateSessionPayload,
  ModelItem,
  SessionListPayload,
  SwitchSessionModelPayload,
  UpdateSessionPayload,
} from "./session-types";
import type {
  AppInfo,
  BrandingInfo,
  KnowledgeBaseItem,
  McpSessionTool,
  PersonalSettings,
  SessionDocumentItem,
  SkillOptionItem,
} from "./types/mobile";

type AuthPayload = {
  user?: MobileUser;
  token?: string;
};

type ApiClientOptions = {
  endpoint: string;
  getToken?: () => string | null;
  onUnauthorized?: (failedToken: string) => void | Promise<void>;
};

type RequestOptions = {
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  authenticated?: boolean;
};

type StreamRequestOptions = {
  body: StreamMessagePayload;
  signal?: AbortSignal;
};

export type PersonalSettingsUpdatePayload = {
  preferred_model?: {
    modelId: string;
    connectionId: number | null;
    rawId: string;
  } | null;
  personal_prompt?: string | null;
  context_enabled?: boolean;
  username?: string;
};

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class UnauthorizedApiError extends MobileApiError {
  constructor(message = "登录状态已失效，请重新登录。") {
    super(message, 401);
    this.name = "UnauthorizedApiError";
  }
}

export class MobileApiClient {
  private readonly endpoint: string;
  private readonly getToken?: () => string | null;
  private readonly onUnauthorized?: (failedToken: string) => void | Promise<void>;

  constructor(options: ApiClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  getEndpoint() {
    return this.endpoint;
  }

  async getBranding(): Promise<BrandingInfo> {
    return this.request<BrandingInfo>("/api/settings/branding");
  }

  async getAppInfo(): Promise<AppInfo> {
    return this.request<AppInfo>("/api/settings/app-info");
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const payload = await this.request<AuthPayload>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });

    if (!payload.user || !payload.token) {
      throw new MobileApiError("登录响应缺少认证信息，请稍后重试。");
    }

    return { user: payload.user, token: payload.token };
  }

  async register(username: string, password: string): Promise<RegisterResult> {
    const payload = await this.request<AuthPayload>("/api/auth/register", {
      method: "POST",
      body: { username, password },
    });

    if (!payload.user) {
      throw new MobileApiError("注册响应缺少用户信息，请稍后重试。");
    }

    if (payload.token) {
      return {
        kind: "signed-in",
        session: { user: payload.user, token: payload.token },
      };
    }

    return {
      kind: "pending",
      user: payload.user,
      message: "注册已提交，请等待管理员审批后再登录。",
    };
  }

  async getCurrentUser(): Promise<MobileUser> {
    const user = await this.request<MobileUser>("/api/auth/me", {
      authenticated: true,
    });

    if (!user) {
      throw new MobileApiError("无法读取当前用户信息。");
    }

    return user;
  }

  async logout(): Promise<void> {
    await this.request<void>("/api/auth/logout", {
      method: "POST",
      authenticated: true,
    });
  }

  async getSessions(page = 1, limit = 100): Promise<SessionListPayload> {
    return this.request<SessionListPayload>(`/api/sessions?page=${page}&limit=${limit}`, {
      authenticated: true,
    });
  }

  async getModels(): Promise<ModelItem[]> {
    return this.request<ModelItem[]>("/api/catalog/models", {
      authenticated: true,
    });
  }

  async createSession(payload: CreateSessionPayload): Promise<ChatSession> {
    return this.request<ChatSession>("/api/sessions", {
      method: "POST",
      authenticated: true,
      body: payload,
    });
  }

  async updateSession(sessionId: number, updates: UpdateSessionPayload): Promise<ChatSession> {
    return this.request<ChatSession>(`/api/sessions/${sessionId}`, {
      method: "PUT",
      authenticated: true,
      body: updates,
    });
  }

  async switchSessionModel(sessionId: number, payload: SwitchSessionModelPayload): Promise<ChatSession> {
    return this.request<ChatSession>(`/api/sessions/${sessionId}/model`, {
      method: "PUT",
      authenticated: true,
      body: payload,
    });
  }

  async deleteSession(sessionId: number): Promise<void> {
    await this.request<void>(`/api/sessions/${sessionId}`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  async clearSessionMessages(sessionId: number): Promise<void> {
    await this.request<void>(`/api/sessions/${sessionId}/messages`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  async getMessages(sessionId: number, limit = 100): Promise<MessageListPayload> {
    return this.request<MessageListPayload>(
      `/api/chat/sessions/${sessionId}/messages?page=latest&limit=${limit}`,
      { authenticated: true },
    );
  }

  async *streamMessage(options: StreamRequestOptions): AsyncGenerator<ChatStreamChunk, void, unknown> {
    const token = this.getToken?.() ?? null;
    if (!token) {
      throw new UnauthorizedApiError();
    }

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/api/chat/stream`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new MobileApiError("无法连接服务端，请确认网络和服务端地址。");
    }

    if (response.status === 401) {
      await this.onUnauthorized?.(token);
      throw new UnauthorizedApiError();
    }

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new MobileApiError(message ?? `发送失败，服务端返回 ${response.status}。`, response.status);
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      throw new MobileApiError("当前运行环境不支持流式读取，请使用独立安装构建。");
    }

    let completed = false;

    for await (const line of readSseStream(response)) {
      const parsed = parseStreamLines(`${line}\n`);
      completed ||= parsed.completed;
      for (const chunk of parsed.chunks) {
        yield chunk;
      }
      if (parsed.terminated) {
        break;
      }
    }

    if (!completed) {
      throw new MobileApiError("流式回复已中断，请重试。");
    }
  }

  async cancelStream(sessionId: number, clientMessageId: string, messageId?: number | null): Promise<void> {
    const body: Record<string, unknown> = { sessionId, clientMessageId };
    if (typeof messageId === "number" && Number.isFinite(messageId)) {
      body.messageId = messageId;
    }

    await this.request<void>("/api/chat/stream/cancel", {
      method: "POST",
      authenticated: true,
      body,
    });
  }

  async stopTools(sessionId: number, clientMessageId?: string, messageId?: number | null): Promise<void> {
    const body: Record<string, unknown> = { sessionId };
    if (clientMessageId) body.clientMessageId = clientMessageId;
    if (typeof messageId === "number" && Number.isFinite(messageId)) {
      body.messageId = messageId;
    }

    await this.request<void>("/api/chat/stream/stop-tools", {
      method: "POST",
      authenticated: true,
      body,
    });
  }

  async regenerateMessage(sessionId: number, messageId: number): Promise<{ userMessageId: number }> {
    return this.request<{ userMessageId: number }>("/api/chat/regenerate", {
      method: "POST",
      authenticated: true,
      body: { sessionId, messageId },
    });
  }

  async uploadDocument(
    file: { uri: string; name: string; mimeType?: string },
    sessionId?: number,
  ): Promise<{ documentId: number; filename?: string; originalName?: string }> {
    const token = this.getToken?.() ?? null;
    if (!token) {
      throw new UnauthorizedApiError();
    }

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || "application/octet-stream",
    } as unknown as Blob);

    if (typeof sessionId === "number" && Number.isFinite(sessionId)) {
      formData.append("sessionId", String(sessionId));
    }

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/api/documents/upload`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
    } catch {
      throw new MobileApiError("上传文档失败，请检查网络和服务端地址。");
    }

    let body: ApiResponse<{ documentId: number; filename?: string; originalName?: string }> | null = null;
    try {
      body = (await response.json()) as ApiResponse<{ documentId: number; filename?: string; originalName?: string }>;
    } catch {
      body = null;
    }

    if (response.status === 401) {
      await this.onUnauthorized?.(token);
      throw new UnauthorizedApiError(body?.error);
    }

    if (!response.ok || body?.success === false || !body?.data) {
      throw new MobileApiError(body?.error ?? `文档上传失败（${response.status}）。`, response.status);
    }

    return body.data;
  }

  async getSessionDocuments(sessionId: number): Promise<SessionDocumentItem[]> {
    return this.request<SessionDocumentItem[]>(`/api/documents/session/${sessionId}`, {
      authenticated: true,
    });
  }

  async detachDocument(documentId: number, sessionId: number): Promise<void> {
    await this.request<void>(`/api/documents/${documentId}/detach/${sessionId}`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  async getKnowledgeBases(): Promise<KnowledgeBaseItem[]> {
    return this.request<KnowledgeBaseItem[]>("/api/knowledge-bases", {
      authenticated: true,
    });
  }

  async getSessionSkillOptions(sessionId: number): Promise<SkillOptionItem[]> {
    const data = await this.request<{ items?: SkillOptionItem[] }>(
      `/api/skills/session-options?sessionId=${sessionId}`,
      { authenticated: true },
    );
    return Array.isArray(data?.items) ? data.items : [];
  }

  async updateSessionSkillBinding(
    sessionId: number,
    body: { skillId: number; versionId: number; enabled: boolean },
  ): Promise<void> {
    await this.request<unknown>(`/api/skills/sessions/${sessionId}`, {
      method: "PUT",
      body,
      authenticated: true,
    });
  }

  async getSessionMcpTools(sessionId: number): Promise<McpSessionTool[]> {
    const data = await this.request<McpSessionTool[]>(`/api/mcp/sessions/${sessionId}/tools`, {
      authenticated: true,
    });
    return Array.isArray(data) ? data : [];
  }

  async getPersonalSettings(): Promise<PersonalSettings> {
    return this.request<PersonalSettings>("/api/settings/personal", {
      authenticated: true,
    });
  }

  async updatePersonalSettings(payload: PersonalSettingsUpdatePayload): Promise<PersonalSettings> {
    return this.request<PersonalSettings>("/api/settings/personal", {
      method: "PUT",
      authenticated: true,
      body: payload,
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const token = options.authenticated ? this.getToken?.() ?? null : null;
    if (options.authenticated) {
      if (!token) {
        throw new UnauthorizedApiError();
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new MobileApiError("无法连接服务端，请确认网络和服务端地址。");
    }

    let body: ApiResponse<T> | null = null;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      body = null;
    }

    if (response.status === 401) {
      if (token) await this.onUnauthorized?.(token);
      throw new UnauthorizedApiError(body?.error);
    }

    if (!response.ok || body?.success === false) {
      throw new MobileApiError(body?.error ?? `请求失败，服务端返回 ${response.status}。`, response.status);
    }

    return body?.data as T;
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as ApiResponse;
    return body.error ?? body.message ?? null;
  } catch {
    return null;
  }
}
