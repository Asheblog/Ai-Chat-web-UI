import { describe, expect, it } from "vitest";

import { parseStreamLines } from "./chat-stream-parser";

describe("parseStreamLines", () => {
  it("recognizes a complete final event even when the stream ends without a newline", () => {
    const result = parseStreamLines('data: {"type":"complete","content":"done"}', true);

    expect(result.completed).toBe(true);
    expect(result.remaining).toBe("");
    expect(result.chunks).toEqual([{ type: "complete", content: "done" }]);
  });

  it("keeps an incomplete final event buffered until more bytes arrive", () => {
    const first = parseStreamLines('data: {"type":"complete"');
    expect(first.completed).toBe(false);
    expect(first.chunks).toEqual([]);

    const second = parseStreamLines(`${first.remaining}}\n`);
    expect(second.completed).toBe(true);
    expect(second.chunks).toEqual([{ type: "complete", content: undefined }]);
  });

  it("does not treat a content-only closed stream as completed", () => {
    const result = parseStreamLines('data: {"type":"content","content":"partial"}', true);

    expect(result.completed).toBe(false);
    expect(result.chunks).toEqual([{ type: "content", content: "partial" }]);
  });
});
