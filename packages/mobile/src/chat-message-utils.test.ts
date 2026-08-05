import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./chat-types";
import {
  appendAssistantReasoning,
  appendAssistantToolCall,
  normalizeMessage,
} from "./screens/chat-message-utils";

const baseMessage: ChatMessage = {
  id: "assistant-1",
  sessionId: 1,
  role: "assistant",
  content: "",
  clientMessageId: null,
  createdAt: "2026-08-05T00:00:00.000Z",
};

describe("chat-message-utils", () => {
  it("ignores reasoning chunks tagged as tool progress", () => {
    const messages = [baseMessage];
    const next = appendAssistantReasoning(messages, "assistant-1", "should-not-append", { kind: "tool" });

    expect(next[0].reasoning).toBeUndefined();
  });

  it("merges tool_call chunks into assistant toolEvents", () => {
    const withReasoning = appendAssistantReasoning([baseMessage], "assistant-1", "thinking");
    const next = appendAssistantToolCall(withReasoning, "assistant-1", {
      type: "tool_call",
      callId: "call-1",
      identifier: "web_search",
      stage: "start",
      status: "running",
      query: "weather",
    }, 1);

    expect(next[0].toolEvents).toHaveLength(1);
    expect(next[0].toolEvents?.[0]).toMatchObject({
      callId: "call-1",
      tool: "web_search",
      query: "weather",
      details: { reasoningOffsetStart: 8 },
    });

    const merged = appendAssistantToolCall(next, "assistant-1", {
      type: "tool_call",
      callId: "call-1",
      identifier: "web_search",
      stage: "result",
      status: "success",
      summary: "3 hits",
    }, 1);

    expect(merged[0].toolEvents).toHaveLength(1);
    expect(merged[0].toolEvents?.[0]).toMatchObject({
      callId: "call-1",
      stage: "result",
      status: "success",
      summary: "3 hits",
      details: {
        reasoningOffsetStart: 8,
        reasoningOffsetEnd: 8,
      },
    });
  });

  it("normalizes history toolEvents from API payloads", () => {
    const normalized = normalizeMessage({
      ...baseMessage,
      toolEvents: [
        {
          id: "call-b",
          sessionId: 1,
          messageId: "assistant-1",
          tool: "web_search",
          stage: "start",
          status: "running",
          createdAt: 200,
          details: { reasoningOffsetStart: 0 },
        },
        {
          id: "call-a",
          sessionId: 1,
          messageId: "assistant-1",
          tool: "read_url",
          stage: "result",
          status: "success",
          createdAt: 100,
          details: { reasoningOffsetStart: 0 },
        },
      ],
    });

    expect(normalized.toolEvents?.map((event) => event.id)).toEqual(["call-a", "call-b"]);
  });
});
