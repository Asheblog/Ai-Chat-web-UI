import { DEFAULT_CHAT_IMAGE_LIMITS, type ChatImageLimitConfig } from "@aichat/shared/image-limits";

import type { PendingImageAttachment } from "../types/mobile";

import {
  base64ByteLength,
  detectImageMimeFromBase64,
  normalizeImageMime,
} from "./image-format";

export type ImagePickResult =
  | { ok: true; images: PendingImageAttachment[] }
  | { ok: false; message: string };

/**
 * 允许调用方传完整待发送图片列表，用于把已有图片计入数量与总体积。
 * 数字形式仅为兼容旧调用点，无法计入已有图片体积。
 */
export type ExistingImageState = number | readonly PendingImageAttachment[] | undefined;

export type PickedImageAsset = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
};

// base64 字段由 expo-image-picker 重新编码，始终是 JPEG；只有能确定是
// 服务端可解析的栅格格式时才信任 asset.mimeType 作为兜底。
const TRUSTED_BASE64_MIMES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function createPendingImageId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolvePickedImageMime(
  asset: PickedImageAsset,
  base64: string,
): string {
  const detected = detectImageMimeFromBase64(base64);
  if (detected) return detected;

  const declared = normalizeImageMime(asset.mimeType);
  if (declared && TRUSTED_BASE64_MIMES.has(declared)) return declared;

  return "image/jpeg";
}

function pendingImageBytes(image: PendingImageAttachment): number {
  if (
    typeof image.sizeBytes === "number" &&
    Number.isFinite(image.sizeBytes) &&
    image.sizeBytes > 0
  ) {
    return image.sizeBytes;
  }
  return base64ByteLength(image.data);
}

export function countExistingImages(existing: ExistingImageState): number {
  if (typeof existing === "number") {
    return Math.max(0, Math.floor(existing));
  }
  return existing?.length ?? 0;
}

export function sumPendingImageBytes(existing: ExistingImageState): number {
  if (typeof existing === "number") return 0;
  return (existing ?? []).reduce(
    (total, image) => total + pendingImageBytes(image),
    0,
  );
}

export function remainingImageSlots(
  existing: ExistingImageState,
  limits: ChatImageLimitConfig = DEFAULT_CHAT_IMAGE_LIMITS,
): number {
  return Math.max(0, limits.maxCount - countExistingImages(existing));
}

export function imageLimitMessage(
  limits: ChatImageLimitConfig = DEFAULT_CHAT_IMAGE_LIMITS,
): string {
  return `单条消息最多发送 ${limits.maxCount} 张图片。`;
}

/**
 * 按服务端 /api/chat/stream 的真实图片约定转换 ImagePicker 资源：
 * 数量、单张体积、单张边长与合计体积都使用 @aichat/shared/image-limits。
 */
export function toPendingImageAttachments(
  assets: readonly PickedImageAsset[],
  existing: ExistingImageState = [],
  limits: ChatImageLimitConfig = DEFAULT_CHAT_IMAGE_LIMITS,
): ImagePickResult {
  const existingCount = countExistingImages(existing);
  const remainingSlots = limits.maxCount - existingCount;
  if (remainingSlots <= 0) {
    return { ok: false, message: imageLimitMessage(limits) };
  }

  if (assets.length > remainingSlots) {
    return {
      ok: false,
      message: `单条消息最多发送 ${limits.maxCount} 张图片，当前还可添加 ${remainingSlots} 张。`,
    };
  }

  const maxImageBytes = Math.floor(limits.maxMb * 1024 * 1024);
  const maxTotalBytes = Math.floor(limits.maxTotalMb * 1024 * 1024);
  const maxEdge = Math.floor(limits.maxEdge);
  let totalBytes = sumPendingImageBytes(existing);
  const images: PendingImageAttachment[] = [];

  for (const asset of assets) {
    const data = asset.base64?.replace(/\s+/g, "") ?? "";
    if (!data) {
      return { ok: false, message: "无法读取所选图片数据，请重新选择。" };
    }

    const sizeBytes = base64ByteLength(data);
    if (sizeBytes > maxImageBytes) {
      return {
        ok: false,
        message: `单张图片体积超过 ${limits.maxMb}MB 上限，请重新选择或压缩后发送。`,
      };
    }

    const width = Math.max(0, Math.floor(asset.width ?? 0));
    const height = Math.max(0, Math.floor(asset.height ?? 0));
    if (width > maxEdge || height > maxEdge) {
      return {
        ok: false,
        message: `图片分辨率超过 ${limits.maxEdge} 像素上限，请重新选择或压缩后发送。`,
      };
    }

    totalBytes += sizeBytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        message: `所有图片合计需 ≤ ${limits.maxTotalMb}MB，请重新选择或压缩后发送。`,
      };
    }

    images.push({
      id: createPendingImageId(),
      uri: asset.uri,
      mime: resolvePickedImageMime(asset, data),
      data,
      fileName: asset.fileName ?? undefined,
      sizeBytes,
    });
  }

  return { ok: true, images };
}
