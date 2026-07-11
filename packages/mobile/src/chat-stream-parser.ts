import type { ChatStreamChunk } from "./chat-types";

export type ParsedStreamBatch = {
  chunks: ChatStreamChunk[];
  completed: boolean;
  remaining: string;
  terminated: boolean;
};

export function parseStreamLines(buffer: string, flush = false): ParsedStreamBatch {
  const chunks: ChatStreamChunk[] = [];
  let completed = false;
  let terminated = false;
  let remaining = buffer;

  while (!terminated) {
    const newlineIndex = remaining.indexOf("\n");
    if (newlineIndex === -1 && !flush) {
      break;
    }

    const rawLine = newlineIndex === -1 ? remaining : remaining.slice(0, newlineIndex);
    remaining = newlineIndex === -1 ? "" : remaining.slice(newlineIndex + 1);
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":") || !line.startsWith("data:")) {
      if (newlineIndex === -1) {
        break;
      }
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

    chunks.push(chunk);
    if (chunk.type === "complete") {
      completed = true;
    }
    if (chunk.type === "error") {
      completed = true;
      terminated = true;
    }
  }

  return { chunks, completed, remaining, terminated };
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
    if (parsed.done) return { type: "reasoning", done: true };
    if (parsed.keepalive) return { type: "reasoning", keepalive: true };
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
    return { type: "complete", content: typeof parsed.content === "string" ? parsed.content : undefined };
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
    if (!delta) return null;
    if (channel === "content") return { type: "content", content: delta };
    if (channel === "reasoning") return { type: "reasoning", content: delta };
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
  if (eventType === "run_complete") return { type: "complete" };
  if (eventType === "run_error") {
    return { type: "error", error: asNonEmptyString(eventPayload.message) ?? "生成失败，请稍后重试。" };
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function assistantIdFromStepId(stepId: string | null) {
  if (!stepId) return null;
  const match = /^assistant:(\d+)$/.exec(stepId);
  return match ? asNumber(match[1]) : null;
}
