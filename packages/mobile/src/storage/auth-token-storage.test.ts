import { beforeEach, describe, expect, it, vi } from "vitest";

// 旧版单服务器客户端把 token 存在这个固定 key 下，迁移必须读取它。
const LEGACY_TOKEN_KEY = "aichat.authToken";

const secureStore = vi.hoisted(() => {
  const map = new Map<string, string>();
  const hooks: { beforeDelete: ((key: string) => Promise<void>) | null } = {
    beforeDelete: null,
  };
  return {
    map,
    hooks,
    getItemAsync: vi.fn(async (key: string) => map.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      if (hooks.beforeDelete) {
        await hooks.beforeDelete(key);
      }
      map.delete(key);
    }),
  };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
  deleteItemAsync: secureStore.deleteItemAsync,
}));

import { saveServerEndpoint } from "../server-endpoint-storage";
import {
  clearAuthToken,
  clearAuthTokenIfCurrent,
  loadAuthToken,
  saveAuthToken,
} from "./auth-token-storage";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  secureStore.map.clear();
  secureStore.hooks.beforeDelete = null;
  vi.clearAllMocks();
});

describe("按服务器隔离的登录凭证", () => {
  it("不同服务器的 token 互不覆盖、互不可见", async () => {
    await saveAuthToken("token-a", "server-a");
    await saveAuthToken("token-b", "server-b");

    expect(await loadAuthToken("server-a", "http://a.example.com")).toBe("token-a");
    expect(await loadAuthToken("server-b", "http://b.example.com")).toBe("token-b");
    expect(await loadAuthToken("server-c", "http://c.example.com")).toBeNull();
  });

  it("清除一个服务器的凭证不影响其它服务器", async () => {
    await saveAuthToken("token-a", "server-a");
    await saveAuthToken("token-b", "server-b");

    await clearAuthToken("server-a");

    expect(await loadAuthToken("server-a", "http://a.example.com")).toBeNull();
    expect(await loadAuthToken("server-b", "http://b.example.com")).toBe("token-b");
  });

  it("旧单服务器 token 只迁移给地址一致的服务器", async () => {
    await saveServerEndpoint("http://192.168.1.20:3001");
    secureStore.map.set(LEGACY_TOKEN_KEY, "legacy-token");

    const token = await loadAuthToken("server-a", "http://192.168.1.20:3001/");

    expect(token).toBe("legacy-token");
    expect(secureStore.map.has(LEGACY_TOKEN_KEY)).toBe(false);
    expect(await loadAuthToken("server-a", "http://192.168.1.20:3001")).toBe("legacy-token");
  });

  it("旧 token 不得迁移到地址不同的新服务器", async () => {
    await saveServerEndpoint("http://192.168.1.20:3001");
    secureStore.map.set(LEGACY_TOKEN_KEY, "legacy-token");

    const token = await loadAuthToken("server-b", "https://chat.example.com");

    expect(token).toBeNull();
    expect(secureStore.map.get(LEGACY_TOKEN_KEY)).toBe("legacy-token");
  });

  it("未提供目标地址时不猜测归属，保持旧 token 原样", async () => {
    await saveServerEndpoint("http://192.168.1.20:3001");
    secureStore.map.set(LEGACY_TOKEN_KEY, "legacy-token");

    expect(await loadAuthToken("server-a")).toBeNull();
    expect(secureStore.map.get(LEGACY_TOKEN_KEY)).toBe("legacy-token");
  });
});

describe("按值清理（旧 401 只能失效它自己那份 token）", () => {
  it("槽位仍是失败 token 时删除", async () => {
    await saveAuthToken("token-old", "server-a");

    await expect(clearAuthTokenIfCurrent("server-a", "token-old")).resolves.toBe(true);

    expect(await loadAuthToken("server-a", "http://a.example.com")).toBeNull();
  });

  it("槽位已换成新 token 时保留新 token", async () => {
    await saveAuthToken("token-new", "server-a");

    await expect(clearAuthTokenIfCurrent("server-a", "token-old")).resolves.toBe(false);

    expect(await loadAuthToken("server-a", "http://a.example.com")).toBe("token-new");
  });

  it("并发回归：删除进行中保存的新 token 必须排队，最终不能被旧 401 删掉", async () => {
    await saveAuthToken("token-old", "server-a");

    const deleteReached = createDeferred();
    const deleteGate = createDeferred();
    secureStore.hooks.beforeDelete = async (key) => {
      if (!key.includes("server-a")) return;
      deleteReached.resolve();
      await deleteGate.promise;
    };

    // 旧 401 触发的按值清理：读到 token-old 后卡在删除前的窗口里。
    const clearing = clearAuthTokenIfCurrent("server-a", "token-old");
    await deleteReached.promise;

    // 用户在这个窗口里完成了新登录。
    const saving = saveAuthToken("token-new", "server-a");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 串行化要求：删除没结束前，新 token 不得落盘（否则会被上面的删除连带清掉）。
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("authToken.server-a"),
      "token-new",
    );

    deleteGate.resolve();
    await expect(clearing).resolves.toBe(true);
    await saving;

    expect(await loadAuthToken("server-a", "http://a.example.com")).toBe("token-new");
  });
});
