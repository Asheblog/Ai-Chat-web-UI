import * as SecureStore from "expo-secure-store";

const LEGACY_AUTH_TOKEN_KEY = "aichat.authToken";

function buildScopedTokenKey(profileId?: string | null): string {
  if (!profileId) {
    return LEGACY_AUTH_TOKEN_KEY;
  }
  const sanitized = profileId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  return `aichat.authToken.${sanitized || "default"}`;
}

export async function loadAuthToken(profileId?: string | null): Promise<string | null> {
  const scopedKey = buildScopedTokenKey(profileId);
  const scoped = await SecureStore.getItemAsync(scopedKey);
  if (scoped) {
    return scoped;
  }
  if (profileId) {
    const legacy = await SecureStore.getItemAsync(LEGACY_AUTH_TOKEN_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(scopedKey, legacy);
      await SecureStore.deleteItemAsync(LEGACY_AUTH_TOKEN_KEY);
      return legacy;
    }
  }
  return null;
}

export async function saveAuthToken(token: string, profileId?: string | null): Promise<void> {
  await SecureStore.setItemAsync(buildScopedTokenKey(profileId), token);
}

export async function clearAuthToken(profileId?: string | null): Promise<void> {
  await SecureStore.deleteItemAsync(buildScopedTokenKey(profileId));
  if (!profileId) {
    await SecureStore.deleteItemAsync(LEGACY_AUTH_TOKEN_KEY);
  }
}
