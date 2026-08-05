import {
  normalizeLegacyStage,
  normalizeToolCallPhase,
  normalizeToolCallSource,
  normalizeToolCallStatus,
} from "@aichat/shared/chat-stream-parser";
import { mergeAndSortToolEvents, type ToolEvent } from "@aichat/shared/tool-events";
import { shouldIgnoreReasoningMeta } from "@aichat/shared/strip-tool-progress-from-reasoning";

import type { ChatMessage, ChatStreamChunk } from "../chat-types";

export function normalizeMessage(message: ChatMessage): ChatMessage {
  const toolEvents =
    Array.isArray(message.toolEvents) && message.toolEvents.length > 0
      ? mergeAndSortToolEvents(message.toolEvents)
      : undefined;

  return {
    ...message,
    content: contentToText(message.content),
    createdAt: String(message.createdAt),
    toolEvents,
  };
}

export function appendAssistantContent(messages: ChatMessage[], targetId: number | string, delta: string) {
  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          content: `${contentToText(message.content)}${delta}`,
          streamStatus: "streaming",
        }
      : message,
  );
}

export function appendAssistantReasoning(
  messages: ChatMessage[],
  targetId: number | string,
  delta: string,
  meta?: Record<string, unknown> | null,
) {
  if (shouldIgnoreReasoningMeta(meta)) {
    return messages;
  }

  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          reasoning: `${message.reasoning ?? ""}${delta}`,
          streamStatus: "streaming",
        }
      : message,
  );
}

export function appendAssistantToolCall(
  messages: ChatMessage[],
  targetId: number | string,
  chunk: ChatStreamChunk,
  sessionId: number,
) {
  return messages.map((message) => {
    if (message.id !== targetId) {
      return message;
    }

    const nowMs = Date.now();
    const rawCallId =
      typeof chunk.callId === "string" && chunk.callId.trim().length > 0
        ? chunk.callId.trim()
        : typeof chunk.id === "string" && chunk.id.trim().length > 0
          ? chunk.id.trim()
          : "";
    const eventId = rawCallId || `tool:${sessionId}:${nowMs}`;
    const existing = message.toolEvents ?? [];
    const idx = existing.findIndex((item) => {
      if (rawCallId && item.callId === rawCallId) {
        return true;
      }
      return item.id === eventId;
    });
    const previous = idx === -1 ? null : existing[idx];

    const phase = normalizeToolCallPhase(chunk.phase, chunk.status, chunk.stage);
    const stage = normalizeLegacyStage(chunk.stage, phase);
    const status = normalizeToolCallStatus(chunk.status, phase, stage);
    const source = normalizeToolCallSource(chunk.source);

    const reasoningLengthAtEvent = Math.max(0, (message.reasoning ?? "").length);
    const detailPayload = chunk.details && typeof chunk.details === "object" ? chunk.details : undefined;
    const prevDetails = previous?.details;
    const mergedDetails: NonNullable<ToolEvent["details"]> = {
      ...(prevDetails ?? {}),
      ...(detailPayload ? { ...detailPayload } : {}),
    };

    if (typeof chunk.argumentsText === "string") {
      mergedDetails.argumentsText = chunk.argumentsText;
    }
    if (typeof chunk.argumentsPatch === "string") {
      mergedDetails.argumentsPatch = chunk.argumentsPatch;
    }
    if (typeof chunk.resultText === "string") {
      mergedDetails.resultText = chunk.resultText;
    }
    if (typeof chunk.resultJson !== "undefined") {
      mergedDetails.resultJson = chunk.resultJson;
    }

    const hasStartOffset =
      typeof mergedDetails.reasoningOffsetStart === "number" &&
      Number.isFinite(mergedDetails.reasoningOffsetStart) &&
      mergedDetails.reasoningOffsetStart >= 0;
    if (!hasStartOffset && (stage === "start" || idx === -1)) {
      mergedDetails.reasoningOffsetStart = reasoningLengthAtEvent;
    }

    const hasEndOffset =
      typeof mergedDetails.reasoningOffsetEnd === "number" &&
      Number.isFinite(mergedDetails.reasoningOffsetEnd) &&
      mergedDetails.reasoningOffsetEnd >= 0;
    if (!hasEndOffset && (stage === "result" || stage === "error")) {
      mergedDetails.reasoningOffsetEnd = reasoningLengthAtEvent;
    }

    if (
      typeof mergedDetails.reasoningOffset !== "number" ||
      !Number.isFinite(mergedDetails.reasoningOffset) ||
      mergedDetails.reasoningOffset < 0
    ) {
      mergedDetails.reasoningOffset = mergedDetails.reasoningOffsetStart;
    }

    const identifier =
      typeof chunk.identifier === "string" && chunk.identifier.trim().length > 0
        ? chunk.identifier.trim()
        : typeof chunk.apiName === "string" && chunk.apiName.trim().length > 0
          ? chunk.apiName.trim()
          : previous?.identifier;
    const toolName = identifier || previous?.tool || "web_search";
    const apiName =
      typeof chunk.apiName === "string" && chunk.apiName.trim().length > 0
        ? chunk.apiName.trim()
        : previous?.apiName || identifier || toolName;

    const next: ToolEvent = {
      id: eventId,
      sessionId,
      messageId: message.id,
      tool: toolName,
      stage,
      status: status ?? "running",
      query: typeof chunk.query === "string" ? chunk.query : previous?.query,
      hits: (Array.isArray(chunk.hits) ? chunk.hits : previous?.hits) as ToolEvent["hits"],
      error: typeof chunk.error === "string" ? chunk.error : previous?.error,
      summary: typeof chunk.summary === "string" ? chunk.summary : previous?.summary,
      createdAt: previous?.createdAt ?? nowMs,
      details: Object.keys(mergedDetails).length > 0 ? mergedDetails : undefined,
      callId: rawCallId || previous?.callId || eventId,
      identifier: identifier || undefined,
      apiName: apiName || undefined,
      source: source ?? previous?.source,
      phase: phase ?? previous?.phase,
      argumentsText:
        typeof chunk.argumentsText === "string" ? chunk.argumentsText : previous?.argumentsText,
      argumentsPatch:
        typeof chunk.argumentsPatch === "string" ? chunk.argumentsPatch : previous?.argumentsPatch,
      resultText: typeof chunk.resultText === "string" ? chunk.resultText : previous?.resultText,
      resultJson: typeof chunk.resultJson !== "undefined" ? chunk.resultJson : previous?.resultJson,
      intervention:
        chunk.intervention && typeof chunk.intervention === "object"
          ? chunk.intervention
          : previous?.intervention,
      thoughtSignature:
        typeof chunk.thoughtSignature === "string" || chunk.thoughtSignature === null
          ? chunk.thoughtSignature
          : previous?.thoughtSignature,
      updatedAt: nowMs,
    };

    const list = existing.slice();
    if (idx === -1) {
      list.push(next);
    } else {
      list[idx] = {
        ...previous,
        ...next,
      };
    }

    return {
      ...message,
      toolEvents: mergeAndSortToolEvents(list),
      streamStatus: "streaming",
    };
  });
}

export function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object") {
    const maybeText =
      (content as { text?: unknown; content?: unknown }).text ??
      (content as { content?: unknown }).content;
    if (typeof maybeText === "string") {
      return maybeText;
    }
  }
  return "";
}
