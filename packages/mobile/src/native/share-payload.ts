export type IncomingSharePayload = {
  value?: string | null;
  shareType?: string | null;
  mimeType?: string | null;
};

export type SharedPayloadSource = {
  getSharedPayloads: () => readonly IncomingSharePayload[] | null | undefined;
  clearSharedPayloads: () => void;
};

const TEXT_QUERY_KEYS = ["text", "q", "prompt", "content"] as const;

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

/**
 * 兼容 aichat://share?text=... 这类显式 deep link；查询参数优先级与旧实现一致。
 */
export function extractSharedTextFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  const queryIndex = url.indexOf("?");
  if (queryIndex < 0) return null;

  const hashIndex = url.indexOf("#", queryIndex);
  const query = url.slice(
    queryIndex + 1,
    hashIndex >= 0 ? hashIndex : url.length,
  );
  if (!query) return null;

  const values = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const key = decodeQueryComponent(rawKey);
    if (!TEXT_QUERY_KEYS.includes(key as (typeof TEXT_QUERY_KEYS)[number])) {
      continue;
    }
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
    const value = decodeQueryComponent(rawValue).trim();
    if (value && !values.has(key)) {
      values.set(key, value);
    }
  }

  for (const key of TEXT_QUERY_KEYS) {
    const value = values.get(key);
    if (value) return value;
  }
  return null;
}

/**
 * expo-sharing 的 Android 原生监听器在收到 SEND intent 时会发出
 * `<scheme>://expo-sharing` 的 URL 事件；这里只识别这一触发信号。
 */
/**
 * 冷启动 deep link 在每个 ChatScreen 挂载时都会被 getInitialURL 重新读到，
 * 同一个 URL 只取一次文本，避免切换会话重挂后重复追加。
 */
export function takeInitialDeepLinkText(
  url: string | null | undefined,
  consumedUrls: Set<string>,
): string | null {
  if (!url || consumedUrls.has(url)) return null;
  const text = extractSharedTextFromUrl(url);
  if (!text) return null;
  consumedUrls.add(url);
  return text;
}

export function isShareIntoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url.trim());
  if (!match) return false;
  const scheme = match[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return false;
  return match[2]?.toLowerCase() === "expo-sharing";
}

export function collectIncomingShareText(
  payloads: readonly IncomingSharePayload[] | null | undefined,
): string | null {
  if (!payloads?.length) return null;

  const parts: string[] = [];
  for (const payload of payloads) {
    const value = typeof payload?.value === "string" ? payload.value.trim() : "";
    if (!value) continue;

    const shareType =
      typeof payload.shareType === "string"
        ? payload.shareType.toLowerCase()
        : "";
    const mimeType =
      typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
    const isTextPayload =
      shareType === "text" ||
      shareType === "url" ||
      mimeType.startsWith("text/plain");

    if (isTextPayload) {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * 读取并消费当前原生分享载荷：只有拿到文本时才清空，未挂载消费者时保留给下一次读取。
 */
export function consumeSharedText(source: SharedPayloadSource): string | null {
  const text = collectIncomingShareText(source.getSharedPayloads());
  if (text) {
    source.clearSharedPayloads();
  }
  return text;
}
