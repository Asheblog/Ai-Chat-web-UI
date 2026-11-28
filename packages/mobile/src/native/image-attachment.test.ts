import { describe, expect, it } from "vitest";

import type { PendingImageAttachment } from "../types/mobile";

import {
  countExistingImages,
  remainingImageSlots,
  sumPendingImageBytes,
  toPendingImageAttachments,
  type PickedImageAsset,
} from "./image-attachment";

const LIMITS = {
  maxCount: 4,
  maxMb: 1,
  maxEdge: 100,
  maxTotalMb: 2,
};

const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQ==";

function makeAsset(overrides: Partial<PickedImageAsset> = {}): PickedImageAsset {
  return {
    uri: "file:///cache/picked-image",
    base64: JPEG_BASE64,
    mimeType: "image/png",
    fileName: "picked.png",
    width: 50,
    height: 50,
    ...overrides,
  };
}

function makeExisting(sizeBytes: number): PendingImageAttachment {
  return {
    id: "existing-image",
    uri: "file:///cache/existing",
    mime: "image/jpeg",
    data: "",
    sizeBytes,
  };
}

describe("待发送图片附件校验", () => {
  it("按 base64 实际格式修正 MIME，并写入真实字节数", () => {
    const result = toPendingImageAttachments([makeAsset()], [], LIMITS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mime).toBe("image/jpeg");
    expect(result.images[0]?.sizeBytes).toBe(16);
    expect(result.images[0]?.data).toBe(JPEG_BASE64);
  });

  it("使用共享上限：数量、单张体积、边长与合计体积", () => {
    expect(
      toPendingImageAttachments(
        Array.from({ length: 5 }, () => makeAsset()),
        [],
        LIMITS,
      ),
    ).toEqual({
      ok: false,
      message: "单条消息最多发送 4 张图片，当前还可添加 4 张。",
    });

    expect(
      toPendingImageAttachments(
        [makeAsset()],
        Array.from({ length: 4 }, (_, index) => ({
          ...makeExisting(1),
          id: `existing-${index}`,
        })),
        LIMITS,
      ),
    ).toEqual({ ok: false, message: "单条消息最多发送 4 张图片。" });

    expect(
      toPendingImageAttachments([makeAsset()], [], { ...LIMITS, maxMb: 0.000001 }),
    ).toEqual({
      ok: false,
      message: "单张图片体积超过 0.000001MB 上限，请重新选择或压缩后发送。",
    });

    expect(
      toPendingImageAttachments([makeAsset({ width: 101 })], [], LIMITS),
    ).toEqual({
      ok: false,
      message: "图片分辨率超过 100 像素上限，请重新选择或压缩后发送。",
    });

    const totalBytes = 2 * 1024 * 1024;
    expect(
      toPendingImageAttachments([makeAsset()], [makeExisting(totalBytes)], LIMITS),
    ).toEqual({
      ok: false,
      message: "所有图片合计需 ≤ 2MB，请重新选择或压缩后发送。",
    });
  });

  it("已有图片计入数量与总体积，缺失 sizeBytes 时回退 base64 长度", () => {
    expect(countExistingImages(3)).toBe(3);
    expect(countExistingImages([makeExisting(1)])).toBe(1);
    expect(remainingImageSlots(3, LIMITS)).toBe(1);
    expect(sumPendingImageBytes([makeExisting(1024)])).toBe(1024);
    expect(
      sumPendingImageBytes([
        { id: "no-size", uri: "", mime: "image/jpeg", data: JPEG_BASE64 },
      ]),
    ).toBe(16);
  });

  it("base64 缺失时给出明确错误而不是静默丢图", () => {
    expect(
      toPendingImageAttachments([makeAsset({ base64: null })], [], LIMITS),
    ).toEqual({ ok: false, message: "无法读取所选图片数据，请重新选择。" });
  });
});
