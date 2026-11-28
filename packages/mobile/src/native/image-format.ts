const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heic",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_VALUE_BY_CODE = (() => {
  const values = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return values;
})();

function isBase64Whitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

function toAscii(bytes: Uint8Array, start: number, end: number): string {
  let result = "";
  const limit = Math.min(end, bytes.length);
  for (let index = Math.max(0, start); index < limit; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }
  return result;
}

/**
 * 解码 base64 开头的一小段字节，用于根据文件签名判断真实图片格式。
 * 不依赖 atob / Buffer，便于在 React Native 与单元测试环境中复用。
 */
export function decodeBase64Prefix(
  base64: string | null | undefined,
  maxBytes = 16,
): Uint8Array | null {
  if (!base64) return null;
  const limit = Math.max(0, Math.floor(maxBytes));
  if (!limit) return null;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < base64.length && bytes.length < limit; index += 1) {
    const code = base64.charCodeAt(index);
    if (code === 61) break;
    if (isBase64Whitespace(code)) continue;
    const value = code < BASE64_VALUE_BY_CODE.length ? BASE64_VALUE_BY_CODE[code] : -1;
    if (value < 0) {
      return bytes.length > 0 ? Uint8Array.from(bytes) : null;
    }

    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes.length > 0 ? Uint8Array.from(bytes) : null;
}

export function detectImageMimeFromBytes(
  bytes: Uint8Array | null | undefined,
): string | null {
  if (!bytes || bytes.length < 2) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    toAscii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  const gifMagic = toAscii(bytes, 0, 6);
  if (gifMagic === "GIF87a" || gifMagic === "GIF89a") {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    toAscii(bytes, 0, 4) === "RIFF" &&
    toAscii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (toAscii(bytes, 0, 2) === "BM") {
    return "image/bmp";
  }

  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0x00) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x2a)
  ) {
    return "image/tiff";
  }

  if (bytes.length >= 12 && toAscii(bytes, 4, 8) === "ftyp") {
    const brand = toAscii(bytes, 8, 12).toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "hevc" ||
      brand === "hevx" ||
      brand === "mif1" ||
      brand === "msf1"
    ) {
      return "image/heic";
    }
  }

  return null;
}

export function detectImageMimeFromBase64(
  base64: string | null | undefined,
): string | null {
  return detectImageMimeFromBytes(decodeBase64Prefix(base64, 16));
}

export function normalizeImageMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const normalized = mime.split(";")[0]?.trim().toLowerCase();
  if (!normalized || !normalized.startsWith("image/")) return null;
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function imageExtensionForMime(mime: string | null | undefined): string {
  const normalized = normalizeImageMime(mime);
  return (normalized ? EXTENSION_BY_MIME[normalized] : null) ?? ".jpg";
}

export function imageMimeFromFileName(
  nameOrUri: string | null | undefined,
): string | null {
  if (!nameOrUri) return null;
  const path = nameOrUri.split(/[?#]/, 1)[0] ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(path);
  if (!match) return null;
  return MIME_BY_EXTENSION[match[1]?.toLowerCase() ?? ""] ?? null;
}

export type ParsedImageDataUri = {
  data: string;
  mimeType: string | null;
  isBase64: boolean;
};

export function parseImageDataUri(
  uri: string | null | undefined,
): ParsedImageDataUri | null {
  if (!uri || !/^data:/i.test(uri)) return null;

  const match = /^data:([^,]*),/i.exec(uri);
  if (!match) return null;

  const metadata = match[1] ?? "";
  const separator = metadata.indexOf(";");
  const declaredMime = separator >= 0 ? metadata.slice(0, separator) : metadata;
  const flags = separator >= 0 ? metadata.slice(separator + 1).split(";") : [];
  const commaIndex = uri.indexOf(",");

  return {
    data: commaIndex >= 0 ? uri.slice(commaIndex + 1) : "",
    mimeType: normalizeImageMime(declaredMime),
    isBase64: flags.some((flag) => flag.trim().toLowerCase() === "base64"),
  };
}

/**
 * 依据 URI 的真实内容（data URI 看 base64 文件签名，其余看扩展名）给出 MIME，
 * 供保存相册/系统分享选择正确的临时文件后缀。
 */
export function resolveImageMimeFromUri(uri: string | null | undefined): string {
  const parsed = parseImageDataUri(uri);
  if (parsed) {
    if (parsed.isBase64) {
      return detectImageMimeFromBase64(parsed.data) ?? parsed.mimeType ?? "image/jpeg";
    }
    return parsed.mimeType ?? "image/svg+xml";
  }

  return imageMimeFromFileName(uri) ?? "image/jpeg";
}

/** base64 解码后的精确字节数（含 padding 修正，忽略换行与空白）。 */
export function base64ByteLength(base64: string | null | undefined): number {
  if (!base64) return 0;
  const clean = base64.replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}
