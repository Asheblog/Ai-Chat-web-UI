/**
 * 服务器身份归一化：把用户输入或本地存储里的地址收敛成唯一的“同一台服务器”键。
 * 大小写与结尾斜杠不应产生第二台服务器，也不应让两台不同服务器共用同一个凭证槽位。
 */
export function normalizeServerEndpointKey(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  try {
    // URL 已按标准规范化 scheme/authority（大小写不敏感、默认端口省略），
    // 路径与查询保留原始大小写：服务端可能把 /Path 与 /path 视为不同实例，
    // 整体小写会把两台服务器错误地合并成一台并共用凭证槽位。
    return new URL(trimmed).href.replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

const MAX_SLUG_LENGTH = 40;

/**
 * FNV-1a 32 位散列，只用于让 profile id 在截断与字符折叠之后仍能区分不同服务器。
 * 它不承担安全校验职责；对“用户手动维护的几台服务器”这一量级，碰撞可以忽略。
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * profile id 同时决定 SecureStore 的凭证槽位与多服务器列表的稳定标识，
 * 因此必须：只含 [a-z0-9._-]、定长可控、且不同地址不因截断而撞车。
 */
export function buildServerProfileId(endpoint: string): string {
  const key = normalizeServerEndpointKey(endpoint);
  const slug = key
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/g, "")
    .toLowerCase();
  return `${slug || "server"}_${shortHash(key)}`;
}
