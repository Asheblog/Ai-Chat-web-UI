import { describe, expect, it } from "vitest";

import { ChatStreamCoordinator } from "./chat-stream-coordinator";

describe("ChatStreamCoordinator", () => {
  it("同一时刻只允许一条活动流", () => {
    const coordinator = new ChatStreamCoordinator();
    const first = coordinator.begin(1);

    expect(first).not.toBeNull();
    expect(coordinator.begin(1)).toBeNull();
    expect(coordinator.begin(2)).toBeNull();
    expect(coordinator.isCurrent(first!)).toBe(true);
  });

  it("旧流结束后不得清掉新流", () => {
    const coordinator = new ChatStreamCoordinator();
    const first = coordinator.begin(7)!;
    coordinator.release(first);
    const second = coordinator.begin(7)!;

    expect(second).not.toBe(first);
    expect(coordinator.release(first)).toBe(false);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    expect(coordinator.activeSessionId).toBe(7);
  });

  it("停止当前流后旧代次失效，可立即开始新流", () => {
    const coordinator = new ChatStreamCoordinator();
    const first = coordinator.begin(3)!;

    const cancelled = coordinator.cancelActive();

    expect(cancelled).toEqual({ generation: first, sessionId: 3 });
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.activeSessionId).toBeNull();

    const second = coordinator.begin(3)!;
    expect(second).not.toBe(first);
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("取消后的迟到 finally 不会释放新流", () => {
    const coordinator = new ChatStreamCoordinator();
    const first = coordinator.begin(1)!;
    coordinator.cancelActive();
    const second = coordinator.begin(1)!;

    expect(coordinator.release(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    expect(coordinator.release(second)).toBe(true);
    expect(coordinator.activeSessionId).toBeNull();
  });
});
