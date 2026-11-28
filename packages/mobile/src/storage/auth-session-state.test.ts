import { describe, expect, it } from "vitest";

import { MobileApiError, UnauthorizedApiError } from "../mobile-api-client";
import type { MobileUser } from "../auth-types";
import {
  isRestorePending,
  isSessionBoundToProfile,
  shouldClearLiveSession,
  shouldDiscardStoredToken,
  tokenForProfile,
  type AuthedSession,
} from "./auth-session-state";

const user: MobileUser = {
  id: 1,
  username: "alice",
  role: "USER",
  status: "ACTIVE",
};
const sessionA: AuthedSession = { profileId: "server-a", token: "token-a", user };

describe("登录会话与服务器的绑定关系", () => {
  it("只有会话归属的服务器才能进入工作区", () => {
    expect(isSessionBoundToProfile(sessionA, "server-a")).toBe(true);
    expect(isSessionBoundToProfile(sessionA, "server-b")).toBe(false);
    expect(isSessionBoundToProfile(sessionA, null)).toBe(false);
    expect(isSessionBoundToProfile(null, "server-a")).toBe(false);
  });

  it("旧服务器的 401 不得清掉当前服务器的在线会话", () => {
    expect(shouldClearLiveSession("server-a", "server-a")).toBe(true);
    expect(shouldClearLiveSession("server-b", "server-a")).toBe(false);
    expect(shouldClearLiveSession(null, "server-a")).toBe(false);
    expect(shouldClearLiveSession("server-a", null)).toBe(false);
  });

  it("活动服务器尚未完成会话恢复时应显示恢复中", () => {
    expect(isRestorePending(null, "server-a")).toBe(true);
    expect(isRestorePending("server-b", "server-a")).toBe(true);
    expect(isRestorePending("server-a", "server-a")).toBe(false);
    expect(isRestorePending("server-a", null)).toBe(false);
  });

  it("仅在 401 时丢弃已保存的 token，网络故障保留凭证", () => {
    expect(shouldDiscardStoredToken(new UnauthorizedApiError())).toBe(true);
    expect(shouldDiscardStoredToken({ status: 401 })).toBe(true);
    expect(shouldDiscardStoredToken(new MobileApiError("无法连接服务端，请确认网络和服务端地址。"))).toBe(false);
    expect(shouldDiscardStoredToken(new Error("timeout"))).toBe(false);
    expect(shouldDiscardStoredToken(null)).toBe(false);
  });

  it("token 只交给它所属的服务器，切站后的旧客户端拿不到新 token", () => {
    const scoped = { profileId: "server-a", token: "token-a" };

    expect(tokenForProfile(scoped, "server-a")).toBe("token-a");
    expect(tokenForProfile(scoped, "server-b")).toBeNull();
    expect(tokenForProfile(scoped, null)).toBeNull();
    expect(tokenForProfile(null, "server-a")).toBeNull();
  });

  it("服务端返回 403/500 不属于凭证失效", () => {
    expect(shouldDiscardStoredToken(new MobileApiError("请求失败，服务端返回 500。", 500))).toBe(false);
    expect(shouldDiscardStoredToken(new MobileApiError("无权限", 403))).toBe(false);
  });
});
