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

import {
  buildServerProfileId,
  loadServerProfilesState,
  removeServerProfile,
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
});
