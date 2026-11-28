import AsyncStorage from "@react-native-async-storage/async-storage";

import type { BrandingInfo, ServerProfile } from "../types/mobile";
import { loadServerEndpoint } from "../server-endpoint-storage";
import { buildServerProfileId, normalizeServerEndpointKey } from "./server-identity";

export { buildServerProfileId };

const PROFILES_KEY = "aichat.serverProfiles.v1";
const ACTIVE_PROFILE_ID_KEY = "aichat.activeServerProfileId.v1";

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const defaultStorage: KeyValueStorage = AsyncStorage;

export function deriveServerName(endpoint: string, brandText?: string | null): string {
  const trimmedBrand = typeof brandText === "string" ? brandText.trim() : "";
  if (trimmedBrand) {
    return trimmedBrand;
  }
  try {
    const parsed = new URL(endpoint);
    return parsed.host || endpoint;
  } catch {
    return endpoint;
  }
}

export async function loadServerProfilesState(
  storage: KeyValueStorage = defaultStorage,
  legacyLoader: () => Promise<string | null> = loadServerEndpoint,
): Promise<{ profiles: ServerProfile[]; activeProfileId: string | null }> {
  const [rawProfiles, rawActiveId] = await Promise.all([
    storage.getItem(PROFILES_KEY),
    storage.getItem(ACTIVE_PROFILE_ID_KEY),
  ]);

  let profiles: ServerProfile[] = [];
  if (rawProfiles) {
    try {
      const parsed = JSON.parse(rawProfiles);
      if (Array.isArray(parsed)) {
        profiles = parsed.filter(
          (item): item is ServerProfile =>
            Boolean(item && typeof item.id === "string" && typeof item.endpoint === "string"),
        );
      }
    } catch {
      profiles = [];
    }
  }

  // 旧单地址存储只在“从未写入过多服务器配置”时迁移一次。
  // 不能用 profiles.length === 0 判定：用户主动删光服务器后，重启会把旧地址重新迁回来。
  if (!rawProfiles) {
    try {
      const legacyEndpoint = (await legacyLoader())?.trim();
      if (legacyEndpoint) {
        const migrated: ServerProfile = {
          id: buildServerProfileId(legacyEndpoint),
          name: deriveServerName(legacyEndpoint),
          endpoint: legacyEndpoint,
          lastConnectedAt: new Date().toISOString(),
        };
        profiles = [migrated];
        await saveServerProfilesState(profiles, migrated.id, storage);
        return { profiles, activeProfileId: migrated.id };
      }
    } catch {
      // 忽略旧存储读取失败，保持空列表
    }
  }

  const activeProfileId =
    rawActiveId && profiles.some((p) => p.id === rawActiveId)
      ? rawActiveId
      : (profiles[0]?.id ?? null);

  return { profiles, activeProfileId };
}

export async function saveServerProfilesState(
  profiles: ServerProfile[],
  activeProfileId: string | null,
  storage: KeyValueStorage = defaultStorage,
): Promise<void> {
  await storage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  if (activeProfileId) {
    await storage.setItem(ACTIVE_PROFILE_ID_KEY, activeProfileId);
  } else {
    await storage.removeItem(ACTIVE_PROFILE_ID_KEY);
  }
}

/**
 * 派生 id 撞到已有条目时绝不覆盖：那可能是另一台服务器（旧格式 id 残留）。
 * 追加序号保持唯一，宁可多一个 profile，也不让两台服务器共用凭证槽位。
 */
function pickProfileId(profiles: ServerProfile[], endpoint: string): string {
  const baseId = buildServerProfileId(endpoint);
  if (!profiles.some((p) => p.id === baseId)) {
    return baseId;
  }
  let suffix = 2;
  while (profiles.some((p) => p.id === `${baseId}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}_${suffix}`;
}

export function upsertServerProfile(
  profiles: ServerProfile[],
  input: {
    endpoint: string;
    name?: string | null;
    branding?: BrandingInfo | null;
  },
): { profiles: ServerProfile[]; profile: ServerProfile } {
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const endpointKey = normalizeServerEndpointKey(endpoint);
  // 只按“同一台服务器”合并：地址归一化后相同才算同一台。
  // 若按派生 id 合并，长地址被截断或字符被折叠后会把两台服务器并成一条，
  // 并让第二台服务器复用第一台的凭证槽位。
  const existing = profiles.find(
    (p) => normalizeServerEndpointKey(p.endpoint) === endpointKey,
  );

  const profile: ServerProfile = {
    id: existing?.id ?? pickProfileId(profiles, endpoint),
    name:
      (typeof input.name === "string" && input.name.trim()) ||
      deriveServerName(endpoint, input.branding?.brand_text ?? existing?.brandText),
    endpoint,
    lastConnectedAt: new Date().toISOString(),
    brandText: input.branding?.brand_text ?? existing?.brandText ?? null,
    brandTheme: input.branding
      ? {
          brand_primary: input.branding.brand_primary,
          brand_primary_foreground: input.branding.brand_primary_foreground,
          brand_background: input.branding.brand_background,
          brand_surface: input.branding.brand_surface,
          brand_foreground: input.branding.brand_foreground,
          brand_muted_foreground: input.branding.brand_muted_foreground,
        }
      : existing?.brandTheme ?? null,
  };

  const rest = profiles.filter((p) => p.id !== profile.id);
  return {
    profiles: [profile, ...rest],
    profile,
  };
}

export function removeServerProfile(
  profiles: ServerProfile[],
  profileId: string,
  activeProfileId: string | null,
): { profiles: ServerProfile[]; activeProfileId: string | null } {
  const next = profiles.filter((p) => p.id !== profileId);
  const nextActive =
    activeProfileId === profileId ? (next[0]?.id ?? null) : activeProfileId;
  return { profiles: next, activeProfileId: nextActive };
}
