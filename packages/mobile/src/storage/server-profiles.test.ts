import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock("../server-endpoint-storage", () => ({
  loadServerEndpoint: vi.fn(async () => null),
}));

import type { ServerProfile } from "../types/mobile";
import { normalizeServerEndpointKey } from "./server-identity";
import {
  buildServerProfileId,
  loadServerProfilesState,
  removeServerProfile,
  saveServerProfilesState,
  upsertServerProfile,
  type KeyValueStorage,
} from "./server-profiles";

function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

describe("多服务器配置与迁移", () => {
  it("当新存储为空时从旧单地址平滑迁移", async () => {
    const storage = createMemoryStorage();
    const state = await loadServerProfilesState(storage, async () => "http://192.168.1.20:3001");

    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].endpoint).toBe("http://192.168.1.20:3001");
    expect(state.activeProfileId).toBe(buildServerProfileId("http://192.168.1.20:3001"));
  });

  it("用户清空服务器列表后重启不会复活旧单地址", async () => {
    const storage = createMemoryStorage();
    await saveServerProfilesState([], null, storage);

    const state = await loadServerProfilesState(storage, async () => "http://192.168.1.20:3001");

    expect(state.profiles).toHaveLength(0);
    expect(state.activeProfileId).toBeNull();
  });

  it("已有服务器配置时不再读取旧单地址存储", async () => {
    const storage = createMemoryStorage();
    await saveServerProfilesState(
      [{ id: "server-a", name: "A", endpoint: "http://a.example.com", lastConnectedAt: "" }],
      "server-a",
      storage,
    );
    const legacyLoader = vi.fn(async () => "http://legacy.example.com");

    const state = await loadServerProfilesState(storage, legacyLoader);

    expect(legacyLoader).not.toHaveBeenCalled();
    expect(state.profiles).toHaveLength(1);
    expect(state.activeProfileId).toBe("server-a");
  });

  it("活动服务器 id 失效时回退到列表首项", async () => {
    const storage = createMemoryStorage();
    await saveServerProfilesState(
      [
        { id: "server-a", name: "A", endpoint: "http://a.example.com", lastConnectedAt: "" },
        { id: "server-b", name: "B", endpoint: "http://b.example.com", lastConnectedAt: "" },
      ],
      "server-a",
      storage,
    );
    await storage.setItem("aichat.activeServerProfileId.v1", "server-removed");

    const state = await loadServerProfilesState(storage, async () => null);

    expect(state.activeProfileId).toBe("server-a");
  });

  it("支持新增、去重更新和删除服务器并切换活动项", () => {
    const first = upsertServerProfile([], {
      endpoint: "http://192.168.1.20:3001/",
      branding: { brand_text: "NAS", brand_primary: "#0F766E" },
    });
    const second = upsertServerProfile(first.profiles, {
      endpoint: "https://chat.example.com",
    });
    expect(second.profiles).toHaveLength(2);

    const updatedFirst = upsertServerProfile(second.profiles, {
      endpoint: "http://192.168.1.20:3001",
      name: "家庭 NAS",
    });
    expect(updatedFirst.profiles).toHaveLength(2);
    expect(updatedFirst.profile.name).toBe("家庭 NAS");

    const removed = removeServerProfile(
      updatedFirst.profiles,
      updatedFirst.profile.id,
      updatedFirst.profile.id,
    );
    expect(removed.profiles).toHaveLength(1);
    expect(removed.activeProfileId).toBe(second.profile.id);
  });

  it("同一服务器的地址大小写与尾斜杠差异不会新建配置", () => {
    const first = upsertServerProfile([], { endpoint: "HTTP://Host.Example.com:3001/" });
    const second = upsertServerProfile(first.profiles, {
      endpoint: "http://host.example.com:3001",
    });

    expect(second.profiles).toHaveLength(1);
    expect(second.profile.id).toBe(first.profile.id);
  });

  it("地址只归一协议、主机与尾斜杠，路径大小写视为不同服务器", () => {
    expect(normalizeServerEndpointKey("HTTP://Host.Example.com:3001/Path/")).toBe(
      "http://host.example.com:3001/Path",
    );
    expect(normalizeServerEndpointKey("http://host.example.com:3001")).toBe(
      normalizeServerEndpointKey("http://host.example.com:3001/"),
    );
    expect(normalizeServerEndpointKey("http://host.example.com/Path")).not.toBe(
      normalizeServerEndpointKey("http://host.example.com/path"),
    );

    const first = upsertServerProfile([], { endpoint: "HTTP://Host.Example.com:3001/Path/" });
    const sameServer = upsertServerProfile(first.profiles, {
      endpoint: "http://host.example.com:3001/Path",
    });
    const otherPath = upsertServerProfile(sameServer.profiles, {
      endpoint: "http://host.example.com:3001/path",
    });

    expect(sameServer.profiles).toHaveLength(1);
    expect(sameServer.profile.id).toBe(first.profile.id);
    expect(otherPath.profiles).toHaveLength(2);
    expect(otherPath.profile.id).not.toBe(first.profile.id);
  });

  it("派生 id 撞车时不得覆盖已有服务器条目", () => {
    const endpoint = "https://a.example.com";
    const collidingId = buildServerProfileId(endpoint);
    const legacyEntry: ServerProfile = {
      id: collidingId,
      name: "旧条目",
      endpoint: "https://legacy.example.com",
      lastConnectedAt: "",
    };

    const result = upsertServerProfile([legacyEntry], { endpoint });

    expect(result.profiles).toHaveLength(2);
    expect(result.profile.id).not.toBe(collidingId);
    expect(
      result.profiles.find((p) => p.endpoint === "https://legacy.example.com")?.name,
    ).toBe("旧条目");
  });

  it("共享超长前缀的不同服务器不会互相覆盖", () => {
    const prefix = `https://gateway.example.com/${"x".repeat(60)}`;
    const alpha = `${prefix}/tenant-alpha`;
    const beta = `${prefix}/tenant-beta`;
    expect(alpha.slice(0, 80)).toBe(beta.slice(0, 80));

    const first = upsertServerProfile([], { endpoint: alpha });
    const second = upsertServerProfile(first.profiles, { endpoint: beta });

    expect(second.profiles).toHaveLength(2);
    expect(second.profile.id).not.toBe(first.profile.id);
    for (const id of [first.profile.id, second.profile.id]) {
      // SecureStore 的 key 只接受该字符集，且需可安全用于文件名类存储。
      expect(id).toMatch(/^[a-z0-9._-]+$/);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });
});
