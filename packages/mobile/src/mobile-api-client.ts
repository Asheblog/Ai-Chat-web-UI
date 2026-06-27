import type { AuthSession, MobileUser, RegisterResult } from "./auth-types";
import type { ChatStreamChunk, MessageListPayload, StreamMessagePayload } from "./chat-types";
import type { ChatSession, CreateSessionPayload, ModelItem, SessionListPayload } from "./session-types";

type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type AuthPayload = {
  user?: MobileUser;
  token?: string;
};

type ApiClientOptions = {
  endpoint: string;
  getToken?: () => string | null;
  onUnauthorized?: () => void | Promise<void>;
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
  private readonly onUnauthorized?: () => void | Promise<void>;

  constructor(options: ApiClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
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
      await this.onUnauthorized?.();
      throw new UnauthorizedApiError();
    }

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new MobileApiError(message ?? `发送失败，服务端返回 ${response.status}。`, response.status);
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new MobileApiError("当前 Expo Go 运行环境不支持流式读取，请升级 Expo Go 或使用兼容的开发构建。");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    try {
      let terminated = false;
      while (!terminated) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) {
              break;
            }

            const rawLine = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            const line = rawLine.replace(/\r$/, "");
            if (!line || line.startsWith(":") || !line.startsWith("data:")) {
              continue;
            }

            const payload = line.slice(5).trimStart();
            if (!payload) {
              continue;
            }
            if (payload === "[DONE]") {
              completed = true;
              terminated = true;
              break;
            }

            const chunk = parseStreamPayload(payload);
            if (!chunk) {
              continue;
            }

            yield chunk;

            if (chunk.type === "complete") {
              completed = true;
            }
            if (chunk.type === "error") {
              completed = true;
              terminated = true;
              break;
            }
          }
        }

        if (done) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
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

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (options.authenticated) {
      const token = this.getToken?.() ?? null;
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
      await this.onUnauthorized?.();
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

function parseStreamPayload(payload: string): ChatStreamChunk | null {
  let parsed: any;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const executionChunk = normalizeExecutionEvent(parsed);
  if (executionChunk) {
    return executionChunk;
  }

  if (parsed?.type === "content" && typeof parsed.content === "string" && parsed.content.length > 0) {
    return { type: "content", content: parsed.content };
  }

  if (parsed?.type === "reasoning") {
    if (typeof parsed.content === "string" && parsed.content.length > 0) {
      return { type: "reasoning", content: parsed.content };
    }
    if (parsed.done) {
      return { type: "reasoning", done: true };
    }
    if (parsed.keepalive) {
      return { type: "reasoning", keepalive: true };
    }
  }

  if (parsed?.type === "start") {
    return {
      type: "start",
      messageId: asNumber(parsed.messageId ?? parsed.message_id),
      assistantMessageId: asNumber(parsed.assistantMessageId ?? parsed.assistant_message_id),
      assistantClientMessageId: asNonEmptyString(parsed.assistantClientMessageId ?? parsed.assistant_client_message_id),
    };
  }

  if (parsed?.type === "complete") {
    return {
      type: "complete",
      content: typeof parsed.content === "string" ? parsed.content : undefined,
    };
  }

  if (parsed?.type === "error" || typeof parsed?.error === "string") {
    return {
      type: "error",
      error: asNonEmptyString(parsed.error) ?? "生成失败，请稍后重试。",
      suggestion: asNonEmptyString(parsed.suggestion) ?? undefined,
    };
  }

  return null;
}

function normalizeExecutionEvent(payload: any): ChatStreamChunk | null {
  const eventType = asNonEmptyString(payload?.type);
  const eventPayload = isRecord(payload?.payload) ? payload.payload : {};

  if (eventType === "step_delta") {
    const channel = asNonEmptyString(eventPayload.channel);
    const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
    if (!delta) {
      return null;
    }
    if (channel === "content") {
      return { type: "content", content: delta };
    }
    if (channel === "reasoning") {
      return { type: "reasoning", content: delta };
    }
  }

  if (eventType === "step_start") {
    const metadata = isRecord(eventPayload.metadata) ? eventPayload.metadata : {};
    const stepId = asNonEmptyString(payload?.stepId);
    return {
      type: "start",
      messageId: asNumber(metadata.userMessageId ?? metadata.messageId),
      assistantMessageId: asNumber(metadata.assistantMessageId) ?? assistantIdFromStepId(stepId),
      assistantClientMessageId: asNonEmptyString(metadata.assistantClientMessageId),
    };
  }

  if (eventType === "run_complete") {
    return { type: "complete" };
  }

  if (eventType === "run_error") {
    return {
      type: "error",
      error: asNonEmptyString(eventPayload.message) ?? "生成失败，请稍后重试。",
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function assistantIdFromStepId(stepId: string | null) {
  if (!stepId) {
    return null;
  }
  const match = /^assistant:(\d+)$/.exec(stepId);
  return match ? asNumber(match[1]) : null;
}
