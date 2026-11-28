import { DEFAULT_CHAT_IMAGE_LIMITS } from "@aichat/shared/image-limits";

import type { PendingImageAttachment } from "../types/mobile";

/** 与 native/media 的选择上限保持同一来源（@aichat/shared/image-limits）。 */
export const MAX_PENDING_IMAGES = DEFAULT_CHAT_IMAGE_LIMITS.maxCount;

/**
 * 合并待发送图片：按 id 去重，current 优先。
 * 用于「发送失败后恢复草稿」与「连续选择图片」两条路径——既不能覆盖用户刚加的新图，
 * 也不能让失败重试把同一张图送两遍。
 */
export function mergePendingImages(
  current: readonly PendingImageAttachment[],
  incoming: readonly PendingImageAttachment[],
  limit: number = MAX_PENDING_IMAGES,
): PendingImageAttachment[] {
  const merged: PendingImageAttachment[] = [];
  const seen = new Set<string>();

  for (const image of [...current, ...incoming]) {
    if (seen.has(image.id)) continue;
    if (merged.length >= limit) break;
    seen.add(image.id);
    merged.push(image);
  }

  return merged;
}
