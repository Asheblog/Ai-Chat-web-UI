import { describe, expect, it } from "vitest";

import type { ChatSession, SessionListPayload } from "../session-types";
import { loadAllSessions } from "./workspace-session-loader";

const session = (id: number): ChatSession => ({
  id,
  title: `会话 ${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const page = (sessions: ChatSession[], totalPages: number): SessionListPayload => ({
  sessions,
  pagination: { page: 1, limit: 100, total: sessions.length, totalPages },
});

describe("loadAllSessions", () => {
  it("加载全部会话分页并按 id 去重（基线能力回归）", async () => {
    const requests: number[] = [];
    const source = {
      async getSessions(pageNumber = 1): Promise<SessionListPayload> {
        requests.push(pageNumber);
        if (pageNumber === 1) return page([session(1), session(2)], 3);
        if (pageNumber === 2) return page([session(2), session(3)], 3);
        return page([session(4)], 3);
      },
    };

    const result = await loadAllSessions(source);

    expect(requests).toEqual([1, 2, 3]);
    expect(result.sessions.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(result.incomplete).toBe(false);
  });

  it("不设页数上限（旧 20 页上限回归）", async () => {
    const source = {
      async getSessions(pageNumber = 1): Promise<SessionListPayload> {
        return page([session(pageNumber)], 25);
      },
    };

    const result = await loadAllSessions(source);

    expect(result.sessions).toHaveLength(25);
    expect(result.sessions[24].id).toBe(25);
    expect(result.incomplete).toBe(false);
  });

  it("后续分页失败时保留已读页并标记不完整", async () => {
    const source = {
      async getSessions(pageNumber = 1): Promise<SessionListPayload> {
        if (pageNumber === 1) return page([session(1)], 3);
        throw new Error("network down");
      },
    };

    const result = await loadAllSessions(source);

    expect(result.sessions.map((item) => item.id)).toEqual([1]);
    expect(result.incomplete).toBe(true);
  });

  it("首页失败向上抛出，交由调用方保留旧列表并提示", async () => {
    const source = {
      async getSessions(): Promise<SessionListPayload> {
        throw new Error("unauthorized");
      },
    };

    await expect(loadAllSessions(source)).rejects.toThrow("unauthorized");
  });
});
