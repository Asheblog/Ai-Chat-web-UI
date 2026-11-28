import AsyncStorage from "@react-native-async-storage/async-storage";

import type { BrandingInfo, ServerProfile } from "../types/mobile";
import { loadServerEndpoint } from "../server-endpoint-storage";

const PROFILES_KEY = "aichat.serverProfiles.v1";
const ACTIVE_PROFILE_ID_KEY = "aichat.activeServerProfileId.v1";

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const defaultStorage: KeyValueStorage = AsyncStorage;

export function buildServerProfileId(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/+$/, "").toLowerCase();
  const safe = normalized.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.slice(0, 80) || "default_server";
}

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

  // 从旧单地址存储平滑迁移
  if (profiles.length === 0) {
    try {
      const legacyEndpoint = await legacyLoader();
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

export function upsertServerProfile(
  profiles: ServerProfile[],
  input: {
    endpoint: string;
    name?: string | null;
    branding?: BrandingInfo | null;
  },
): { profiles: ServerProfile[]; profile: ServerProfile } {
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const id = buildServerProfileId(endpoint);
  const existing = profiles.find((p) => p.id === id || p.endpoint === endpoint);

  const profile: ServerProfile = {
    id: existing?.id ?? id,
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
