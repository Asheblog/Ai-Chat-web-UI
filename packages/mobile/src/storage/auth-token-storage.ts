import * as SecureStore from "expo-secure-store";

import { loadServerEndpoint } from "../server-endpoint-storage";
import { normalizeServerEndpointKey } from "./server-identity";

const LEGACY_AUTH_TOKEN_KEY = "aichat.authToken";

function buildScopedTokenKey(profileId: string): string {
  const sanitized = profileId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  return `aichat.authToken.${sanitized || "default"}`;
}

function readScopedToken(profileId: string): Promise<string | null> {
  return SecureStore.getItemAsync(buildScopedTokenKey(profileId));
}

/**
 * 凭证槽位的串行队列。save / 清除 / 按值清理 / 旧 token 认领都排队执行，
 * 这样“读出当前 token → 比较 → 删除”不会被夹在中间的保存打断（TOCTOU）：
 * 否则一条迟到的 401 会删掉用户刚刚重新登录保存的新 token。
 * 队列本身永远 resolve，单个任务失败只影响它自己的返回值。
 */
let authStoreQueue: Promise<unknown> = Promise.resolve();

function withAuthStore<T>(task: () => Promise<T>): Promise<T> {
  const result = authStoreQueue.then(task, task);
  authStoreQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * 旧版只有一个服务器地址，token 存在无作用域的固定 key 下。
 * 只有当地址与目标服务器一致时才认领它，避免把上一台服务器的凭证交给新服务器。
 * 调用时已持有存储队列。
 */
async function adoptLegacyToken(
  profileId: string,
  expectedEndpoint: string,
): Promise<string | null> {
  const existing = await readScopedToken(profileId);
  if (existing) {
    // 排队期间已有更新的 token 落盘：以它为准，不覆盖。
    return existing;
  }

  const [legacyToken, legacyEndpoint] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_AUTH_TOKEN_KEY),
    loadServerEndpoint(),
  ]);

  if (!legacyToken || !legacyEndpoint) {
    return null;
  }
  if (
    normalizeServerEndpointKey(legacyEndpoint) !==
    normalizeServerEndpointKey(expectedEndpoint)
  ) {
    return null;
  }

  await SecureStore.setItemAsync(buildScopedTokenKey(profileId), legacyToken);
  await SecureStore.deleteItemAsync(LEGACY_AUTH_TOKEN_KEY);
  return legacyToken;
}

export async function loadAuthToken(
  profileId: string,
  expectedEndpoint?: string | null,
): Promise<string | null> {
  const scoped = await readScopedToken(profileId);
  if (scoped) {
    return scoped;
  }
  if (!expectedEndpoint) {
    return null;
  }
  return withAuthStore(() => adoptLegacyToken(profileId, expectedEndpoint));
}

export function saveAuthToken(token: string, profileId: string): Promise<void> {
  return withAuthStore(async () => {
    await SecureStore.setItemAsync(buildScopedTokenKey(profileId), token);
  });
}

/** 清空指定服务器的凭证；传 null 时只清理旧版无作用域的残留（普通注销/删除语义，不做按值判断）。 */
export function clearAuthToken(profileId: string | null): Promise<void> {
  return withAuthStore(async () => {
    if (profileId) {
      await SecureStore.deleteItemAsync(buildScopedTokenKey(profileId));
      return;
    }
    await SecureStore.deleteItemAsync(LEGACY_AUTH_TOKEN_KEY);
  });
}

/**
 * 仅当槽位里仍是 expectedToken 时才删除，返回是否真的删了。
 * 比较与删除在同一个存储队列任务内完成，因此“旧 401”不会删掉期间新保存的 token。
 */
export function clearAuthTokenIfCurrent(
  profileId: string,
  expectedToken: string,
): Promise<boolean> {
  return withAuthStore(async () => {
    const current = await readScopedToken(profileId);
    if (current !== expectedToken) {
      return false;
    }
    await SecureStore.deleteItemAsync(buildScopedTokenKey(profileId));
    return true;
  });
}
